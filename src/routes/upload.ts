import { Router } from 'express';
import multer from 'multer';
import { body, validationResult } from 'express-validator';
import { requireAuth } from '../middleware/auth';
import { backblazeService } from '../services/backblaze';
import { config } from '../config';
import { AuthenticatedRequest, ApiResponse, VideoContent, VideoStatus, VideoVisibility } from '../types';
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

// In-memory storage for video metadata (replace with database)
const videoStorage = new Map<string, VideoContent>();

/**
 * GET /api/upload/url
 * Get a pre-signed upload URL for direct upload to Backblaze B2
 */
router.get('/url', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { filename } = req.query;
    
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Filename is required'
      } as ApiResponse);
    }

    const userId = req.user!.sub;
    const uploadData = await backblazeService.getUploadUrl(userId, filename);
    
    res.json({
      success: true,
      data: {
        uploadUrl: uploadData.uploadUrl,
        authorizationToken: uploadData.authorizationToken,
        fileName: uploadData.fileName,
        fileId: uploadData.fileId,
        expiresAt: new Date(Date.now() + 3600000) // 1 hour from now
      }
    } as ApiResponse);
  } catch (error) {
    console.error('Upload URL generation failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate upload URL'
    } as ApiResponse);
  }
});

/**
 * POST /api/upload/direct
 * Direct upload to our server (then to Backblaze B2)
 */
router.post('/direct', 
  requireAuth,
  upload.single('video'),
  [
    body('title').isLength({ min: 1, max: 255 }).withMessage('Title is required and must be less than 255 characters'),
    body('description').optional().isLength({ max: 1000 }).withMessage('Description must be less than 1000 characters'),
    body('visibility').optional().isIn(['public', 'private', 'unlisted']).withMessage('Invalid visibility setting'),
    body('tags').optional().isArray().withMessage('Tags must be an array')
  ],
  async (req: AuthenticatedRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          data: errors.array()
        } as ApiResponse);
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded'
        } as ApiResponse);
      }

      const userId = req.user!.sub;
      const { title, description, visibility = 'private', tags = [] } = req.body;

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

      // Create video record
      const videoId = uuidv4();
      const videoContent: VideoContent = {
        id: videoId,
        userId,
        title,
        description: description || '',
        filename: uploadData.fileName,
        originalFilename: req.file.originalname,
        fileSize: req.file.size,
        duration: undefined, // Will be filled by video processing
        mimeType: req.file.mimetype,
        thumbnailUrl: undefined,
        videoUrl: await backblazeService.getPublicUrl(uploadData.fileName),
        status: VideoStatus.READY, // In production, this would be PROCESSING
        visibility: visibility as VideoVisibility,
        tags: Array.isArray(tags) ? tags : [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Store video metadata (replace with database)
      videoStorage.set(videoId, videoContent);

      res.status(201).json({
        success: true,
        data: videoContent
      } as ApiResponse<VideoContent>);

    } catch (error) {
      console.error('Direct upload failed:', error);
      res.status(500).json({
        success: false,
        error: 'Upload failed'
      } as ApiResponse);
    }
  }
);

/**
 * POST /api/upload/complete
 * Complete upload process after direct B2 upload
 */
router.post('/complete',
  requireAuth,
  [
    body('fileName').isString().withMessage('File name is required'),
    body('fileId').isString().withMessage('File ID is required'),
    body('title').isLength({ min: 1, max: 255 }).withMessage('Title is required'),
    body('description').optional().isLength({ max: 1000 }),
    body('visibility').optional().isIn(['public', 'private', 'unlisted']),
    body('tags').optional().isArray()
  ],
  async (req: AuthenticatedRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          data: errors.array()
        } as ApiResponse);
      }

      const userId = req.user!.sub;
      const { fileName, fileId, title, description, visibility = 'private', tags = [] } = req.body;

      // Create video record
      const videoId = uuidv4();
      const videoContent: VideoContent = {
        id: videoId,
        userId,
        title,
        description: description || '',
        filename: fileName,
        originalFilename: fileName.split('/').pop() || fileName,
        fileSize: 0, // Will be updated by processing
        duration: undefined,
        mimeType: 'video/mp4', // Default, will be updated
        thumbnailUrl: undefined,
        videoUrl: await backblazeService.getPublicUrl(fileName),
        status: VideoStatus.PROCESSING,
        visibility: visibility as VideoVisibility,
        tags: Array.isArray(tags) ? tags : [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Store video metadata (replace with database)
      videoStorage.set(videoId, videoContent);

      res.status(201).json({
        success: true,
        data: videoContent
      } as ApiResponse<VideoContent>);

    } catch (error) {
      console.error('Upload completion failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to complete upload'
      } as ApiResponse);
    }
  }
);

/**
 * GET /api/upload/status/:id
 * Get upload/processing status
 */
router.get('/status/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.sub;
    
    const video = videoStorage.get(id);
    
    if (!video) {
      return res.status(404).json({
        success: false,
        error: 'Video not found'
      } as ApiResponse);
    }

    if (video.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      } as ApiResponse);
    }

    res.json({
      success: true,
      data: {
        id: video.id,
        status: video.status,
        title: video.title,
        progress: video.status === VideoStatus.READY ? 100 : 
                 video.status === VideoStatus.PROCESSING ? 50 : 0
      }
    } as ApiResponse);

  } catch (error) {
    console.error('Status check failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get upload status'
    } as ApiResponse);
  }
});

export { router as uploadRouter };
export { videoStorage }; // Export for use in other routes