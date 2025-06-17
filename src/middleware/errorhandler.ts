// src/middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'

interface CustomError extends Error {
  statusCode?: number
  code?: string
  details?: any
}

interface ErrorResponse {
  error: string
  message: string
  statusCode: number
  timestamp: string
  path: string
  requestId?: string
}

export const errorHandler = (
  err: CustomError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Generate unique request ID for tracking
  const requestId = req.headers['x-request-id'] || generateRequestId()
  
  // Log error details for debugging
  logError(err, req, requestId)

  // Determine error details
  const errorResponse = buildErrorResponse(err, req, requestId)

  // Send response
  res.status(errorResponse.statusCode).json(errorResponse)
}

const logError = (err: CustomError, req: Request, requestId: string | string[]) => {
  const errorDetails = {
    requestId,
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.method !== 'GET' ? sanitizeBody(req.body) : undefined,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
      statusCode: err.statusCode,
      code: err.code
    }
  }

  if (process.env.NODE_ENV === 'production') {
    // In production, log structured data without stack traces in client responses
    console.error('API Error:', JSON.stringify(errorDetails, null, 2))
  } else {
    // In development, log full details
    console.error('API Error Details:', errorDetails)
    console.error('Stack trace:', err.stack)
  }
}

const buildErrorResponse = (err: CustomError, req: Request, requestId: string | string[]): ErrorResponse => {
  const timestamp = new Date().toISOString()
  const path = req.path

  // Zod validation errors
  if (err instanceof ZodError) {
    return {
      error: 'Validation Error',
      message: 'Invalid request data',
      statusCode: 400,
      timestamp,
      path,
      requestId: Array.isArray(requestId) ? requestId[0] : requestId
    }
  }

  // Database errors
  if (err.code === '23505') { // PostgreSQL unique violation
    return {
      error: 'Conflict',
      message: 'Resource already exists',
      statusCode: 409,
      timestamp,
      path,
      requestId: Array.isArray(requestId) ? requestId[0] : requestId
    }
  }

  if (err.code === '23503') { // PostgreSQL foreign key violation
    return {
      error: 'Bad Request',
      message: 'Invalid reference to related resource',
      statusCode: 400,
      timestamp,
      path,
      requestId: Array.isArray(requestId) ? requestId[0] : requestId
    }
  }

  // JWT/Auth errors
  if (err.name === 'UnauthorizedError' || err.name === 'JsonWebTokenError') {
    return {
      error: 'Unauthorized',
      message: 'Invalid or expired authentication token',
      statusCode: 401,
      timestamp,
      path,
      requestId: Array.isArray(requestId) ? requestId[0] : requestId
    }
  }

  // File size errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return {
      error: 'Payload Too Large',
      message: 'File size exceeds maximum allowed limit',
      statusCode: 413,
      timestamp,
      path,
      requestId: Array.isArray(requestId) ? requestId[0] : requestId
    }
  }

  // Rate limiting errors
  if (err.statusCode === 429) {
    return {
      error: 'Too Many Requests',
      message: 'Rate limit exceeded, please try again later',
      statusCode: 429,
      timestamp,
      path,
      requestId: Array.isArray(requestId) ? requestId[0] : requestId
    }
  }

  // Custom application errors
  if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
    return {
      error: 'Client Error',
      message: process.env.NODE_ENV === 'production' 
        ? 'Invalid request' 
        : err.message,
      statusCode: err.statusCode,
      timestamp,
      path,
      requestId: Array.isArray(requestId) ? requestId[0] : requestId
    }
  }

  // Server errors (500+)
  return {
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred' 
      : err.message,
    statusCode: err.statusCode || 500,
    timestamp,
    path,
    requestId: Array.isArray(requestId) ? requestId[0] : requestId
  }
}

// Sanitize request body for logging (remove sensitive data)
const sanitizeBody = (body: any): any => {
  if (!body || typeof body !== 'object') return body

  const sanitized = { ...body }
  const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization']
  
  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]'
    }
  }
  
  return sanitized
}

// Generate unique request ID
const generateRequestId = (): string => {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

// 404 handler for unmatched routes
export const notFoundHandler = (req: Request, res: Response) => {
  const errorResponse: ErrorResponse = {
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    statusCode: 404,
    timestamp: new Date().toISOString(),
    path: req.path,
    requestId: req.headers['x-request-id'] as string || generateRequestId()
  }

  res.status(404).json(errorResponse)
}

// Async error wrapper utility
export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

// Custom error classes
export class AppError extends Error {
  public statusCode: number
  public isOperational: boolean

  constructor(message: string, statusCode: number) {
    super(message)
    this.statusCode = statusCode
    this.isOperational = true

    Error.captureStackTrace(this, this.constructor)
  }
}

export class ValidationError extends AppError {
  constructor(message: string = 'Validation failed') {
    super(message, 400)
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized access') {
    super(message, 401)
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Access forbidden') {
    super(message, 403)
  }
}

// Updated server.ts integration
// src/server.ts (add these at the end)
import { errorHandler, notFoundHandler } from './middleware/errorHandler'

// ... all your routes ...

// 404 handler (must be after all routes)
app.use(notFoundHandler)

// Global error handler (must be last)
app.use(errorHandler)

// Graceful shutdown handling
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  // Close server gracefully
  process.exit(1)
})

process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught Exception:', error)
  // Close server gracefully
  process.exit(1)
})
