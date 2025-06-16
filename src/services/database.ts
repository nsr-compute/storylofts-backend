// src/services/database.ts - Complete StoryLofts Database Service with SSL Fix
import { Pool, PoolClient } from 'pg';
import { 
  VideoContent, 
  VideoContentInput, 
  PaginatedResponse, 
  VideoListOptions,
  VideoStatus,
  VideoVisibility 
} from '../types';

interface UserContentStats {
  totalVideos: number;
  totalSize: number;
  totalDuration: number;
  statusBreakdown: Record<string, number>;
  visibilityBreakdown: Record<string, number>;
  topTags: Array<{ name: string; count: number }>;
  recentUploads: number;
}

interface SearchOptions {
  query: string;
  page?: number;
  limit?: number;
  visibility?: VideoVisibility;
  minDuration?: number;
  maxDuration?: number;
  tags?: string[];
}

interface VideoViewData {
  videoId: string;
  viewerUserId?: string;
  ipAddress?: string;
  userAgent?: string;
  watchDuration?: number;
  watchPercentage?: number;
  referrer?: string;
  deviceType?: string;
}

class DatabaseService {
  private pool: Pool;
  private isConnected = false;

  constructor() {
    // Configure SSL for DigitalOcean managed database
    const sslConfig = process.env.NODE_ENV === 'production' ? {
      rejectUnauthorized: false,
      // Accept self-signed certificates from DigitalOcean
      checkServerIdentity: () => undefined,
      ca: undefined
    } : false;

    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 5000, // Increased timeout for DigitalOcean
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });

    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
      this.isConnected = false;
    });

    this.pool.on('connect', () => {
      console.log('✅ New database client connected');
    });

    this.pool.on('remove', () => {
      console.log('Database client removed from pool');
    });
  }

  async connect(): Promise<void> {
    try {
      console.log('🔌 Attempting to connect to PostgreSQL database...');
      const client = await this.pool.connect();
      
      // Test the connection
      const result = await client.query('SELECT version(), current_database(), current_user');
      console.log('📊 Database info:', {
        version: result.rows[0].version.split(' ')[1],
        database: result.rows[0].current_database,
        user: result.rows[0].current_user
      });
      
      client.release();
      this.isConnected = true;
      console.log('✅ Connected to PostgreSQL database successfully');
    } catch (error) {
      console.error('❌ Failed to connect to database:', error);
      console.error('💡 Connection details:', {
        ssl: process.env.NODE_ENV === 'production' ? 'enabled (rejectUnauthorized: false)' : 'disabled',
        hasConnectionString: !!process.env.DATABASE_URL,
        nodeEnv: process.env.NODE_ENV
      });
      this.isConnected = false;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.pool.end();
      this.isConnected = false;
      console.log('🔌 Disconnected from database');
    } catch (error) {
      console.error('Error disconnecting from database:', error);
      throw error;
    }
  }

  isHealthy(): boolean {
    return this.isConnected;
  }

  // Health check with database ping
  async healthCheck(): Promise<{ healthy: boolean; responseTime: number; error?: string }> {
    const startTime = Date.now();
    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1 as health_check');
      client.release();
      const responseTime = Date.now() - startTime;
      return { healthy: true, responseTime };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      console.error('Database health check failed:', error);
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
      await client.query('BEGIN');

      const query = `
        INSERT INTO video_content (
          user_id, title, description, filename, original_filename, 
          file_size, video_url, status, visibility, mime_type, duration,
          thumbnail_url, resolution, fps, bitrate, codec
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
        content.mimeType || null,
        content.duration || null,
        content.thumbnailUrl || null,
        content.resolution || null,
        content.fps || null,
        content.bitrate || null,
        content.codec || null
      ];

      const result = await client.query(query, values);
      const videoData = result.rows[0];

      // Handle tags if provided
      if (content.tags && content.tags.length > 0) {
        await this.updateVideoTags(client, videoData.id, content.tags);
      }

      await client.query('COMMIT');
      return this.formatVideoContent(videoData);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error creating video content:', error);
      throw error;
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
      console.error('Error updating video content:', error);
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
    options: VideoListOptions = {}
  ): Promise<PaginatedResponse<VideoContent>> {
    const client = await this.pool.connect();
    try {
      const {
        page = 1,
        limit = 20,
        status,
        visibility,
        tags,
        search,
        sortBy = 'created_at',
        sortOrder = 'desc'
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

      // Search filter - use full-text search
      if (search) {
        conditions.push(`(
          to_tsvector('english', vc.title || ' ' || COALESCE(vc.description, '')) 
          @@ plainto_tsquery('english', $${paramIndex})
          OR vc.title ILIKE $${paramIndex + 1} 
          OR vc.description ILIKE $${paramIndex + 1}
        )`);
        values.push(search, `%${search}%`);
        paramIndex += 2;
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

      // Data query with sorting
      const orderClause = `ORDER BY vc.${this.camelToSnake(sortBy)} ${sortOrder.toUpperCase()}`;
      
      const dataQuery = `
        SELECT vc.*, 
               COALESCE(array_agg(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), '{}') as tags
        ${baseQuery}
        ${whereClause}
        GROUP BY vc.id
        ${orderClause}
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

  // Advanced search with full-text search
  async searchVideoContent(
    userId?: string,
    options: SearchOptions = { query: '' }
  ): Promise<PaginatedResponse<VideoContent>> {
    const client = await this.pool.connect();
    try {
      const {
        query: searchQuery,
        page = 1,
        limit = 20,
        visibility,
        minDuration,
        maxDuration,
        tags
      } = options;

      const offset = (page - 1) * limit;
      const conditions: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      // Base query with full-text search
      let baseQuery = `
        FROM video_content vc
        LEFT JOIN video_tags vt ON vc.id = vt.video_id
        LEFT JOIN tags t ON vt.tag_id = t.id
      `;

      // Full-text search condition
      conditions.push(`(
        to_tsvector('english', vc.title || ' ' || COALESCE(vc.description, '')) 
        @@ plainto_tsquery('english', $${paramIndex})
        OR vc.title ILIKE $${paramIndex + 1}
        OR vc.description ILIKE $${paramIndex + 1}
      )`);
      values.push(searchQuery, `%${searchQuery}%`);
      paramIndex += 2;

      // User access control
      if (userId) {
        conditions.push(`(vc.visibility = 'public' OR vc.user_id = $${paramIndex})`);
        values.push(userId);
        paramIndex++;
      } else {
        conditions.push(`vc.visibility = 'public'`);
      }

      // Additional filters
      if (visibility) {
        conditions.push(`vc.visibility = $${paramIndex}`);
        values.push(visibility);
        paramIndex++;
      }

      if (minDuration !== undefined) {
        conditions.push(`vc.duration >= $${paramIndex}`);
        values.push(minDuration);
        paramIndex++;
      }

      if (maxDuration !== undefined) {
        conditions.push(`vc.duration <= $${paramIndex}`);
        values.push(maxDuration);
        paramIndex++;
      }

      if (tags && tags.length > 0) {
        conditions.push(`t.name = ANY($${paramIndex})`);
        values.push(tags);
        paramIndex++;
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      // Count query
      const countQuery = `
        SELECT COUNT(DISTINCT vc.id) as total
        ${baseQuery}
        ${whereClause}
      `;

      const countResult = await client.query(countQuery, values);
      const total = parseInt(countResult.rows[0].total);

      // Data query with relevance scoring
      const dataQuery = `
        SELECT vc.*, 
               COALESCE(array_agg(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), '{}') as tags,
               ts_rank(to_tsvector('english', vc.title || ' ' || COALESCE(vc.description, '')), 
                      plainto_tsquery('english', $1)) as relevance_score
        ${baseQuery}
        ${whereClause}
        GROUP BY vc.id
        ORDER BY relevance_score DESC, vc.created_at DESC
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

  // User statistics
  async getUserContentStats(userId: string): Promise<UserContentStats> {
    const client = await this.pool.connect();
    try {
      // Basic stats
      const basicStatsQuery = `
        SELECT 
          COUNT(*) as total_videos,
          COALESCE(SUM(file_size), 0) as total_size,
          COALESCE(SUM(duration), 0) as total_duration,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as recent_uploads
        FROM video_content 
        WHERE user_id = $1
      `;
      
      const basicStats = await client.query(basicStatsQuery, [userId]);
      
      // Status breakdown
      const statusQuery = `
        SELECT status, COUNT(*) as count
        FROM video_content 
        WHERE user_id = $1 
        GROUP BY status
      `;
      
      const statusResult = await client.query(statusQuery, [userId]);
      const statusBreakdown = statusResult.rows.reduce((acc, row) => {
        acc[row.status] = parseInt(row.count);
        return acc;
      }, {} as Record<string, number>);

      // Visibility breakdown
      const visibilityQuery = `
        SELECT visibility, COUNT(*) as count
        FROM video_content 
        WHERE user_id = $1 
        GROUP BY visibility
      `;
      
      const visibilityResult = await client.query(visibilityQuery, [userId]);
      const visibilityBreakdown = visibilityResult.rows.reduce((acc, row) => {
        acc[row.visibility] = parseInt(row.count);
        return acc;
      }, {} as Record<string, number>);

      // Top tags
      const tagsQuery = `
        SELECT t.name, COUNT(*) as count
        FROM video_content vc
        JOIN video_tags vt ON vc.id = vt.video_id
        JOIN tags t ON vt.tag_id = t.id
        WHERE vc.user_id = $1
        GROUP BY t.name
        ORDER BY count DESC
        LIMIT 10
      `;
      
      const tagsResult = await client.query(tagsQuery, [userId]);
      const topTags = tagsResult.rows.map(row => ({
        name: row.name,
        count: parseInt(row.count)
      }));

      const stats = basicStats.rows[0];
      
      return {
        totalVideos: parseInt(stats.total_videos),
        totalSize: parseInt(stats.total_size),
        totalDuration: parseInt(stats.total_duration),
        statusBreakdown,
        visibilityBreakdown,
        topTags,
        recentUploads: parseInt(stats.recent_uploads)
      };
    } finally {
      client.release();
    }
  }

  // Analytics - Track video views
  async trackVideoView(viewData: VideoViewData): Promise<void> {
    const client = await this.pool.connect();
    try {
      const query = `
        INSERT INTO video_views (
          video_id, viewer_user_id, ip_address, user_agent,
          watch_duration, watch_percentage, referrer, device_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;
      
      const values = [
        viewData.videoId,
        viewData.viewerUserId || null,
        viewData.ipAddress || null,
        viewData.userAgent || null,
        viewData.watchDuration || null,
        viewData.watchPercentage || null,
        viewData.referrer || null,
        viewData.deviceType || null
      ];

      await client.query(query, values);
    } catch (error) {
      console.error('Error tracking video view:', error);
      // Don't throw - view tracking shouldn't break the app
    } finally {
      client.release();
    }
  }

  // Tag management
  async createTag(name: string, color?: string, description?: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      
      await client.query(
        `INSERT INTO tags (name, slug, color, description) 
         VALUES ($1, $2, $3, $4) 
         ON CONFLICT (slug) DO NOTHING`,
        [name, slug, color || '#6b7280', description || null]
      );
    } finally {
      client.release();
    }
  }

  async getTags(): Promise<Array<{ id: string; name: string; slug: string; color: string; description?: string; usageCount: number }>> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT id, name, slug, color, description, usage_count 
        FROM tags 
        ORDER BY usage_count DESC, name ASC
      `);
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        color: row.color,
        description: row.description,
        usageCount: parseInt(row.usage_count || 0)
      }));
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
      status: row.status as VideoStatus,
      visibility: row.visibility as VideoVisibility,
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
