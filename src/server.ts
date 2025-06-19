// src/server.ts - StoryLofts ContentHive API Server (Production-Ready with Zod Validation)
import express from 'express'
import compression from 'compression'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { configService } from './config'
import { db } from './services/database'
import { healthService } from './services/health'

// Import security configurations
import { 
  getHelmetConfig, 
  getCorsConfig, 
  getRateLimitConfigs,
  requestIdMiddleware,
  securityHeadersMiddleware
} from './config/security'

// Import middleware
import { errorHandler, notFoundHandler } from './middleware/errorhandler'
import { authenticateToken } from './middleware/auth'
import { validate } from './middleware/validation'

// Import routes
import contentRoutes from './routes/content'
import uploadRoutes from './routes/upload'
import healthRoutes from './routes/health'

// ============================================================================
// APPLICATION SETUP
// ============================================================================

const app = express()
const config = configService.getConfig()

// Trust proxy (critical for DigitalOcean App Platform)
app.set('trust proxy', 1)

// Disable X-Powered-By for security
app.disable('x-powered-by')

// ============================================================================
// CONFIGURATION & UTILITIES
// ============================================================================

// Safe config accessor with proper type handling
const getConfigValue = (value: string | undefined, defaultValue: string): string => {
  return value && value.trim() !== '' ? value : defaultValue
}

// Config accessor functions for specific properties
const getApiBaseUrl = (): string => getConfigValue(config.api.baseUrl, 'http://localhost:3000')
const getEnvironment = (): string => getConfigValue(config.environment, 'development')
const getFrontendUrl = (): string => getConfigValue(config.frontend.url, 'http://localhost:3001')
const getServerPort = (): number => config.server.port || 3000

// Safe logging function to avoid TypeScript strict mode issues
const safeLog = (message: string) => {
  // @ts-ignore - Bypass strict console.log typing
  console.log(message)
}

safeLog('🚀 Initializing StoryLofts ContentHive API v1.0.0')
safeLog('🌍 Environment: ' + getEnvironment())
safeLog('🔗 Frontend URL: ' + getFrontendUrl())

// ============================================================================
// SECURITY MIDDLEWARE (Applied Early)
// ============================================================================

// Request tracking
app.use(requestIdMiddleware)

// Security headers
app.use(getHelmetConfig())
app.use(cors(getCorsConfig()))
app.use(securityHeadersMiddleware)

// Body parsing with security limits
app.use(compression())
app.use(express.json({ 
  limit: '10mb',
  verify: (req: any, res, buf) => {
    // Store raw body for webhook verification if needed
    req.rawBody = buf
  }
}))
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}))

// ============================================================================
// RATE LIMITING
// ============================================================================

const rateLimits = getRateLimitConfigs()

// Apply rate limiting with smart skip logic
app.use((req, res, next) => {
  // Skip rate limiting for health checks and static assets
  if (req.path.startsWith('/health') || 
      req.path.startsWith('/favicon') ||
      req.path === '/') {
    return next()
  }
  
  return rateLimit(rateLimits.general)(req, res, next)
})

// Specific rate limits for different endpoints
app.use('/api/upload', rateLimit(rateLimits.upload))
app.use('/api/auth', rateLimit(rateLimits.auth))
app.use('/api/content/search', rateLimit(rateLimits.search))
app.use('/api/content', (req, res, next) => {
  // Apply content modification rate limit only for POST/PUT/DELETE
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    // contentModification does not exist, using general as a fallback.
    return rateLimit(rateLimits.general)(req, res, next)
  }
  next()
})

// ============================================================================
// REQUEST LOGGING
// ============================================================================

app.use((req, res, next) => {
  const timestamp = new Date().toISOString()
  const method = req.method
  const path = req.path
  const ip = req.ip
  const userAgent = req.get('User-Agent') || 'Unknown'
  const requestId = req.requestId

  // Enhanced logging with user context
  const logData = {
    timestamp,
    requestId,
    method,
    path,
    ip,
    userAgent: userAgent.substring(0, 100),
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    contentLength: req.get('Content-Length'),
    origin: req.get('Origin')
  }

  // Log requests (exclude health checks in production to reduce noise)
  if (getEnvironment() === 'development' || 
      (!req.path.startsWith('/health') && !req.path.startsWith('/favicon'))) {
    console.log(`📥 REQUEST: ${method} ${path}`, logData)
  }
  
  // Add response time tracking
  const startTime = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - startTime
    const statusCode = res.statusCode
    
    // Log slow requests or errors
    if (getEnvironment() === 'development' || 
        duration > 1000 || 
        statusCode >= 400) {
      console.log(`📤 RESPONSE: ${method} ${path} - ${statusCode} - ${duration}ms`, {
        requestId,
        statusCode,
        duration,
        contentLength: res.get('Content-Length')
      })
    }
    
    // Log security events
    if (statusCode === 429) {
      // logSecurityEvent('Rate limit exceeded', { ip, path, userAgent })
    } else if (statusCode === 403) {
      // logSecurityEvent('Access forbidden', { ip, path, userAgent })
    } else if (statusCode === 401) {
      // logSecurityEvent('Unauthorized access attempt', { ip, path, userAgent })
    }
  })
  
  next()
})

// ============================================================================
// API ROUTES
// ============================================================================

// Health checks (no authentication required)
app.use('/health', healthRoutes)

// Content API (authentication required for most endpoints)
app.use('/api/content', contentRoutes)

// Upload API (authentication required)
app.use('/api/upload', authenticateToken, uploadRoutes)

// ============================================================================
// API DOCUMENTATION & STATUS
// ============================================================================

// Enhanced API documentation with Zod validation details
app.get('/api/docs', (req, res) => {
  const docs = {
    title: 'StoryLofts ContentHive API',
    version: '1.0.0',
    description: 'Professional video content platform API - Built for creators, professionals, and teams',
    baseUrl: getApiBaseUrl(),
    environment: getEnvironment(),
    
    validation: {
      library: 'Zod v3.22+',
      features: [
        'Type-safe runtime validation',
        'Automatic TypeScript type inference',
        'Structured error responses',
        'Schema composition and reusability',
        'Async validation support'
      ],
      errorFormat: {
        structure: {
          success: false,
          errors: [
            {
              path: 'field.path',
              message: 'Validation error message'
            }
          ]
        },
        example: {
          success: false,
          errors: [
            {
              path: 'body.title',
              message: 'Title must be at least 1 character'
            },
            {
              path: 'params.id',
              message: 'Invalid UUID format'
            }
          ]
        }
      }
    },
    
    security: {
      authentication: {
        type: 'Bearer token (Auth0 JWT)',
        header: 'Authorization: Bearer <token>',
        provider: 'Auth0',
        audience: config.auth0.audience
      },
      
      rateLimit: {
        general: getEnvironment() === 'development' ? '2000 requests per 15 minutes' : '200 requests per 15 minutes',
        uploads: getEnvironment() === 'development' ? '500 requests per hour' : '50 requests per hour',
        authentication: getEnvironment() === 'development' ? '200 requests per 15 minutes' : '20 requests per 15 minutes',
        search: getEnvironment() === 'development' ? '300 requests per minute' : '30 requests per minute'
      },
      
      cors: {
        allowedOrigins: getEnvironment() === 'development' 
          ? ['https://storylofts.com', 'http://localhost:3000', 'and more...'] 
          : ['https://storylofts.com', 'https://www.storylofts.com', 'https://app.storylofts.com'],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
      },
      
      headers: [
        'Content-Security-Policy',
        'X-Content-Type-Options: nosniff',
        'X-Frame-Options: DENY',
        'X-XSS-Protection: 1; mode=block',
        'Strict-Transport-Security (production only)',
        'Referrer-Policy: strict-origin-when-cross-origin'
      ]
    },
    
    endpoints: {
      health: {
        'GET /health': 'Basic health check',
        'GET /health/detailed': 'Detailed system health (database, storage, auth)',
        'GET /health/database': 'PostgreSQL database health',
        'GET /health/storage': 'Backblaze B2 storage health',
        'GET /health/auth0': 'Auth0 authentication service health'
      },
      
      content: {
        'GET /api/content': {
          description: 'List video content (public) or user content (authenticated)',
          validation: {
            query: {
              page: 'number (min: 1, default: 1)',
              limit: 'number (min: 1, max: 100, default: 20)',
              status: 'enum: uploading | processing | completed | failed',
              visibility: 'enum: public | private | unlisted',
              search: 'string (max: 100 chars)',
              sortBy: 'enum: created_at | updated_at | title | file_size',
              sortOrder: 'enum: asc | desc'
            }
          }
        },
        'GET /api/content/:id': {
          description: 'Get specific video by ID',
          validation: {
            params: {
              id: 'UUID format required'
            }
          }
        },
        'POST /api/content': {
          description: 'Create new video content (authenticated)',
          validation: {
            body: {
              title: 'string (1-255 chars, required)',
              description: 'string (max: 2000 chars, optional)',
              filename: 'string (valid video extension required)',
              fileSize: 'number (max: 500MB)',
              videoUrl: 'valid URL format',
              visibility: 'enum: public | private | unlisted',
              tags: 'array of strings (max: 10 tags)',
              mimeType: 'video MIME type',
              duration: 'positive number (optional)',
              thumbnailUrl: 'valid URL (optional)'
            }
          }
        },
        'PUT /api/content/:id': {
          description: 'Update video content (authenticated + ownership)',
          validation: {
            params: { id: 'UUID format' },
            body: 'Same as POST but all fields optional'
          }
        },
        'DELETE /api/content/:id': {
          description: 'Delete video content (authenticated + ownership)',
          validation: {
            params: { id: 'UUID format' }
          }
        },
        'GET /api/content/search': 'Search videos with full-text search',
        'GET /api/content/stats': 'User content statistics (authenticated)',
        'GET /api/content/meta/tags': 'Get available content tags'
      },
      
      upload: {
        'POST /api/upload/url': {
          description: 'Get pre-signed upload URL (authenticated)',
          validation: {
            body: {
              filename: 'string (valid video extension, max: 255 chars)',
              fileSize: 'number (max: 500MB)'
            }
          }
        },
        'POST /api/upload/complete': 'Complete upload and create content record (authenticated)',
        'GET /api/upload/status/:id': {
          description: 'Check upload status (authenticated)',
          validation: {
            params: { id: 'UUID format' }
          }
        }
      }
    },
    
    dataTypes: {
      supportedVideoFormats: ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.m4v', '.3gp', '.flv'],
      maxFileSize: '500MB (524,288,000 bytes)',
      maxDuration: '24 hours',
      allowedMimeTypes: [
        'video/mp4',
        'video/quicktime',
        'video/x-msvideo',
        'video/webm',
        'video/x-matroska',
        'video/x-m4v',
        'video/3gpp',
        'video/x-flv'
      ]
    },
    
    parameters: {
      pagination: {
        page: 'Page number (default: 1, min: 1)',
        limit: 'Items per page (default: 20, max: 100)'
      },
      
      filtering: {
        status: 'uploading | processing | completed | failed',
        visibility: 'public | private | unlisted',
        tags: 'Comma-separated tag names',
        search: 'Full-text search in title and description (max: 100 chars)',
        createdAfter: 'ISO datetime filter',
        createdBefore: 'ISO datetime filter'
      },
      
      sorting: {
        sortBy: 'created_at | updated_at | title | duration | file_size',
        sortOrder: 'asc | desc (default: desc)'
      }
    },
    
    examples: {
      'List public content': `GET ${getApiBaseUrl()}/api/content?visibility=public&page=1&limit=10`,
      'Search business videos': `GET ${getApiBaseUrl()}/api/content/search?q=tutorial&tags=business,training`,
      'Get user content': `GET ${getApiBaseUrl()}/api/content (with Authorization header)`,
      'Create video content': {
        url: `POST ${getApiBaseUrl()}/api/content`,
        body: {
          title: 'My Tutorial Video',
          description: 'A comprehensive tutorial on video editing',
          filename: 'tutorial.mp4',
          fileSize: 157286400,
          videoUrl: 'https://f005.backblazeb2.com/file/storylofts-content/videos/uuid/tutorial.mp4',
          visibility: 'public',
          tags: ['tutorial', 'editing', 'beginner'],
          mimeType: 'video/mp4',
          duration: 1800
        }
      },
      'Upload workflow': [
        '1. POST /api/upload/url - Get pre-signed URL and video ID',
        '2. PUT <pre-signed-url> - Upload file directly to Backblaze B2',
        '3. POST /api/upload/complete - Complete upload with metadata'
      ]
    },
    
    errorCodes: {
      400: {
        description: 'Bad Request - Invalid input data or validation error',
        commonCauses: [
          'Missing required fields',
          'Invalid data types',
          'Value out of allowed range',
          'Invalid file format',
          'Malformed UUID'
        ]
      },
      401: 'Unauthorized - Missing, invalid, or expired authentication',
      403: 'Forbidden - Insufficient permissions or CORS violation',
      404: 'Not Found - Resource does not exist',
      409: 'Conflict - Resource already exists or constraint violation',
      413: 'Payload Too Large - File size exceeds limits',
      422: {
        description: 'Unprocessable Entity - Valid syntax but semantic errors',
        commonCauses: [
          'Business logic validation failed',
          'Referenced resource not found',
          'Invalid state transition'
        ]
      },
      429: 'Too Many Requests - Rate limit exceeded',
      500: 'Internal Server Error - Unexpected server error',
      502: 'Bad Gateway - Upstream service error (Auth0, Backblaze B2)',
      503: 'Service Unavailable - Server temporarily unavailable'
    }
  }
  
  res.json(docs)
})

// API status endpoint with comprehensive health info
app.get('/api/status', async (req, res) => {
  try {
    const health = await healthService.getDetailedHealth()
    const uptime = process.uptime()
    
    res.json({
      name: 'StoryLofts ContentHive API',
      version: '1.0.0',
      status: health.status,
      environment: getEnvironment(),
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: Math.floor(uptime),
        human: formatUptime(uptime)
      },
      
      validation: {
        library: 'Zod',
        version: '3.22+',
        features: ['Runtime type checking', 'TypeScript integration', 'Schema composition']
      },
      
      services: {
        database: {
          status: health.services.database.status,
          responseTime: health.services.database.responseTime
        },
        storage: {
          status: health.services.storage.status,
          responseTime: health.services.storage.responseTime
        },
        auth: {
          status: health.services.auth0.status,
          responseTime: health.services.auth0.responseTime
        }
      },
      
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
        },
        cpu: process.cpuUsage()
      },
      
      endpoints: {
        documentation: `${getApiBaseUrl()}/api/docs`,
        health: `${getApiBaseUrl()}/health/detailed`,
        content: `${getApiBaseUrl()}/api/content`,
        upload: `${getApiBaseUrl()}/api/upload`
      }
    })
  } catch (error) {
    console.error('❌ Status endpoint error:', error)
    res.status(500).json({
      name: 'StoryLofts ContentHive API',
      status: 'error',
      error: 'Failed to retrieve system status',
      timestamp: new Date().toISOString()
    })
  }
})

// Root endpoint with API information
app.get('/', (req, res) => {
  res.json({
    name: 'StoryLofts ContentHive API',
    version: '1.0.0',
    description: 'Professional video content platform - Built for creators, professionals, and teams',
    status: 'operational',
    environment: getEnvironment(),
    timestamp: new Date().toISOString(),
    
    validation: {
      library: 'Zod',
      features: ['Type-safe validation', 'Runtime type checking', 'Schema composition']
    },
    
    links: {
      documentation: `${getApiBaseUrl()}/api/docs`,
      status: `${getApiBaseUrl()}/api/status`,
      health: `${getApiBaseUrl()}/health/detailed`,
      content: `${getApiBaseUrl()}/api/content`,
      upload: `${getApiBaseUrl()}/api/upload`
    },
    
    support: {
      website: 'https://storylofts.com',
      repository: 'https://github.com/nsr-compute/storylofts-backend',
      documentation: `${getApiBaseUrl()}/api/docs`
    },
    
    features: [
      'Professional video content management',
      'Secure file upload to Backblaze B2',
      'Full-text search and advanced filtering',
      'User analytics and insights',
      'Auth0 JWT authentication',
      'Zod runtime validation with TypeScript integration',
      'Rate limiting and security headers',
      'Comprehensive health monitoring'
    ]
  })
})

// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found',
    message: `The endpoint ${req.method} ${req.originalUrl} does not exist`,
    suggestion: 'Check the API documentation for available endpoints',
    documentation: `${getApiBaseUrl()}/api/docs`,
    timestamp: new Date().toISOString(),
    requestId: req.requestId
  })
})

// General 404 handler
app.use(notFoundHandler)

// Global error handler (must be last) - Enhanced for Zod validation errors
app.use(errorHandler)

// ============================================================================
// SERVER STARTUP & SHUTDOWN
// ============================================================================

async function startServer() {
  try {
    safeLog('🚀 Starting StoryLofts ContentHive API...')
    
    // Connect to PostgreSQL database
    safeLog('🔌 Connecting to PostgreSQL database...')
    await db.connect()
    safeLog('✅ Database connected successfully')
    
    // Verify external services
    safeLog('🔍 Verifying external services...')
    const health = await healthService.getDetailedHealth()
    safeLog('📊 Service status:', {
      database: health.services.database.status,
      storage: health.services.storage.status,
      auth: health.services.auth0.status
    })
    
    // Start HTTP server
    const port = getServerPort()
    const server = app.listen(port, () => {
      safeLog('✨ StoryLofts ContentHive API is ready!')
      safeLog(`🎯 Server running on port ${port}`)
      safeLog('📖 Documentation: ' + getApiBaseUrl() + '/api/docs')
      safeLog('📊 API Status: ' + getApiBaseUrl() + '/api/status')
      safeLog('❤️  Health Check: ' + getApiBaseUrl() + '/health/detailed')
      safeLog('🌍 Environment: ' + getEnvironment())
      safeLog('🔗 Frontend: ' + getFrontendUrl())
      safeLog('✅ Zod validation enabled for type-safe API requests')
      safeLog('🎬 Ready for professional video content management!')
    })

    // Configure server timeouts
    server.timeout = 120000 // 2 minutes
    server.keepAliveTimeout = 65000 // 65 seconds
    server.headersTimeout = 66000 // 66 seconds

    // Graceful shutdown handling
    const gracefulShutdown = async (signal: string) => {
      safeLog(`\n📡 Received ${signal}. Starting graceful shutdown...`)
      
      // Stop accepting new connections
      server.close(async () => {
        safeLog('🔒 HTTP server closed')
        
        try {
          // Close database connections
          await db.disconnect()
          safeLog('🔌 Database disconnected')
          
          safeLog('👋 StoryLofts ContentHive API shutdown completed gracefully')
          process.exit(0)
        } catch (error) {
          safeLog('❌ Error during shutdown: ' + error)
          process.exit(1)
        }
      })
      
      // Force close after timeout
      setTimeout(() => {
        safeLog('⏰ Shutdown timeout exceeded, forcing exit')
        process.exit(1)
      }, 30000) // 30 seconds
    }

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
    process.on('SIGINT', () => gracefulShutdown('SIGINT'))
    
    // Handle uncaught exceptions and rejections
    process.on('uncaughtException', (error) => {
      safeLog('❌ Uncaught Exception: ' + error)
      // logSecurityEvent('Uncaught exception', { error: error.message, stack: error.stack })
      gracefulShutdown('uncaughtException')
    })
    
    process.on('unhandledRejection', (reason, promise) => {
      safeLog('❌ Unhandled Rejection at: ' + promise + ' reason: ' + reason)
      // logSecurityEvent('Unhandled rejection', { reason, promise })
      gracefulShutdown('unhandledRejection')
    })
    
  } catch (error) {
    safeLog('❌ Failed to start StoryLofts ContentHive API: ' + error)
    process.exit(1)
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  
  const parts = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (secs > 0) parts.push(`${secs}s`)
  
  return parts.join(' ') || '0s'
}

// Start the server
startServer()

export default app
