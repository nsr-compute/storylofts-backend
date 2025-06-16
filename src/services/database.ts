// src/services/database.ts
import { Pool, PoolClient } from 'pg';
import { VideoContent, VideoContentInput, PaginatedResponse } from '../types';

class DatabaseService {
  private pool: Pool;
  private isConnected = false;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
    });

    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }

  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1'); // Test query
      client.release();
      this.isConnected = true;
      console.log('✅ Connected to PostgreSQL database');
    } catch (error) {
      console.error('❌ Failed to connect to database:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
    this.isConnected = false;
    console.log('🔌 Disconnected from database');
  }

  isHealthy(): boolean {
    return this.isConnected;
  }

  // Health check with database ping
  async healthCheck(): Promise<{ healthy: boolean; responseTime: number; error?: string }> {
    const startTime = Date.now();
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      const responseTime = Date.now() - startTime;
      return { healthy: true, responseTime };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return { 
        healthy: false, 
        responseTime, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  // Video Content CRUD Operations
  async createVideoContent(content: VideoContentInput): Promise<VideoContent> {
    const client = await this.pool.connect();
    try {
      const query = `
        INSERT INTO video_content (
          user_id, title, description, filename, original_filename, 
          file_size, video_url, status, visibility, mime_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `;
      
      const values = [
        content.userId,
        content.title,
        content.description || null,
        content.filename,
        content.originalFilename || content.filename,
        content.fileSize,
        content.videoUrl,
        content.status || 'uploading',
        content.visibility || 'private',
        content.mimeType || null
      ];

      const result = await client.query(query, values);
      const videoData = result.rows[0];

      // Handle tags if provided
      if (content.tags && content.tags.length > 0) {
        await this.updateVideoTags(client, videoData.id, content.tags);
      }

      return this.formatVideoContent(videoData);
    } finally {
      client.release();
    }
  }

  async getVideoContent(id: string, userId?: string): Promise<VideoContent | null> {
    const client = await this.pool.connect();
    try {
      let query = `
        SELECT vc.*, 
               COALESCE(array_agg(t.name) FILTER (WHERE t.name IS NOT NULL), '{}') as tags
        FROM video_content vc
        LEFT JOIN video_tags vt ON vc.id = vt.video_id
        LEFT JOIN tags t ON vt.tag_id = t.id
        WHERE vc.id = $1
      `;
      const values = [id];

      // Add user filter for private content
      if (userId) {
        query += ` AND (vc.visibility = 'public' OR vc.user_id = $2)`;
        values.push(userId);
      } else {
        query += ` AND vc.visibility = 'public'`;
      }

      query += ` GROUP BY vc.id`;

      const result = await client.query(query, values);
      
      if (result.rows.length === 0) {
        return null;
      }

      return this.formatVideoContent(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async updateVideoContent(id: string, userId: string, updates: Partial<VideoContentInput>): Promise<VideoContent | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Build dynamic update query
      const updateFields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      Object.entries(updates).forEach(([key, value]) => {
        if (key !== 'tags' && value !== undefined) {
          const columnName = this.camelToSnake(key);
          updateFields.push(`${columnName} = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }
      });

      if (updateFields.length === 0 && !updates.tags) {
        await client.query('ROLLBACK');
        return this.getVideoContent(id, userId);
      }

      if (updateFields.length > 0) {
        const query = `
          UPDATE video_content 
          SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
          WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
          RETURNING *
        `;
        values.push(id, userId);

        const result = await client.query(query, values);
        if (result.rows.length === 0) {
          await client.query('ROLLBACK');
          return null;
        }
      }

      // Update tags if provided
      if (updates.tags !== undefined) {
        await this.updateVideoTags(client, id, updates.tags);
      }

      await client.query('COMMIT');
      return this.getVideoContent(id, userId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteVideoContent(id: string, userId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const query = `
        DELETE FROM video_content 
        WHERE id = $1 AND user_id = $2
        RETURNING id
      `;
      
      const result = await client.query(query, [id, userId]);
      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }

  async listVideoContent(
    userId?: string,
    options: {
      page?: number;
      limit?: number;
      status?: string;
      visibility?: string;
      tags?: string[];
      search?: string;
    } = {}
  ): Promise<PaginatedResponse<VideoContent>> {
    const client = await this.pool.connect();
    try {
      const {
        page = 1,
        limit = 20,
        status,
        visibility,
        tags,
        search
      } = options;

      const offset = (page - 1) * limit;
      const conditions: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      // Base query with tags
      let baseQuery = `
        FROM video_content vc
        LEFT JOIN video_tags vt ON vc.id = vt.video_id
        LEFT JOIN tags t ON vt.tag_id = t.id
      `;

      // User filter
      if (userId) {
        conditions.push(`vc.user_id = $${paramIndex}`);
        values.push(userId);
        paramIndex++;
      } else {
        conditions.push(`vc.visibility = 'public'`);
      }

      // Status filter
      if (status) {
        conditions.push(`vc.status = $${paramIndex}`);
        values.push(status);
        paramIndex++;
      }

      // Visibility filter
      if (visibility) {
        conditions.push(`vc.visibility = $${paramIndex}`);
        values.push(visibility);
        paramIndex++;
      }

      // Tag filter
      if (tags && tags.length > 0) {
        conditions.push(`t.name = ANY($${paramIndex})`);
        values.push(tags);
        paramIndex++;
      }

      // Search filter
      if (search) {
        conditions.push(`(vc.title ILIKE $${paramIndex} OR vc.description ILIKE $${paramIndex})`);
        values.push(`%${search}%`);
        paramIndex++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count query
      const countQuery = `
        SELECT COUNT(DISTINCT vc.id) as total
        ${baseQuery}
        ${whereClause}
      `;

      const countResult = await client.query(countQuery, values);
      const total = parseInt(countResult.rows[0].total);

      // Data query
      const dataQuery = `
        SELECT vc.*, 
               COALESCE(array_agg(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), '{}') as tags
        ${baseQuery}
        ${whereClause}
        GROUP BY vc.id
        ORDER BY vc.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;

      values.push(limit, offset);
      const dataResult = await client.query(dataQuery, values);

      const items = dataResult.rows.map(row => this.formatVideoContent(row));

      return {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      };
    } finally {
      client.release();
    }
  }

  // Tag management
  async createTag(name: string, color?: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      
      await client.query(
        `INSERT INTO tags (name, slug, color) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING`,
        [name, slug, color || '#6b7280']
      );
    } finally {
      client.release();
    }
  }

  async getTags(): Promise<Array<{ name: string; slug: string; color: string }>> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT name, slug, color FROM tags ORDER BY name');
      return result.rows;
    } finally {
      client.release();
    }
  }

  // Private helper methods
  private async updateVideoTags(client: PoolClient, videoId: string, tags: string[]): Promise<void> {
    // Remove existing tags
    await client.query('DELETE FROM video_tags WHERE video_id = $1', [videoId]);

    if (tags.length === 0) return;

    // Ensure all tags exist
    for (const tagName of tags) {
      await this.createTagWithClient(client, tagName);
    }

    // Add new tags
    const tagIds = await client.query(
      'SELECT id FROM tags WHERE name = ANY($1)',
      [tags]
    );

    for (const tagRow of tagIds.rows) {
      await client.query(
        'INSERT INTO video_tags (video_id, tag_id) VALUES ($1, $2)',
        [videoId, tagRow.id]
      );
    }
  }

  private async createTagWithClient(client: PoolClient, name: string): Promise<void> {
    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    
    await client.query(
      `INSERT INTO tags (name, slug, color) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING`,
      [name, slug, '#6b7280']
    );
  }

  private formatVideoContent(row: any): VideoContent {
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      description: row.description,
      filename: row.filename,
      originalFilename: row.original_filename,
      fileSize: parseInt(row.file_size),
      duration: row.duration,
      videoUrl: row.video_url,
      thumbnailUrl: row.thumbnail_url,
      status: row.status,
      visibility: row.visibility,
      mimeType: row.mime_type,
      resolution: row.resolution,
      fps: row.fps,
      bitrate: row.bitrate,
      codec: row.codec,
      tags: row.tags || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}

// Export singleton instance
export const db = new DatabaseService();
export default db;
