// src/routes/upload.ts - StoryLofts Upload Management Routes (Migrated to Zod)
import { Router, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { authenticateToken } from '../middleware/auth';
import { validate } from '../middleware/validation';
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

// ============================================================================
// ZOD SCHEMAS - Upload Validation
// ============================================================================

// Base schemas for reuse
const uuidSchema = z.string().uuid('Invalid UUID format');
const fileNameSchema = z.string()
  .min(1, 'Filename is required')
  .max(500, 'Filename must be less than 500 characters')
  .trim();

const titleSchema = z.string()
  .min(1, 'Title is required')
  .max(500, 'Title must be less than 500 characters')
  .trim();

const descriptionSchema = z.string()
  .max(5000, 'Description must be less than 5000 characters')
  .trim()
  .optional();

const visibilitySchema = z.enum(['public', 'private', 'unlisted'])
  .default('private');

const tagsSchema = z.array(
  z.string()
    .trim()
    .min(1, 'Tag cannot be empty')
    .max(100, 'Tag must be less than 100 characters')
)
  .max(10, 'Maximum 10 tags allowed')
  .default([]);

const videoMimeTypeSchema = z.string()
  .regex(/^video\//, 'Must be a valid video MIME type')
  .optional();

const fileSizeSchema = z.number()
  .int('File size must be an integer')
  .min(1, 'File size must be positive')
  .max(2147483648, 'File size cannot exceed 2GB'); // 2GB limit

// Get upload URL schema
const getUploadUrlSchema = z.object({
  query: z.object({
    filename: fileNameSchema,
    fileSize: z.string()
      .transform(val => parseInt(val, 10))
      .refine(val => !isNaN(val) && val > 0 && val <= 2147483648, 'File size must be between 1 and 2GB')
      .optional(),
    mimeType: videoMimeTypeSchema,
    duration: z.string()
      .transform(val => parseFloat(val))
      .refine(val => !isNaN(val) && val > 0, 'Duration must be a positive number')
      .optional()
  })
});

// Direct upload schema (for form data validation)
const directUploadSchema = z.object({
  body: z.object({
    title: titleSchema,
    description: descriptionSchema,
    visibility: visibilitySchema,
    tags: z.union([
      z.string().transform(val => {
        try {
          const parsed = JSON.parse(val);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return val.split(',').map(tag => tag.trim()).filter(Boolean);
        }
      }),
      z.array(z.string())
    ]).pipe(tagsSchema)
  })
});

// Complete upload schema
const completeUploadSchema = z.object({
  body: z.object({
    fileName: fileNameSchema,
    fileId: z.string()
      .min(1, 'File ID is required')
      .trim(),
    title: titleSchema,
    description: descriptionSchema,
    visibility: visibilitySchema,
    tags: tagsSchema,
    fileSize: fileSizeSchema.optional(),
    mimeType: videoMimeTypeSchema,
    duration: z.number()
      .positive('Duration must be positive')
      .optional(),
    originalFilename: z.string()
      .max(500, 'Original filename too long')
      .optional()
  })
});

// Upload status schema
const uploadStatusSchema = z.object({
  params: z.object({
    id: uuidSchema
  }),
  query: z.object({
    includeMetadata: z.string()
      .transform(val => val.toLowerCase() === 'true')
      .optional()
      .default('false')
  })
});

// Upload deletion schema
const deleteUploadSchema = z.object({
  params: z.object({
    id: uuidSchema
  }),
  body: z.object({
    reason: z.string()
      .max(200, 'Reason must be less than 200 characters')
      .optional(),
    deleteFromStorage: z.boolean()
      .optional()
      .default(true)
  }).optional().default({})
});

// Bulk upload operations schema
const bulkUploadOperationSchema = z.object({
  body: z.object({
    uploadIds: z.array(uuidSchema)
      .min(1, 'At least one upload ID is required')
      .max(20, 'Cannot process more than 20 uploads at once'),
    action: z.enum(['cancel', 'retry', 'delete']),
    reason: z.string()
      .max(200, 'Reason must be less than 200 characters')
      .optional()
  })
});

// ============================================================================
// MULTER CONFIGURATION
// ============================================================================

// Configure multer for file uploads with enhanced validation
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxFileSize,
    files: 1, // Only one file at a time
    fields: 10, // Limit form fields
    fieldSize: 1024 * 1024 // 1MB per field
  },
  fileFilter: (req, file, cb) => {
    try {
      // Validate file extension
      const fileExtension = file.originalname.split('.').pop()?.toLowerCase();
      const allowedFormats = [...config.upload.allowedVideoFormats];
      
      if (!fileExtension || !allowedFormats.includes(fileExtension)) {
        return cb(new Error(`File format not allowed. Supported formats: ${allowedFormats.join(', ')}`));
      }

      // Validate MIME type
      if (!file.mimetype.startsWith('video/')) {
        return cb(new Error('Only video files are allowed'));
      }

      // Additional filename validation
      if (file.originalname.length > 500) {
        return cb(new Error('Filename is too long (max 500 characters)'));
      }

      // Check for potentially dangerous filenames
      const dangerousPatterns = /[<>:"/\\|?*\x00-\x1f]/;
      if (dangerousPatterns.test(file.originalname)) {
        return cb(new Error('Filename contains invalid characters'));
      }

      cb(null, true);
    } catch (error) {
      cb(error as Error);
    }
  }
});

// ============================================================================
// UPLOAD ROUTES
// ============================================================================

/**
 * GET /api/upload/url
 * Get a pre-signed upload URL for direct upload to Backblaze B2
 * Enhanced with comprehensive validation and metadata support
 */
router.get('/url', 
  authenticateToken,
  validate(getUploadUrlSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { filename, fileSize, mimeType, duration } = req.query as any;
      const userId = req.user!.sub;

      // Generate unique filename to prevent conflicts
      const fileExtension = filename.split('.').pop();
      const uniqueFilename = `${userId}/${Date.now()}_${uuidv4()}.${fileExtension}`;

      // Generate upload URL from Backblaze B2
      const uploadData = await backblazeService.getUploadUrl(userId, uniqueFilename);
      
      // Create upload session record for tracking
      const sessionId = uuidv4();
      const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now

      // Store upload session in database for tracking
      await db.createUploadSession({
        sessionId,
        userId,
        filename: uniqueFilename,
        originalFilename: filename,
        fileSize,
        mimeType,
        duration,
        expiresAt
      });

      const response: ApiResponse = {
        success: true,
        data: {
          uploadUrl: uploadData.uploadUrl,
          uploadId: sessionId,
          authorizationToken: uploadData.authorizationToken,
          fileName: uniqueFilename,
          fileId: uploadData.fileId,
          expiresAt: expiresAt.toISOString(),
          maxFileSize: config.upload.maxFileSize,
          allowedFormats: config.upload.allowedVideoFormats
        },
        message: 'Upload URL generated successfully'
      };

      // Add upload-specific headers
      res.set({
        'X-Upload-Session': sessionId,
        'X-Upload-Expires': expiresAt.toISOString(),
        'X-Max-File-Size': config.upload.maxFileSize.toString()
      });

      res.json(response);
    } catch (error) {
      console.error('Upload URL generation failed:', error);
      
      // Handle specific Backblaze errors
      if (error instanceof Error && error.message.includes('quota')) {
        const response: ApiResponse = {
          success: false,
          error: 'Storage quota exceeded',
          message: 'Your storage quota has been exceeded. Please contact support.'
        };
        return res.status(507).json(response);
      }

      const response: ApiResponse = {
        success: false,
        error: 'Failed to generate upload URL',
        message: 'An error occurred while generating the upload URL'
      };
      res.status(500).json(response);
    }
  }
);

/**
 * POST /api/upload/direct
 * Direct upload to our server (then to Backblaze B2)
 * Enhanced with comprehensive validation and error handling
 */
router.post('/direct', 
  authenticateToken,
  upload.single('video'),
  validate(directUploadSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.file) {
        const response: ApiResponse = {
          success: false,
          error: 'No file uploaded',
          message: 'Please select a video file to upload'
        };
        return res.status(400).json(response);
      }

      const userId = req.user!.sub;
      const { title, description, visibility, tags } = req.body;

      // Validate file size against config
      if (req.file.size > config.upload.maxFileSize) {
        const response: ApiResponse = {
          success: false,
          error: 'File too large',
          message: `File size exceeds the maximum limit of ${Math.round(config.upload.maxFileSize / 1024 / 1024)}MB`
        };
        return res.status(413).json(response);
      }

      // Generate unique filename
      const fileExtension = req.file.originalname.split('.').pop();
      const uniqueFilename = `${userId}/${Date.now()}_${uuidv4()}.${fileExtension}`;

      // Get upload URL from Backblaze
      const uploadData = await backblazeService.getUploadUrl(userId, uniqueFilename);

      // Upload file to Backblaze B2
      console.log(`📤 Uploading ${req.file.originalname} (${req.file.size} bytes) to Backblaze B2`);
      const uploadResult = await backblazeService.uploadFile(
        uploadData.uploadUrl,
        uploadData.authorizationToken,
        uniqueFilename,
        req.file.buffer,
        req.file.mimetype
      );

      console.log(`✅ Upload completed: ${uploadResult.fileId}`);

      // Create video content record in database
      const videoContent = await db.createVideoContent({
        userId,
        title,
        description: description || '',
        filename: uniqueFilename,
        originalFilename: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        videoUrl: await backblazeService.getPublicUrl(uniqueFilename),
        status: VideoStatus.PROCESSING, // Will be updated when processing completes
        visibility: visibility as VideoVisibility,
        tags: Array.isArray(tags) ? tags : [],
        fileId: uploadResult.fileId
      });

      const response: ApiResponse<VideoContent> = {
        success: true,
        data: videoContent,
        message: `Video "${title}" uploaded successfully`
      };

      // Add upload tracking headers
      res.set({
        'X-Upload-Id': videoContent.id,
        'X-File-Id': uploadResult.fileId,
        'X-Processing-Status': 'started'
      });

      res.status(201).json(response);

    } catch (error) {
      console.error('Direct upload failed:', error);
      
      // Handle specific errors
      if (error instanceof Error) {
        if (error.message.includes('file size') || error.message.includes('too large')) {
          const response: ApiResponse = {
            success: false,
            error: 'File too large',
            message: 'The uploaded file exceeds the maximum size limit'
          };
          return res.status(413).json(response);
        }

        if (error.message.includes('format') || error.message.includes('type')) {
          const response: ApiResponse = {
            success: false,
            error: 'Invalid file format',
            message: 'The uploaded file format is not supported'
          };
          return res.status(415).json(response);
        }

        if (error.message.includes('quota') || error.message.includes('storage')) {
          const response: ApiResponse = {
            success: false,
            error: 'Storage quota exceeded',
            message: 'Your storage quota has been exceeded'
          };
          return res.status(507).json(response);
        }
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
 * Enhanced with comprehensive metadata validation
 */
router.post('/complete',
  authenticateToken,
  validate(completeUploadSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.sub;
      const { 
        fileName, 
        fileId, 
        title, 
        description, 
        visibility, 
        tags,
        fileSize,
        mimeType,
        duration,
        originalFilename
      } = req.body;

      // Verify the upload session exists and belongs to the user
      const uploadSession = await db.getUploadSession(fileName, userId);
      if (!uploadSession) {
        const response: ApiResponse = {
          success: false,
          error: 'Invalid upload session',
          message: 'Upload session not found or has expired'
        };
        return res.status(404).json(response);
      }

      // Verify file exists in Backblaze
      try {
        await backblazeService.verifyFileExists(fileId);
      } catch (error) {
        const response: ApiResponse = {
          success: false,
          error: 'File verification failed',
          message: 'The uploaded file could not be verified in storage'
        };
        return res.status(422).json(response);
      }

      // Create video content record in database
      const videoContent = await db.createVideoContent({
        userId,
        title,
        description: description || '',
        filename: fileName,
        originalFilename: originalFilename || fileName.split('/').pop() || fileName,
        fileSize: fileSize || uploadSession.fileSize || 0,
        mimeType: mimeType || uploadSession.mimeType || 'video/mp4',
        videoUrl: await backblazeService.getPublicUrl(fileName),
        status: VideoStatus.PROCESSING,
        visibility: visibility as VideoVisibility,
        tags: Array.isArray(tags) ? tags : [],
        duration,
        fileId
      });

      // Clean up upload session
      await db.deleteUploadSession(uploadSession.sessionId);

      const response: ApiResponse<VideoContent> = {
        success: true,
        data: videoContent,
        message: `Upload of "${title}" completed successfully`
      };

      // Add completion tracking headers
      res.set({
        'X-Video-Id': videoContent.id,
        'X-Processing-Status': 'queued',
        'X-Upload-Session': 'completed'
      });

      res.status(201).json(response);

    } catch (error) {
      console.error('Upload completion failed:', error);
      
      if (error instanceof Error && error.message.includes('duplicate')) {
        const response: ApiResponse = {
          success: false,
          error: 'Duplicate upload',
          message: 'This file has already been uploaded'
        };
        return res.status(409).json(response);
      }

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
 * Enhanced with detailed progress tracking
 */
router.get('/status/:id', 
  authenticateToken,
  validate(uploadStatusSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { includeMetadata } = req.query as any;
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

      // Calculate progress and estimated completion time
      let progress = 0;
      let estimatedCompletion: string | null = null;
      let nextAction: string | null = null;

      switch (video.status) {
        case 'uploading':
          progress = 25;
          estimatedCompletion = new Date(Date.now() + 300000).toISOString(); // ~5 minutes
          nextAction = 'File upload in progress';
          break;
        case 'processing':
          progress = 75;
          estimatedCompletion = new Date(Date.now() + 600000).toISOString(); // ~10 minutes
          nextAction = 'Video processing and optimization';
          break;
        case 'ready':
          progress = 100;
          nextAction = 'Video is ready for viewing';
          break;
        case 'failed':
          progress = 0;
          nextAction = 'Upload failed - retry available';
          break;
      }

      const statusData: any = {
        id: video.id,
        status: video.status,
        title: video.title,
        progress,
        nextAction,
        estimatedCompletion,
        createdAt: video.createdAt,
        updatedAt: video.updatedAt
      };

      // Include additional metadata if requested
      if (includeMetadata) {
        statusData.metadata = {
          fileSize: video.fileSize,
          duration: video.duration,
          mimeType: video.mimeType,
          filename: video.filename,
          originalFilename: video.originalFilename,
          visibility: video.visibility,
          tags: video.tags
        };
      }

      const response: ApiResponse = {
        success: true,
        data: statusData,
        message: `Video status: ${video.status} (${progress}% complete)`
      };

      // Add status tracking headers
      res.set({
        'X-Video-Status': video.status,
        'X-Progress': progress.toString(),
        'X-Last-Updated': video.updatedAt?.toISOString() || video.createdAt.toISOString()
      });

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
  }
);

/**
 * DELETE /api/upload/:id
 * Cancel/delete an upload with optional storage cleanup
 * Enhanced with reason tracking and storage management
 */
router.delete('/:id', 
  authenticateToken,
  validate(deleteUploadSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { reason, deleteFromStorage } = req.body || {};
      const userId = req.user!.sub;

      // Get video details before deletion
      const video = await db.getVideoContent(id, userId);
      if (!video) {
        const response: ApiResponse = {
          success: false,
          error: 'Video not found or access denied',
          message: 'The video does not exist or you do not have permission to delete it'
        };
        return res.status(404).json(response);
      }

      // Delete from storage if requested and file exists
      if (deleteFromStorage && video.fileId) {
        try {
          await backblazeService.deleteFile(video.fileId, video.filename);
          console.log(`🗑️ Deleted file from storage: ${video.filename}`);
        } catch (storageError) {
          console.warn('Failed to delete file from storage:', storageError);
          // Continue with database deletion even if storage deletion fails
        }
      }

      // Delete from database
      const deleted = await db.deleteVideoContent(id, userId, reason);

      if (!deleted) {
        const response: ApiResponse = {
          success: false,
          error: 'Deletion failed',
          message: 'Failed to delete video from database'
        };
        return res.status(500).json(response);
      }

      const response: ApiResponse = {
        success: true,
        message: deleteFromStorage 
          ? 'Upload cancelled and video deleted from both database and storage'
          : 'Upload cancelled and video deleted from database'
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
  }
);

/**
 * POST /api/upload/bulk
 * Bulk operations on uploads (cancel, retry, delete)
 * New endpoint for managing multiple uploads
 */
router.post('/bulk',
  authenticateToken,
  validate(bulkUploadOperationSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { uploadIds, action, reason } = req.body;
      const userId = req.user!.sub;

      const results = [];
      let successCount = 0;
      let failureCount = 0;

      for (const uploadId of uploadIds) {
        try {
          let result;
          switch (action) {
            case 'cancel':
            case 'delete':
              result = await db.deleteVideoContent(uploadId, userId, reason);
              break;
            case 'retry':
              result = await db.retryVideoUpload(uploadId, userId);
              break;
            default:
              throw new Error(`Unsupported action: ${action}`);
          }

          if (result) {
            results.push({ id: uploadId, success: true });
            successCount++;
          } else {
            results.push({ id: uploadId, success: false, error: 'Not found or access denied' });
            failureCount++;
          }
        } catch (error) {
          results.push({ id: uploadId, success: false, error: error instanceof Error ? error.message : 'Unknown error' });
          failureCount++;
        }
      }

      const response: ApiResponse = {
        success: successCount > 0,
        data: {
          results,
          summary: {
            total: uploadIds.length,
            successful: successCount,
            failed: failureCount,
            action
          }
        },
        message: `Bulk ${action} completed: ${successCount} successful, ${failureCount} failed`
      };

      res.json(response);
    } catch (error) {
      console.error('Bulk upload operation failed:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Bulk operation failed',
        message: 'An error occurred while processing the bulk upload operation'
      };
      res.status(500).json(response);
    }
  }
);

/**
 * GET /api/upload/sessions
 * Get active upload sessions for the user
 * New endpoint for tracking ongoing uploads
 */
router.get('/sessions',
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.sub;
      const sessions = await db.getUserUploadSessions(userId);

      const response: ApiResponse = {
        success: true,
        data: sessions,
        message: `Found ${sessions.length} active upload sessions`
      };

      res.json(response);
    } catch (error) {
      console.error('Failed to get upload sessions:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to get upload sessions',
        message: 'An error occurred while retrieving upload sessions'
      };
      res.status(500).json(response);
    }
  }
);

export default router;
