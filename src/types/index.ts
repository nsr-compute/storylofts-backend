// src/types/index.ts - TypeScript type definitions for StoryLofts
import { Request } from 'express';

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
  originalFilename: string;
  fileSize: number;
  duration?: number;
  mimeType: string;
  thumbnailUrl?: string;
  videoUrl: string;
  status: VideoStatus;
  visibility: VideoVisibility;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
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

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface UploadUrlResponse {
  uploadUrl: string;
  uploadId: string;
  expiresAt: Date;
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