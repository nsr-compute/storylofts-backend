// src/schemas/index.ts - Clean export file (no conflicts)
import { z } from 'zod';

// Base reusable schemas
export const uuidSchema = z.string().uuid('Invalid UUID format');

export const paginationSchema = z.object({
  page: z.string()
    .transform(val => parseInt(val, 10))
    .refine(val => !isNaN(val) && val > 0, 'Page must be a positive number')
    .default('1'),
  limit: z.string()
    .transform(val => parseInt(val, 10))
    .refine(val => !isNaN(val) && val > 0 && val <= 100, 'Limit must be between 1 and 100')
    .default('20')
});

// Video content schemas
export const createVideoContentSchema = z.object({
  body: z.object({
    title: z.string().min(1).max(255).trim(),
    description: z.string().max(2000).optional(),
    filename: z.string().min(1),
    fileSize: z.number().positive().max(524288000), // 500MB
    videoUrl: z.string().url(),
    visibility: z.enum(['public', 'private', 'unlisted']).default('private'),
    tags: z.array(z.string()).max(10).default([])
  })
});

export const updateVideoContentSchema = z.object({
  params: z.object({
    id: uuidSchema
  }),
  body: z.object({
    title: z.string().min(1).max(255).trim().optional(),
    description: z.string().max(2000).optional(),
    visibility: z.enum(['public', 'private', 'unlisted']).optional()
  })
});

export const videoIdParamsSchema = z.object({
  params: z.object({
    id: uuidSchema
  })
});

export const videoListQuerySchema = z.object({
  query: paginationSchema.extend({
    status: z.enum(['uploading', 'processing', 'completed', 'failed']).optional(),
    visibility: z.enum(['public', 'private', 'unlisted']).optional(),
    search: z.string().max(100).optional(),
    sortBy: z.enum(['created_at', 'updated_at', 'title', 'file_size']).default('created_at'),
    sortOrder: z.enum(['asc', 'desc']).default('desc')
  })
});
