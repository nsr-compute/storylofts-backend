// src/middleware/errorHandler.ts - Enhanced with Full Zod Support
import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'

interface CustomError extends Error {
  statusCode?: number
  code?: string
  details?: any
}

interface ErrorResponse {
  success: boolean
  error: string
  message: string
  statusCode: number
  timestamp: string
  path: string
  requestId?: string
  errors?: Array<{
    path: string
    message: string
    received?: any
  }>
}

export const errorHandler = (
  err: CustomError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Generate unique request ID for tracking
  const requestId = req.headers['x-request-id'] || req.requestId || generateRequestId()
  
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
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      statusCode: err.statusCode,
      code: err.code,
      // Include Zod error details if present
      zodErrors: err instanceof ZodError ? err.errors : undefined
    }
  }

  if (process.env.NODE_ENV === 'production') {
    // In production, log structured data without stack traces in client responses
    console.error('🚨 API Error:', JSON.stringify(errorDetails, null, 2))
  } else {
    // In development, log full details
    console.error('🚨 API Error Details:', errorDetails)
    if (err.stack) {
      console.error('📍 Stack trace:', err.stack)
    }
  }

  // Log to external monitoring service in production (if configured)
  if (process.env.NODE_ENV === 'production' && process.env.ERROR_MONITORING_ENABLED === 'true') {
    // Add your external error monitoring service here (e.g., Sentry, LogRocket, etc.)
    // errorMonitoringService.captureException(err, { extra: errorDetails })
  }
}

const buildErrorResponse = (err: CustomError, req: Request, requestId: string | string[]): ErrorResponse => {
  const timestamp = new Date().toISOString()
  const path = req.path
  const cleanRequestId = Array.isArray(requestId) ? requestId[0] : requestId

  // Zod validation errors - Enhanced handling
  if (err instanceof ZodError) {
    const zodErrors = err.errors.map(zodError => ({
      path: zodError.path.join('.'),
      message: zodError.message,
      received: zodError.received
    }))

    return {
      success: false,
      error: 'Validation Error',
      message: 'Request validation failed. Please check your input data.',
      statusCode: 400,
      timestamp,
      path,
      requestId: cleanRequestId,
      errors: zodErrors
    }
  }

  // Database errors (PostgreSQL specific)
  if (err.code === '23505') { // Unique violation
    return {
      success: false,
      error: 'Conflict',
      message: 'Resource already exists with the provided data',
      statusCode: 409,
      timestamp,
      path,
      requestId: cleanRequestId
    }
  }

  if (err.code === '23503') { // Foreign key violation
    return {
      success: false,
      error: 'Bad Request',
      message: 'Invalid reference to related resource',
      statusCode: 400,
      timestamp,
      path,
      requestId: cleanRequestId
    }
  }

  if (err.code === '23502') { // Not null violation
    return {
      success: false,
      error: 'Bad Request',
      message: 'Required field is missing',
      statusCode: 400,
      timestamp,
      path,
      requestId: cleanRequestId
    }
  }

  if (err.code === '23514') { // Check constraint violation
    return {
      success: false,
      error: 'Bad Request',
      message: 'Data violates business rules',
      statusCode: 400,
      timestamp,
      path,
      requestId: cleanRequestId
    }
  }

  // JWT/Auth0 errors
  if (err.name === 'UnauthorizedError' || err.name === 'JsonWebTokenError') {
    return {
      success: false,
      error: 'Unauthorized',
      message: 'Invalid or expired authentication token',
      statusCode: 401,
      timestamp,
      path,
      requestId: cleanRequestId
    }
  }

  if (err.name === 'TokenExpiredError') {
    return {
      success: false,
      error: 'Unauthorized',
      message: 'Authentication token has expired',
      statusCode: 401,
      timestamp,
      path,
      requestId: cleanRequestId
    }
  }

  // File upload errors (Multer/Backblaze)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return {
      success: false,
      error: 'Payload Too Large',
      message: 'File size exceeds maximum allowed limit (500MB)',
      statusCode: 413,
      timestamp,
      path,
      requestId: cleanRequestId
    }
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    return {
      success: false,
      error: 'Bad Request',
      message: 'Too many files in upload request',
      statusCode: 400,
      timestamp,
      path,
      requestId: cleanRequestId
    }
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return {
      success: false,
      error: 'Bad Request',
      message: 'Unexpected file field in upload request',
      statusCode: 400,
      timestamp,
      path,
      requestId: cleanRequestId
    }
  }

  // Backblaze B2 specific errors
  if (err.message?.includes('backblaze') || err.message?.includes('b2')) {
    return {
      success: false,
      error: 'Storage Service Error',
      message: 'File storage service is temporarily unavailable',
      statusCode: 502,
      timestamp,
      path,
      requestId: cleanRequestId
    }
  }

  // Google Cloud/Auth0 service errors
  if (err.message?.includes('auth0') || err.message?.includes('google-cloud')) {
    return {
      success: false,
      error: 'Authentication Service Error',
      message: 'Authentication service is temporarily unavailable',
      statusCode: 502,
      timestamp,
      path,
      requestId: cleanRequestId
    }
  }

  // Rate limiting errors
  if (err.statusCode === 429) {
    return {
      success: false,
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please wait before making more requests.',
      statusCode: 429,
      timestamp,
      path,
      requestId: cleanRequestId
    }
  }

  // CORS errors
  if (err.message?.includes('CORS') || err.message?.includes('cross-origin')) {
    return {
      success: false,
      error: 'Forbidden',
      message: 'Cross-origin request not allowed',
      statusCode: 403,
      timestamp,
      path,
      requestId: cleanRequestId
    }
  }

  // Custom application errors (4xx)
  if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
    return {
      success: false,
      error: getErrorTitle(err.statusCode),
      message: process.env.NODE_ENV === 'production' 
        ? getGenericMessage(err.statusCode)
        : err.message || getGenericMessage(err.statusCode),
      statusCode: err.statusCode,
      timestamp,
      path,
      requestId: cleanRequestId
    }
  }

  // Server errors (5xx)
  const statusCode = err.statusCode || 500
  return {
    success: false,
    error: getErrorTitle(statusCode),
    message: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred. Please try again later.'
      : err.message || 'Internal server error',
    statusCode,
    timestamp,
    path,
    requestId: cleanRequestId
  }
}

// Helper function to get error titles
const getErrorTitle = (statusCode: number): string => {
  const errorTitles: { [key: number]: string } = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    409: 'Conflict',
    413: 'Payload Too Large',
    415: 'Unsupported Media Type',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout'
  }
  return errorTitles[statusCode] || 'Unknown Error'
}

// Helper function to get generic error messages
const getGenericMessage = (statusCode: number): string => {
  const genericMessages: { [key: number]: string } = {
    400: 'The request could not be processed due to invalid data',
    401: 'Authentication is required to access this resource',
    403: 'You do not have permission to access this resource',
    404: 'The requested resource was not found',
    405: 'The request method is not allowed for this resource',
    409: 'The request conflicts with the current state of the resource',
    413: 'The request payload is too large',
    415: 'The media type is not supported',
    422: 'The request is well-formed but contains semantic errors',
    429: 'Too many requests have been made in a short period',
    500: 'An unexpected error occurred on the server',
    502: 'The server received an invalid response from an upstream server',
    503: 'The service is temporarily unavailable',
    504: 'The server did not receive a timely response from an upstream server'
  }
  return genericMessages[statusCode] || 'An error occurred'
}

// Sanitize request body for logging (remove sensitive data)
const sanitizeBody = (body: any): any => {
  if (!body || typeof body !== 'object') return body

  const sanitized = { ...body }
  const sensitiveFields = [
    'password', 'token', 'secret', 'key', 'authorization', 
    'auth', 'bearer', 'jwt', 'apikey', 'api_key',
    'client_secret', 'private_key', 'passphrase'
  ]
  
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

// 404 handler for unmatched routes - Updated with new format
export const notFoundHandler = (req: Request, res: Response) => {
  const errorResponse: ErrorResponse = {
    success: false,
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    statusCode: 404,
    timestamp: new Date().toISOString(),
    path: req.path,
    requestId: req.headers['x-request-id'] as string || req.requestId || generateRequestId()
  }

  // Log 404s for monitoring
  console.log(`🔍 404 Not Found: ${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    referer: req.get('Referer'),
    timestamp: errorResponse.timestamp
  })

  res.status(404).json(errorResponse)
}

// Async error wrapper utility
export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

// Custom error classes - Enhanced
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

export class ConflictError extends AppError {
  constructor(message: string = 'Resource conflict') {
    super(message, 409)
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(service: string = 'Service') {
    super(`${service} is temporarily unavailable`, 503)
  }
}

export class BadGatewayError extends AppError {
  constructor(service: string = 'Upstream service') {
    super(`${service} returned an invalid response`, 502)
  }
}
