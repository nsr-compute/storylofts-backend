// src/routes/content.ts - StoryLofts Content Management Routes
import { Router, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { authenticateToken } from '../middleware/auth';
import { db } from '../services/database';
import { 
  ApiResponse, 
  VideoContent, 
  VideoListOptions, 
  AuthenticatedRequest,
  VideoStatus,
  VideoVisibility 
} from '../types';

const router = Router();

/**
 * GET /api/content
 * List video content with filtering, pagination, and search
 * Public endpoint for public content, authenticated for user content
 */
router.get('/', [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('status').optional().isIn(['uploading', 'processing', 'ready', 'failed']),
  query('visibility').optional().isIn(['public', 'private', 'unlisted']),
  query('tags').optional().isString(),
  query('search').optional().isString().trim(),
  query('sortBy').optional().isIn(['created_at', 'updated_at', 'title', 'duration']),
  query('sortOrder').optional().isIn(['asc', 'desc'])
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const response: ApiResponse = {
        success: false,
        error: 'Validation failed',
        data: errors.array()
      };
      return res.status(400).json(response);
    }

    const options: VideoListOptions = {
      page: (req.query.page as any) || 1,
      limit: (req.query.limit as any) || 20,
      status: req.query.status as VideoStatus,
      visibility: req.query.visibility as VideoVisibility,
      search: req.query.search as string,
      sortBy: (req.query.sortBy as any) || 'created_at',
      sortOrder: (req.query.sortOrder as any) || 'desc'
    };

    // Parse tags if provided
    if (req.query.tags) {
      options.tags = (req.query.tags as string).split(',').map(tag => tag.trim()).filter(Boolean);
    }

    // Get user ID from token if authenticated
    const userId = req.user?.sub;

    const result = await db.listVideoContent(userId, options);

    const response: ApiResponse = {
      success: true,
      data: result
    };

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
});

/**
 * GET /api/content/:id
 * Get specific video content by ID
 * Public for public content, authenticated for private content
 */
router.get('/:id', [
  param('id').isUUID().withMessage('Valid UUID required for content ID')
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const response: ApiResponse = {
        success: false,
        error: 'Invalid content ID',
        data: errors.array()
      };
      return res.status(400).json(response);
    }

    const { id } = req.params;
    const userId = req.user?.sub; // Optional for public content

    const content = await db.getVideoContent(id, userId);

    if (!content) {
      const response: ApiResponse = {
        success: false,
        error: 'Content not found',
        message: 'The requested video content does not exist or you do not have permission to view it'
      };
      return res.status(404).json(response);
    }

    const response: ApiResponse<VideoContent> = {
      success: true,
      data: content
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
});

/**
 * POST /api/content
 * Create new video content
 * Requires authentication
 */
router.post('/', authenticateToken, [
  body('title')
    .isString()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('Title is required and must be between 1 and 500 characters'),
  body('description')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 5000 })
    .withMessage('Description must be less than 5000 characters'),
  body('filename')
    .isString()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('Filename is required and must be between 1 and 500 characters'),
  body('originalFilename')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Original filename must be less than 500 characters'),
  body('fileSize')
    .isInt({ min: 1 })
    .withMessage('File size must be a positive integer'),
  body('duration')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Duration must be a non-negative integer'),
  body('videoUrl')
    .isURL()
    .withMessage('Valid video URL is required'),
  body('thumbnailUrl')
    .optional()
    .isURL()
    .withMessage('Thumbnail URL must be a valid URL'),
  body('status')
    .optional()
    .isIn(['uploading', 'processing', 'ready', 'failed'])
    .withMessage('Status must be one of: uploading, processing, ready, failed'),
  body('visibility')
    .optional()
    .isIn(['public', 'private', 'unlisted'])
    .withMessage('Visibility must be one of: public, private, unlisted'),
  body('mimeType')
    .optional()
    .isString()
    .matches(/^video\//)
    .withMessage('MIME type must be a valid video type'),
  body('resolution')
    .optional()
    .matches(/^\d+x\d+$/)
    .withMessage('Resolution must be in format WIDTHxHEIGHT (e.g., 1920x1080)'),
  body('fps')
    .optional()
    .isInt({ min: 1, max: 120 })
    .withMessage('FPS must be between 1 and 120'),
  body('bitrate')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Bitrate must be a positive integer'),
  body('codec')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Codec must be less than 50 characters'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),
  body('tags.*')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Each tag must be between 1 and 100 characters')
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const response: ApiResponse = {
        success: false,
        error: 'Validation failed',
        data: errors.array()
      };
      return res.status(400).json(response);
    }

    const userId = req.user!.sub;
    const contentInput = {
      ...req.body,
      userId
    };

    const content = await db.createVideoContent(contentInput);

    const response: ApiResponse<VideoContent> = {
      success: true,
      data: content,
      message: 'Video content created successfully'
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Error creating content:', error);
    
    // Handle specific database errors
    if (error instanceof Error && error.message.includes('duplicate key')) {
      const response: ApiResponse = {
        success: false,
        error: 'Duplicate content',
        message: 'Content with this identifier already exists'
      };
      return res.status(409).json(response);
    }

    const response: ApiResponse = {
      success: false,
      error: 'Failed to create content',
      message: 'An error occurred while creating the video content'
    };
    res.status(500).json(response);
  }
});

/**
 * PUT /api/content/:id
 * Update video content
 * Requires authentication and ownership
 */
router.put('/:id', authenticateToken, [
  param('id').isUUID().withMessage('Valid UUID required for content ID'),
  body('title')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('Title must be between 1 and 500 characters'),
  body('description')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 5000 })
    .withMessage('Description must be less than 5000 characters'),
  body('duration')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Duration must be a non-negative integer'),
  body('thumbnailUrl')
    .optional()
    .isURL()
    .withMessage('Thumbnail URL must be a valid URL'),
  body('status')
    .optional()
    .isIn(['uploading', 'processing', 'ready', 'failed'])
    .withMessage('Status must be one of: uploading, processing, ready, failed'),
  body('visibility')
    .optional()
    .isIn(['public', 'private', 'unlisted'])
    .withMessage('Visibility must be one of: public, private, unlisted'),
  body('resolution')
    .optional()
    .matches(/^\d+x\d+$/)
    .withMessage('Resolution must be in format WIDTHxHEIGHT'),
  body('fps')
    .optional()
    .isInt({ min: 1, max: 120 })
    .withMessage('FPS must be between 1 and 120'),
  body('bitrate')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Bitrate must be a positive integer'),
  body('codec')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Codec must be less than 50 characters'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),
  body('tags.*')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Each tag must be between 1 and 100 characters')
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const response: ApiResponse = {
        success: false,
        error: 'Validation failed',
        data: errors.array()
      };
      return res.status(400).json(response);
    }

    const { id } = req.params;
    const userId = req.user!.sub;

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
      message: 'Video content updated successfully'
    };

    res.json(response);
  } catch (error) {
    console.error('Error updating content:', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to update content',
      message: 'An error occurred while updating the video content'
    };
    res.status(500).json(response);
  }
});

/**
 * DELETE /api/content/:id
 * Delete video content
 * Requires authentication and ownership
 */
router.delete('/:id', authenticateToken, [
  param('id').isUUID().withMessage('Valid UUID required for content ID')
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const response: ApiResponse = {
        success: false,
        error: 'Invalid content ID',
        data: errors.array()
      };
      return res.status(400).json(response);
    }

    const { id } = req.params;
    const userId = req.user!.sub;

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
    const response: ApiResponse = {
      success: false,
      error: 'Failed to delete content',
      message: 'An error occurred while deleting the video content'
    };
    res.status(500).json(response);
  }
});

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

    res.json(
