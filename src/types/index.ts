// src/types/index.ts - TypeScript type definitions for StoryLofts
import { Request } from 'express';

export * from './auth';

export interface UserProfile {
  id: string;
  auth0Id: string;
  email: string;
  name: string;
  picture?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface VideoContent {
  id: string;
  userId: string;
  title: string;
  description?: string;
  filename: string;
  originalFilename?: string;
  fileSize: number;
  duration?: number;
  videoUrl: string;
  thumbnailUrl?: string;
  status: VideoStatus;
  visibility: VideoVisibility;
  mimeType?: string;
  resolution?: string; // e.g., "1920x1080"
  fps?: number;
  bitrate?: number;
  codec?: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface VideoContentInput {
  userId: string;
  title: string;
  description?: string;
  filename: string;
  originalFilename?: string;
  fileSize: number;
  duration?: number;
  videoUrl: string;
  thumbnailUrl?: string;
  status?: VideoStatus;
  visibility?: VideoVisibility;
  mimeType?: string;
  resolution?: string;
  fps?: number;
  bitrate?: number;
  codec?: string;
  tags?: string[];
}

export enum VideoStatus {
  UPLOADING = 'uploading',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed'
}

export enum VideoVisibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
  UNLISTED = 'unlisted'
}

export interface UploadProgress {
  id: string;
  userId: string;
  filename: string;
  uploadedBytes: number;
  totalBytes: number;
  status: UploadStatus;
  createdAt: Date;
}

export enum UploadStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface Collection {
  id: string;
  userId: string;
  name: string;
  description?: string;
  visibility: VideoVisibility;
  thumbnailUrl?: string;
  videoCount: number;
  totalDuration: number; // in seconds
  createdAt: Date;
  updatedAt: Date;
}

export interface Tag {
  id: string;
  name: string;
  slug: string;
  color: string;
  createdAt: Date;
}

export interface UploadSession {
  id: string;
  userId: string;
  filename: string;
  fileSize?: number;
  mimeType?: string;
  b2UploadId?: string;
  status: 'initiated' | 'uploading' | 'completed' | 'failed' | 'cancelled';
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  services: {
    database: {
      status: 'healthy' | 'unhealthy';
      responseTime: number;
      error?: string;
    };
    auth0: {
      status: 'healthy' | 'unhealthy';
      responseTime: number;
      error?: string;
    };
    storage: {
      status: 'healthy' | 'unhealthy';
      responseTime: number;
      error?: string;
    };
  };
}

// Upload related types
export interface UploadUrlRequest {
  filename: string;
  fileSize: number;
  mimeType: string;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  uploadId: string;
  expiresAt: string;
}

export interface CompleteUploadRequest {
  uploadId: string;
  title: string;
  description?: string;
  visibility?: VideoVisibility;
  tags?: string[];
}

// Query options for listing content
export interface VideoListOptions {
  page?: number;
  limit?: number;
  status?: VideoStatus;
  visibility?: VideoVisibility;
  tags?: string[];
  search?: string;
  sortBy?: 'created_at' | 'updated_at' | 'title' | 'duration';
  sortOrder?: 'asc' | 'desc';
}

// Express Request extension for authenticated user
export interface AuthenticatedRequest extends Request {
  user?: {
    sub: string;
    email: string;
    name: string;
    picture?: string;
  };
  auth?: any; // JWT payload from express-jwt
}
