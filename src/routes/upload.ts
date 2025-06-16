// src/routes/upload.ts - StoryLofts Upload Management Routes
import { Router, Response } from 'express';
import multer from 'multer';
import { body, query, param, validationResult } from 'express-validator';
import { authenticateToken } from '../middleware/auth';
import { backblazeService } from '../services/backblaze';
import { db } from '../services/database';
import { config } from '../config';
import { 
  AuthenticatedRequest, 
  ApiResponse, 
  VideoContent, 
  VideoStatus, 
  VideoVisibility 
} from '../types';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxFileSize
  },
  fileFilter: (req, file, cb) => {
    const fileExtension = file.originalname.split('.').pop()?.toLowerCase();
    const allowedFormats = [...config.upload.allowedVideoFormats, ...config.upload.allowedImageFormats];
    
    if (fileExtension && allowedFormats.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error(`File format not allowed. Supported formats: ${allowedFormats.join(', ')}`));
    }
  }
});

/**
 * GET /api/upload/url
 * Get a pre-signed upload URL for direct upload to Backblaze B2
 * Requires authentication
 */
router.get('/url', authenticateToken, [
  query('filename')
    .isString()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('Filename is required and must be between 1 and 500 characters'),
  query('fileSize')
    .optional()
    .isInt({ min: 1 })
    .withMessage('File size must be a positive integer'),
  query('mimeType')
    .optional()
    .isString()
    .matches(/^video\//)
    .withMessage('MIME type must be a valid video type')
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

    const { filename, fileSize, mimeType } = req.query;
    const userId = req.user!.sub;

    // Generate upload URL from Backblaze B2
    const uploadData = await backblazeService.getUploadUrl(userId, filename as string);
    
    // Create upload session record
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now

    const response: ApiResponse = {
      success: true,
      data: {
        uploadUrl: uploadData.uploadUrl,
        uploadId: sessionId,
        authorizationToken: uploadData.authorizationToken,
        fileName: uploadData.fileName,
        fileId: uploadData.fileId,
        expiresAt: expiresAt.toISOString()
      },
      message: 'Upload URL generated successfully'
    };

    res.json(response);
  } catch (error) {
    console.error('Upload URL generation failed:', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to generate upload URL',
      message: 'An error occurred while generating the upload URL'
    };
    res.status(500).json(response);
  }
});

/**
 * POST /api/upload/direct
 * Direct upload to our server (then to Backblaze B2)
 * Requires authentication
 */
router.post('/direct', 
  authenticateToken,
  upload.single('video'),
  [
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
    body('visibility')
      .optional()
      .isIn(['public', 'private', 'unlisted'])
      .withMessage('Visibility must be one of: public, private, unlisted'),
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
  ],
  async (req: AuthenticatedRequest, res: Response) => {
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

      if (!req.file) {
        const response: ApiResponse = {
          success: false,
          error: 'No file uploaded',
          message: 'Please select a video file to upload'
        };
        return res.status(400).json(response);
      }

      const userId = req.user!.sub;
      const { title, description, visibility = 'private', tags = [] } = req.body;

      // Check file size
      if (req.file.size > config.upload.maxFileSize) {
        const response: ApiResponse = {
          success: false,
          error: 'File too large',
          message: `File size exceeds the maximum limit of ${Math.round(config.upload.maxFileSize / 1024 / 1024 / 1024)}GB`
        };
        return res.status(413).json(response);
      }

      // Get upload URL from Backblaze
      const uploadData = await backblazeService.getUploadUrl(userId, req.file.originalname);

      // Upload file to Backblaze B2
      const uploadResult = await backblazeService.uploadFile(
        uploadData.uploadUrl,
        uploadData.authorizationToken,
        uploadData.fileName,
        req.file.buffer,
        req.file.mimetype
      );

      // Create video content record in database
      const videoContent = await db.createVideoContent({
        userId,
        title,
        description: description || '',
        filename: uploadData.fileName,
        originalFilename: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        videoUrl: await backblazeService.getPublicUrl(uploadData.fileName),
        status: 'ready', // In production, this might be 'processing'
        visibility: visibility as VideoVisibility,
        tags: Array.isArray(tags) ? tags : []
      });

      const response: ApiResponse<VideoContent> = {
        success: true,
        data: videoContent,
        message: 'Video uploaded successfully'
      };

      res.status(201).json(response);

    } catch (error) {
      console.error('Direct upload failed:', error);
      
      // Handle specific errors
      if (error instanceof Error && error.message.includes('file size')) {
        const response: ApiResponse = {
          success: false,
          error: 'File too large',
          message: 'The uploaded file exceeds the maximum size limit'
        };
        return res.status(413).json(response);
      }

      const response: ApiResponse = {
        success: false,
        error: 'Upload failed',
        message: 'An error occurred while uploading the video'
      };
      res.status(500).json(response);
    }
  }
);

/**
 * POST /api/upload/complete
 * Complete upload process after direct B2 upload
 * Requires authentication
 */
router.post('/complete',
  authenticateToken,
  [
    body('fileName')
      .isString()
      .trim()
      .isLength({ min: 1, max: 500 })
      .withMessage('File name is required and must be between 1 and 500 characters'),
    body('fileId')
      .isString()
      .trim()
      .withMessage('File ID is required'),
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
    body('visibility')
      .optional()
      .isIn(['public', 'private', 'unlisted'])
      .withMessage('Visibility must be one of: public, private, unlisted'),
    body('tags')
      .optional()
      .isArray()
      .withMessage('Tags must be an array'),
    body('tags.*')
      .optional()
      .isString()
      .trim()
      .isLength({ min: 1, max: 100 })
      .withMessage('Each tag must be between 1 and 100 characters'),
    body('fileSize')
      .optional()
      .isInt({ min: 1 })
      .withMessage('File size must be a positive integer'),
    body('mimeType')
      .optional()
      .isString()
      .matches(/^video\//)
      .withMessage('MIME type must be a valid video type')
  ],
  async (req: AuthenticatedRequest, res: Response) => {
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
      const { 
        fileName, 
        fileId, 
        title, 
        description, 
        visibility = 'private', 
        tags = [],
        fileSize,
        mimeType 
      } = req.body;

      // Create video content record in database
      const videoContent = await db.createVideoContent({
        userId,
        title,
        description: description || '',
        filename: fileName,
        originalFilename: fileName.split('/').pop() || fileName,
        fileSize: fileSize || 0,
        mimeType: mimeType || 'video/mp4',
        videoUrl: await backblazeService.getPublicUrl(fileName),
        status: 'processing', // Will be updated when processing completes
        visibility: visibility as VideoVisibility,
        tags: Array.isArray(tags) ? tags : []
      });

      const response: ApiResponse<VideoContent> = {
        success: true,
        data: videoContent,
        message: 'Upload completed successfully'
      };

      res.status(201).json(response);

    } catch (error) {
      console.error('Upload completion failed:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to complete upload',
        message: 'An error occurred while completing the upload process'
      };
      res.status(500).json(response);
    }
  }
);

/**
 * GET /api/upload/status/:id
 * Get upload/processing status for a video
 * Requires authentication and ownership
 */
router.get('/status/:id', authenticateToken, [
  param('id').isUUID().withMessage('Valid UUID required for video ID')
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const response: ApiResponse = {
        success: false,
        error: 'Invalid video ID',
        data: errors.array()
      };
      return res.status(400).json(response);
    }

    const { id } = req.params;
    const userId = req.user!.sub;
    
    const video = await db.getVideoContent(id, userId);
    
    if (!video) {
      const response: ApiResponse = {
        success: false,
        error: 'Video not found',
        message: 'The requested video does not exist or you do not have permission to view it'
      };
      return res.status(404).json(response);
    }

    if (video.userId !== userId) {
      const response: ApiResponse = {
        success: false,
        error: 'Access denied',
        message: 'You do not have permission to view this video status'
      };
      return res.status(403).json(response);
    }

    // Calculate progress based on status
    let progress = 0;
    switch (video.status) {
      case 'uploading':
        progress = 25;
        break;
      case 'processing':
        progress = 75;
        break;
      case 'ready':
        progress = 100;
        break;
      case 'failed':
        progress = 0;
        break;
    }

    const response: ApiResponse = {
      success: true,
      data: {
        id: video.id,
        status: video.status,
        title: video.title,
        progress,
        fileSize: video.fileSize,
        duration: video.duration,
        createdAt: video.createdAt,
        updatedAt: video.updatedAt
      },
      message: `Video status: ${video.status}`
    };

    res.json(response);

  } catch (error) {
    console.error('Status check failed:', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to get upload status',
      message: 'An error occurred while checking the video status'
    };
    res.status(500).json(response);
  }
});

/**
 * DELETE /api/upload/:id
 * Cancel/delete an upload
 * Requires authentication and ownership
 */
router.delete('/:id', authenticateToken, [
  param('id').isUUID().withMessage('Valid UUID required for video ID')
], async (req: AuthenticatedRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const response: ApiResponse = {
        success: false,
        error: 'Invalid video ID',
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
        error: 'Video not found or access denied',
        message: 'The video does not exist or you do not have permission to delete it'
      };
      return res.status(404).json(response);
    }

    const response: ApiResponse = {
      success: true,
      message: 'Upload cancelled and video deleted successfully'
    };

    res.json(response);
  } catch (error) {
    console.error('Upload cancellation failed:', error);
    const response: ApiResponse = {
      success: false,
      error: 'Failed to cancel upload',
      message: 'An error occurred while cancelling the upload'
    };
    res.status(500).json(response);
  }
});

export default router;
