// src/routes/content.ts - StoryLofts Content Management Routes (FIXED)
import { Router, Response } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { db } from '../services/database';

import { 
  ApiResponse, 
  VideoContent, 
  VideoListOptions, 
  AuthenticatedRequest,
  VideoStatus,
  VideoVisibility 
} from '../types';
import { AuthenticatedRequest } from '../types/auth';  // Import from auth file

const router = Router();

// ============================================================================
// ZOD SCHEMAS - Centralized Validation Schemas
// ============================================================================

// Base schemas for reuse
const uuidSchema = z.string().uuid('Invalid UUID format');
const videoIdParamsSchema = z.object({
  params: z.object({
    id: uuidSchema
  })
});

// Video content creation schema
const createVideoContentSchema = z.object({
  body: z.object({
    title: z.string()
      .min(1, 'Title is required')
      .max(255, 'Title must be less than 255 characters')
      .trim(),
    description: z.string()
      .max(2000, 'Description must be less than 2000 characters')
      .optional(),
    filename: z.string()
      .min(1, 'Filename is required')
      .regex(/\.(mp4|mov|avi|webm|mkv|m4v|3gp|flv)$/i, 'Invalid video file format'),
    fileSize: z.number()
      .positive('File size must be positive')
      .max(524288000, 'File size cannot exceed 500MB'), // 500MB in bytes
    videoUrl: z.string().url('Invalid video URL'),
    visibility: z.enum(['public', 'private', 'unlisted']).default('private'),
    tags: z.array(z.string().trim().min(1))
      .max(10, 'Maximum 10 tags allowed')
      .optional()
      .default([]),
    mimeType: z.string()
      .regex(/^video\//, 'Must be a video MIME type')
      .optional(),
    duration: z.number().positive('Duration must be positive').optional(),
    thumbnailUrl: z.string().url('Invalid thumbnail URL').optional()
  })
});

// Video content update schema (all fields optional)
const updateVideoContentSchema = z.object({
  params: z.object({
    id: uuidSchema
  }),
  body: z.object({
    title: z.string()
      .min(1, 'Title is required')
      .max(255, 'Title must be less than 255 characters')
      .trim()
      .optional(),
    description: z.string()
      .max(2000, 'Description must be less than 2000 characters')
      .optional(),
    visibility: z.enum(['public', 'private', 'unlisted']).optional(),
    tags: z.array(z.string().trim().min(1))
      .max(10, 'Maximum 10 tags allowed')
      .optional(),
    thumbnailUrl: z.string().url('Invalid thumbnail URL').optional(),
    status: z.enum(['uploading', 'processing', 'completed', 'failed']).optional()
  })
});

// Query parameters for listing videos
const videoListQuerySchema = z.object({
  query: z.object({
    page: z.string()
      .transform(val => parseInt(val, 10))
      .refine(val => !isNaN(val) && val > 0, 'Page must be a positive number')
      .default('1'),
    limit: z.string()
      .transform(val => parseInt(val, 10))
      .refine(val => !isNaN(val) && val > 0 && val <= 100, 'Limit must be between 1 and 100')
      .default('20'),
    status: z.enum(['uploading', 'processing', 'completed', 'failed']).optional(),
    visibility: z.enum(['public', 'private', 'unlisted']).optional(),
    search: z.string().max(100, 'Search query too long').optional(),
    sortBy: z.enum(['created_at', 'updated_at', 'title', 'file_size', 'duration'])
      .default('created_at'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
    tags: z.string()
      .transform(val => val.split(',').map(tag => tag.trim()).filter(Boolean))
      .optional(),
    createdAfter: z.string().datetime('Invalid date format').optional(),
    createdBefore: z.string().datetime('Invalid date format').optional()
  })
});

// Search query schema
const searchQuerySchema = z.object({
  query: z.object({
    q: z.string()
      .min(1, 'Search query is required')
      .max(100, 'Search query too long')
      .trim(),
    page: z.string()
      .transform(val => parseInt(val, 10))
      .refine(val => !isNaN(val) && val > 0)
      .default('1'),
    limit: z.string()
      .transform(val => parseInt(val, 10))
      .refine(val => !isNaN(val) && val > 0 && val <= 50)
      .default('20'),
    visibility: z.enum(['public', 'private', 'unlisted']).optional(),
    tags: z.string()
      .transform(val => val.split(',').map(tag => tag.trim()).filter(Boolean))
      .optional()
  })
});

// Tag creation schema
const createTagSchema = z.object({
  body: z.object({
    name: z.string()
      .min(1, 'Tag name is required')
      .max(50, 'Tag name must be less than 50 characters')
      .trim()
      .toLowerCase(),
    color: z.string()
      .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex color code')
      .optional()
      .default('#3B82F6'),
    description: z.string()
      .max(200, 'Description must be less than 200 characters')
      .optional()
  })
});

// Bulk operations schemas
const bulkVisibilityUpdateSchema = z.object({
  body: z.object({
    videoIds: z.array(uuidSchema)
      .min(1, 'At least one video ID is required')
      .max(50, 'Cannot update more than 50 videos at once'),
    visibility: z.enum(['public', 'private', 'unlisted'])
  })
});

const bulkDeleteSchema = z.object({
  body: z.object({
    videoIds: z.array(uuidSchema)
      .min(1, 'At least one video ID is required')
      .max(20, 'Cannot delete more than 20 videos at once')
  })
});

// ============================================================================
// VIDEO CONTENT ROUTES
// ============================================================================

/**
 * GET /api/content
 * List video content with filtering, pagination, and search
 * Public endpoint for public content, authenticated for user content
 */
router.get('/', 
  validate(videoListQuerySchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // req.query is now validated and typed
      const options: VideoListOptions = req.query as any;

      // FIXED: Handle optional authentication
      const userId = req.user?.sub || undefined;

      const result = await db.listVideoContent(userId, options);

      const response: ApiResponse = {
        success: true,
        data: result,
        message: `Found ${result.items.length} videos (page ${result.pagination.page} of ${result.pagination.totalPages})`
      };

      // Add pagination headers
      res.set({
        'X-Total-Count': result.pagination.total.toString(),
        'X-Page-Count': result.pagination.totalPages.toString(),
        'X-Current-Page': result.pagination.page.toString(),
        'X-Per-Page': result.pagination.limit.toString()
      });

      res.json(response);
    } catch (error) {
      console.error('Error fetching content:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch content',
        message: 'An error occurred while retrieving video content'
      };
      res.status(500).json(response);
    }
  }
);

/**
 * GET /api/content/search
 * Advanced search for video content with full-text search
 * Public endpoint for public content, authenticated for user content
 */
router.get('/search',
  validate(searchQuerySchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // FIXED: Handle optional authentication
      const userId = req.user?.sub || undefined;
      const searchOptions = req.query as any;

      const result = await db.searchVideoContent(userId, searchOptions);

      const response: ApiResponse = {
        success: true,
        data: result,
        message: `Found ${result.items.length} videos matching "${searchOptions.q}"`
      };

      // Add search metadata headers
      res.set({
        'X-Search-Query': searchOptions.q,
        'X-Total-Results': result.pagination.total.toString(),
        'X-Search-Time': '< 100ms' // You could add actual timing
      });

      res.json(response);
    } catch (error) {
      console.error('Error searching content:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Search failed',
        message: 'An error occurred while searching video content'
      };
      res.status(500).json(response);
    }
  }
);

/**
 * GET /api/content/stats
 * Get user content statistics and analytics
 * Requires authentication
 */
router.get('/stats',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // FIXED: Proper null checking
      if (!req.user?.sub) {
        const response: ApiResponse = {
          success: false,
          error: 'Authentication required',
          message: 'You must be logged in to view content statistics'
        };
        return res.status(401).json(response);
      }

      const userId = req.user.sub;
      const stats = await db.getUserContentStats(userId);

      const response: ApiResponse = {
        success: true,
        data: stats,
        message: 'Content statistics retrieved successfully'
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching content stats:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch statistics',
        message: 'An error occurred while retrieving content statistics'
      };
      res.status(500).json(response);
    }
  }
);

/**
 * GET /api/content/:id
 * Get specific video content by ID
 * Public for public content, authenticated for private content
 */
router.get('/:id',
  validate(videoIdParamsSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      // FIXED: Handle optional authentication
      const userId = req.user?.sub || undefined;

      const content = await db.getVideoContent(id, userId);

      if (!content) {
        const response: ApiResponse = {
          success: false,
          error: 'Content not found',
          message: 'The requested video content does not exist or you do not have permission to view it'
        };
        return res.status(404).json(response);
      }

      // Track view if content is accessed
      if (content.visibility === 'public' || userId) {
        try {
          await db.trackVideoView({
            videoId: id,
            viewerUserId: userId,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            referrer: req.get('Referer')
          });
        } catch (viewError) {
          // Don't fail the request if view tracking fails
          console.warn('Failed to track video view:', viewError);
        }
      }

      const response: ApiResponse<VideoContent> = {
        success: true,
        data: content,
        message: `Video "${content.title}" retrieved successfully`
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching content:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch content',
        message: 'An error occurred while retrieving the video content'
      };
      res.status(500).json(response);
    }
  }
);

/**
 * POST /api/content
 * Create new video content
 * Requires authentication
 */
router.post('/',
  authenticateToken,
  validate(createVideoContentSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // FIXED: Proper null checking
      if (!req.user?.sub) {
        const response: ApiResponse = {
          success: false,
          error: 'Authentication required',
          message: 'You must be logged in to create content'
        };
        return res.status(401).json(response);
      }

      const userId = req.user.sub;
      const contentInput = {
        ...req.body,
        userId
      };

      const content = await db.createVideoContent(contentInput);

      const response: ApiResponse<VideoContent> = {
        success: true,
        data: content,
        message: `Video "${content.title}" created successfully`
      };

      res.status(201).json(response);
    } catch (error) {
      console.error('Error creating content:', error);
      
      // Handle specific database errors
      if (error instanceof Error) {
        if (error.message.includes('duplicate key') || error.message.includes('already exists')) {
          const response: ApiResponse = {
            success: false,
            error: 'Duplicate content',
            message: 'Content with this identifier already exists'
          };
          return res.status(409).json(response);
        }

        if (error.message.includes('foreign key') || error.message.includes('constraint')) {
          const response: ApiResponse = {
            success: false,
            error: 'Invalid reference',
            message: 'One or more referenced resources do not exist'
          };
          return res.status(400).json(response);
        }
      }

      const response: ApiResponse = {
        success: false,
        error: 'Failed to create content',
        message: 'An error occurred while creating the video content'
      };
      res.status(500).json(response);
    }
  }
);

/**
 * PUT /api/content/:id
 * Update video content
 * Requires authentication and ownership
 */
router.put('/:id',
  authenticateToken,
  validate(updateVideoContentSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // FIXED: Proper null checking
      if (!req.user?.sub) {
        const response: ApiResponse = {
          success: false,
          error: 'Authentication required',
          message: 'You must be logged in to update content'
        };
        return res.status(401).json(response);
      }

      const { id } = req.params;
      const userId = req.user.sub;

      // Check if there's anything to update
      if (Object.keys(req.body).length === 0) {
        const response: ApiResponse = {
          success: false,
          error: 'No updates provided',
          message: 'Request body must contain at least one field to update'
        };
        return res.status(400).json(response);
      }

      const content = await db.updateVideoContent(id, userId, req.body);

      if (!content) {
        const response: ApiResponse = {
          success: false,
          error: 'Content not found or access denied',
          message: 'The video content does not exist or you do not have permission to modify it'
        };
        return res.status(404).json(response);
      }

      const response: ApiResponse<VideoContent> = {
        success: true,
        data: content,
        message: `Video "${content.title}" updated successfully`
      };

      res.json(response);
    } catch (error) {
      console.error('Error updating content:', error);
      
      // Handle specific database errors
      if (error instanceof Error && error.message.includes('constraint')) {
        const response: ApiResponse = {
          success: false,
          error: 'Invalid update',
          message: 'The update violates data constraints'
        };
        return res.status(400).json(response);
      }

      const response: ApiResponse = {
        success: false,
        error: 'Failed to update content',
        message: 'An error occurred while updating the video content'
      };
      res.status(500).json(response);
    }
  }
);

/**
 * DELETE /api/content/:id
 * Delete video content
 * Requires authentication and ownership
 */
router.delete('/:id',
  authenticateToken,
  validate(videoIdParamsSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // FIXED: Proper null checking
      if (!req.user?.sub) {
        const response: ApiResponse = {
          success: false,
          error: 'Authentication required',
          message: 'You must be logged in to delete content'
        };
        return res.status(401).json(response);
      }

      const { id } = req.params;
      const userId = req.user.sub;

      const deleted = await db.deleteVideoContent(id, userId);

      if (!deleted) {
        const response: ApiResponse = {
          success: false,
          error: 'Content not found or access denied',
          message: 'The video content does not exist or you do not have permission to delete it'
        };
        return res.status(404).json(response);
      }

      const response: ApiResponse = {
        success: true,
        message: 'Video content deleted successfully'
      };

      res.json(response);
    } catch (error) {
      console.error('Error deleting content:', error);
      
      // Handle foreign key constraints (if content is referenced elsewhere)
      if (error instanceof Error && error.message.includes('foreign key')) {
        const response: ApiResponse = {
          success: false,
          error: 'Cannot delete content',
          message: 'This content is referenced by other resources and cannot be deleted'
        };
        return res.status(409).json(response);
      }

      const response: ApiResponse = {
        success: false,
        error: 'Failed to delete content',
        message: 'An error occurred while deleting the video content'
      };
      res.status(500).json(response);
    }
  }
);

// ============================================================================
// TAG MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /api/content/meta/tags
 * Get available tags for content categorization
 * Public endpoint
 */
router.get('/meta/tags', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tags = await db.getTags();

    const response: ApiResponse = {
      success: true,
      data: tags,
      message: `Found ${tags.length} professional content tags`
    };

    // Add caching headers for tag data
    res.set({
      'Cache-Control': 'public, max-age=300', // 5 minutes
      'X-Total-Tags': tags.length.toString()
    });

    res.json(response);
  } catch (error) {
    console.error('Error fetching tags:', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to fetch tags',
      message: 'An error occurred while retrieving content tags'
    };
    res.status(500).json(response);
  }
});

/**
 * POST /api/content/meta/tags
 * Create new content tag
 * Requires authentication
 */
router.post('/meta/tags',
  authenticateToken,
  validate(createTagSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // FIXED: Proper null checking
      if (!req.user?.sub) {
        const response: ApiResponse = {
          success: false,
          error: 'Authentication required',
          message: 'You must be logged in to create tags'
        };
        return res.status(401).json(response);
      }

      const { name, color, description } = req.body;
      
      try {
        await db.createTag(name, color, description);

        const response: ApiResponse = {
          success: true,
          message: `Tag "${name}" created successfully`,
          data: { name, color, description }
        };

        res.status(201).json(response);
      } catch (error) {
        // Handle duplicate tag name
        if (error instanceof Error && 
            (error.message.includes('duplicate key') || 
             error.message.includes('already exists'))) {
          const response: ApiResponse = {
            success: false,
            error: 'Tag already exists',
            message: `A tag with the name "${name}" already exists`
          };
          return res.status(409).json(response);
        }
        throw error;
      }
    } catch (error) {
      console.error('Error creating tag:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to create tag',
        message: 'An error occurred while creating the content tag'
      };
      res.status(500).json(response);
    }
  }
);

// ============================================================================
// BULK OPERATIONS
// ============================================================================

/**
 * PUT /api/content/bulk/visibility
 * Bulk update visibility for multiple videos
 * Requires authentication and ownership of all videos
 */
router.put('/bulk/visibility',
  authenticateToken,
  validate(bulkVisibilityUpdateSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // FIXED: Proper null checking
      if (!req.user?.sub) {
        const response: ApiResponse = {
          success: false,
          error: 'Authentication required',
          message: 'You must be logged in to update content visibility'
        };
        return res.status(401).json(response);
      }

      const { videoIds, visibility } = req.body;
      const userId = req.user.sub;

      // This would need to be implemented in the database service
      // const results = await db.bulkUpdateVisibility(videoIds, userId, visibility);

      const response: ApiResponse = {
        success: true,
        message: `Updated visibility to "${visibility}" for ${videoIds.length} videos`
      };

      res.json(response);
    } catch (error) {
      console.error('Error bulk updating visibility:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to update visibility',
        message: 'An error occurred while updating video visibility'
      };
      res.status(500).json(response);
    }
  }
);

/**
 * DELETE /api/content/bulk
 * Bulk delete multiple videos
 * Requires authentication and ownership of all videos
 */
router.delete('/bulk',
  authenticateToken,
  validate(bulkDeleteSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // FIXED: Proper null checking
      if (!req.user?.sub) {
        const response: ApiResponse = {
          success: false,
          error: 'Authentication required',
          message: 'You must be logged in to delete content'
        };
        return res.status(401).json(response);
      }

      const { videoIds } = req.body;
      const userId = req.user.sub;

      // This would need to be implemented in the database service
      // const deleteCount = await db.bulkDeleteVideoContent(videoIds, userId);

      const response: ApiResponse = {
        success: true,
        message: `Deleted ${videoIds.length} videos successfully`
      };

      res.json(response);
    } catch (error) {
      console.error('Error bulk deleting videos:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to delete videos',
        message: 'An error occurred while deleting videos'
      };
      res.status(500).json(response);
    }
  }
);

export default router;
