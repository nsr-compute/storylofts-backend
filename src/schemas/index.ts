// src/schemas/index.ts - Centralized validation schemas
import { z } from 'zod'

// Base schemas for common patterns
export const uuidSchema = z.string().uuid('Invalid UUID format')
export const paginationSchema = z.object({
  page: z.string().transform(val => Math.max(1, parseInt(val, 10) || 1)),
  limit: z.string().transform(val => Math.min(100, Math.max(1, parseInt(val, 10) || 20)))
})

// Video content schemas
export const createVideoSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title too long').trim(),
  description: z.string().max(2000, 'Description too long').optional(),
  filename: z.string().min(1, 'Filename required').regex(/\.(mp4|mov|avi|webm|mkv)$/i, 'Invalid video format'),
  fileSize: z.number().positive().max(2 * 1024 * 1024 * 1024, 'File too large (max 2GB)'),
  videoUrl: z.string().url('Invalid video URL'),
  visibility: z.enum(['public', 'private', 'unlisted']).default('private'),
  tags: z.array(z.string().trim().min(1)).max(10, 'Maximum 10 tags').optional(),
  mimeType: z.string().regex(/^video\//, 'Must be video MIME type').optional(),
  duration: z.number().positive().optional(),
  thumbnailUrl: z.string().url().optional(),
  resolution: z.string().optional(),
  fps: z.number().positive().optional(),
  bitrate: z.number().positive().optional(),
  codec: z.string().optional()
})

export const updateVideoSchema = createVideoSchema.partial()

export const videoQuerySchema = z.object({
  ...paginationSchema.shape,
  status: z.enum(['uploading', 'processing', 'ready', 'failed']).optional(),
  visibility: z.enum(['public', 'private', 'unlisted']).optional(),
  tags: z.string().transform(val => val.split(',').map(t => t.trim()).filter(Boolean)).optional(),
  search: z.string().max(100).optional(),
  sortBy: z.enum(['created_at', 'updated_at', 'title', 'duration', 'file_size']).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
})

// Upload schemas
export const uploadRequestSchema = z.object({
  filename: z.string().min(1).max(255).regex(/\.(mp4|mov|avi|webm|mkv)$/i, 'Invalid video format'),
  fileSize: z.number().positive().max(2 * 1024 * 1024 * 1024, 'File too large (max 2GB)'),
  contentType: z.string().regex(/^video\//, 'Must be video content type').optional()
})

// Search schema
export const searchQuerySchema = z.object({
  q: z.string().min(1, 'Search query required').max(100, 'Query too long'),
  ...paginationSchema.shape,
  visibility: z.enum(['public', 'private', 'unlisted']).optional(),
  tags: z.string().transform(val => val.split(',').map(t => t.trim()).filter(Boolean)).optional(),
  minDuration: z.string().transform(val => parseInt(val, 10)).optional(),
  maxDuration: z.string().transform(val => parseInt(val, 10)).optional()
})

// Enhanced route example with validation
// src/routes/content.ts (partial update to show integration)
import express from 'express'
import { validateRequest } from '../middleware/validation'
import { authenticateToken } from '../middleware/auth'
import { 
  createVideoSchema, 
  updateVideoSchema, 
  videoQuerySchema,
  uuidSchema 
} from '../schemas'

const router = express.Router()

// GET /api/content - List videos with validation
router.get('/',
  validateRequest({ query: videoQuerySchema }),
  async (req, res, next) => {
    try {
      // req.query is now validated and transformed
      const userId = req.user?.sub // Optional user context
      const result = await db.listVideoContent(userId, req.query)
      res.json({ success: true, data: result })
    } catch (error) {
      next(error)
    }
  }
)

// POST /api/content - Create video (authenticated)
router.post('/',
  authenticateToken,
  validateRequest({ body: createVideoSchema }),
  async (req, res, next) => {
    try {
      const videoData = { ...req.body, userId: req.user.sub }
      const result = await db.createVideoContent(videoData)
      res.status(201).json({ success: true, data: result })
    } catch (error) {
      next(error)
    }
  }
)

// PUT /api/content/:id - Update video (authenticated + ownership)
router.put('/:id',
  authenticateToken,
  validateRequest({ 
    params: z.object({ id: uuidSchema }),
    body: updateVideoSchema 
  }),
  async (req, res, next) => {
    try {
      const { id } = req.params
      const result = await db.updateVideoContent(id, req.user.sub, req.body)
      
      if (!result) {
        return res.status(404).json({ 
          success: false, 
          error: 'Video not found or access denied' 
        })
      }
      
      res.json({ success: true, data: result })
    } catch (error) {
      next(error)
    }
  }
)

export default routerß