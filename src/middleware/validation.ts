// First, install Zod
// npm install zod

// src/middleware/validation.ts
import { Request, Response, NextFunction } from 'express'
import { ZodSchema, ZodError } from 'zod'

export const validateRequest = (schema: {
  body?: ZodSchema
  params?: ZodSchema
  query?: ZodSchema
}) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request body
      if (schema.body) {
        req.body = schema.body.parse(req.body)
      }

      // Validate URL parameters
      if (schema.params) {
        req.params = schema.params.parse(req.params)
      }

      // Validate query parameters
      if (schema.query) {
        req.query = schema.query.parse(req.query)
      }

      next()
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message,
            received: err.received
          }))
        })
      }
      next(error)
    }
  }
}

// src/schemas/videoContent.ts
import { z } from 'zod'

// Video content creation schema
export const createVideoContentSchema = z.object({
  title: z.string()
    .min(1, 'Title is required')
    .max(255, 'Title must be less than 255 characters')
    .trim(),
  description: z.string()
    .max(2000, 'Description must be less than 2000 characters')
    .optional(),
  filename: z.string()
    .min(1, 'Filename is required')
    .regex(/\.(mp4|mov|avi|webm)$/i, 'Invalid video file format'),
  fileSize: z.number()
    .positive('File size must be positive')
    .max(500 * 1024 * 1024, 'File size cannot exceed 500MB'), // 500MB limit
  videoUrl: z.string().url('Invalid video URL'),
  visibility: z.enum(['public', 'private', 'unlisted']).default('private'),
  tags: z.array(z.string().trim().min(1)).max(10, 'Maximum 10 tags allowed').optional(),
  mimeType: z.string().regex(/^video\//, 'Must be a video MIME type').optional(),
  duration: z.number().positive().optional(),
  thumbnailUrl: z.string().url().optional()
})

// Video content update schema (all fields optional)
export const updateVideoContentSchema = createVideoContentSchema.partial()

// URL parameters schema
export const videoIdParamsSchema = z.object({
  id: z.string().uuid('Invalid video ID format')
})

// Query parameters schema
export const videoListQuerySchema = z.object({
  page: z.string().transform(val => parseInt(val, 10)).refine(val => val > 0).default('1'),
  limit: z.string().transform(val => parseInt(val, 10)).refine(val => val > 0 && val <= 100).default('20'),
  status: z.enum(['uploading', 'processing', 'completed', 'failed']).optional(),
  visibility: z.enum(['public', 'private', 'unlisted']).optional(),
  search: z.string().max(100).optional(),
  sortBy: z.enum(['created_at', 'updated_at', 'title', 'file_size']).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
})

// Upload URL request schema
export const uploadUrlRequestSchema = z.object({
  filename: z.string()
    .min(1, 'Filename is required')
    .max(255, 'Filename too long')
    .regex(/\.(mp4|mov|avi|webm)$/i, 'Invalid video file format'),
  fileSize: z.number()
    .positive('File size must be positive')
    .max(500 * 1024 * 1024, 'File size cannot exceed 500MB')
})

// src/routes/content.ts - Updated with validation
import express from 'express'
import { validateRequest } from '../middleware/validation'
import {
  createVideoContentSchema,
  updateVideoContentSchema,
  videoIdParamsSchema,
  videoListQuerySchema
} from '../schemas/videoContent'

const router = express.Router()

// GET /api/content - List videos with validation
router.get('/',
  validateRequest({ query: videoListQuerySchema }),
  async (req, res, next) => {
    try {
      // req.query is now typed and validated
      const options = req.query
      const result = await db.listVideoContent(req.user?.sub, options)
      res.json(result)
    } catch (error) {
      next(error)
    }
  }
)

// POST /api/content - Create video with validation
router.post('/',
  validateRequest({ body: createVideoContentSchema }),
  async (req, res, next) => {
    try {
      // req.body is now typed and validated
      const videoData = { ...req.body, userId: req.user.sub }
      const result = await db.createVideoContent(videoData)
      res.status(201).json(result)
    } catch (error) {
      next(error)
    }
  }
)

// PUT /api/content/:id - Update video with validation
router.put('/:id',
  validateRequest({
    params: videoIdParamsSchema,
    body: updateVideoContentSchema
  }),
  async (req, res, next) => {
    try {
      const { id } = req.params
      const result = await db.updateVideoContent(id, req.user.sub, req.body)
      
      if (!result) {
        return res.status(404).json({ error: 'Video not found' })
      }
      
      res.json(result)
    } catch (error) {
      next(error)
    }
  }
)

// DELETE /api/content/:id - Delete video with validation
router.delete('/:id',
  validateRequest({ params: videoIdParamsSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params
      const deleted = await db.deleteVideoContent(id, req.user.sub)
      
      if (!deleted) {
        return res.status(404).json({ error: 'Video not found' })
      }
      
      res.status(204).send()
    } catch (error) {
      next(error)
    }
  }
)

export default router

// src/routes/upload.ts - Updated with validation
import express from 'express'
import { validateRequest } from '../middleware/validation'
import { uploadUrlRequestSchema } from '../schemas/videoContent'

const router = express.Router()

// POST /api/upload/url - Get upload URL with validation
router.post('/url',
  validateRequest({ body: uploadUrlRequestSchema }),
  async (req, res, next) => {
    try {
      const { filename, fileSize } = req.body
      const result = await getUploadUrl(filename, fileSize, req.user.sub)
      res.json(result)
    } catch (error) {
      next(error)
    }
  }
)

export default router
