// src/server.ts - StoryLofts ContentHive API Server (FIXED TypeScript Issues)
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

// FIXED: Safe logging without type assertions
console.log('🚀 Initializing StoryLofts ContentHive API v1.0.0')
console.log('🌍 Environment: ' + (config.environment || 'development'))
console.log('🔗 Frontend URL: ' + (config.frontend.url || 'http://localhost:3001'))

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
  const requestId = (req as any).requestId

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
  if (config.environment === 'development' || 
      (!req.path.startsWith('/health') && !req.path.startsWith('/favicon'))) {
    console.log(`📥 REQUEST: ${method} ${path}`, logData)
  }
  
  // Add response time tracking
  const startTime = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - startTime
    const statusCode = res.statusCode
    
    // Log slow requests or errors
    if (config.environment === 'development' || 
        duration > 1000 || 
        statusCode >= 400) {
      console.log(`📤 RESPONSE: ${method} ${path} - ${statusCode} - ${duration}ms`, {
        requestId,
        statusCode,
        duration,
        contentLength: res.get('Content-Length')
      })
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
    baseUrl: config.api.baseUrl || 'http://localhost:3000',
    environment: config.environment || 'development',
    
    validation: {
      library: 'Zod v3.22+',
      features: [
        'Type-safe runtime validation',
        'Automatic TypeScript type inference',
        'Structured error responses',
        'Schema composition and reusability',
        'Async validation support'
      ]
    },
    
    security: {
      authentication: {
        type: 'Bearer token (Auth0 JWT)',
        header: 'Authorization: Bearer <token>',
        provider: 'Auth0',
        audience: config.auth0?.audience || 'storylofts-api'
      },
      
      rateLimit: {
        general: config.environment === 'development' ? '2000 requests per 15 minutes' : '200 requests per 15 minutes',
        uploads: config.environment === 'development' ? '500 requests per hour' : '50 requests per hour',
        authentication: config.environment === 'development' ? '200 requests per 15 minutes' : '20 requests per 15 minutes',
        search: config.environment === 'development' ? '300 requests per minute' : '30 requests per minute'
      },
      
      cors: {
        allowedOrigins: config.environment === 'development' 
          ? ['https://storylofts.com', 'http://localhost:3000', 'and more...'] 
          : ['https://storylofts.com', 'https://www.storylofts.com', 'https://app.storylofts.com'],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
      }
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
        'GET /api/content': 'List video content (public) or user content (authenticated)',
        'GET /api/content/:id': 'Get specific video by ID',
        'POST /api/content': 'Create new video content (authenticated)',
        'PUT /api/content/:id': 'Update video content (authenticated + ownership)',
        'DELETE /api/content/:id': 'Delete video content (authenticated + ownership)',
        'GET /api/content/search': 'Search videos with full-text search',
        'GET /api/content/stats': 'User content statistics (authenticated)',
        'GET /api/content/meta/tags': 'Get available content tags'
      },
      
      upload: {
        'POST /api/upload/url': 'Get pre-signed upload URL (authenticated)',
        'POST /api/upload/complete': 'Complete upload and create content record (authenticated)',
        'GET /api/upload/status/:id': 'Check upload status (authenticated)'
      }
    },
    
    dataTypes: {
      supportedVideoFormats: ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.m4v', '.3gp', '.flv'],
      maxFileSize: '500MB (524,288,000 bytes)',
      maxDuration: '24 hours'
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
      environment: config.environment || 'development',
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
        documentation: `${config.api.baseUrl || 'http://localhost:3000'}/api/docs`,
        health: `${config.api.baseUrl || 'http://localhost:3000'}/health/detailed`,
        content: `${config.api.baseUrl || 'http://localhost:3000'}/api/content`,
        upload: `${config.api.baseUrl || 'http://localhost:3000'}/api/upload`
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
    environment: config.environment || 'development',
    timestamp: new Date().toISOString(),
    
    validation: {
      library: 'Zod',
      features: ['Type-safe validation', 'Runtime type checking', 'Schema composition']
    },
    
    links: {
      documentation: `${config.api.baseUrl || 'http://localhost:3000'}/api/docs`,
      status: `${config.api.baseUrl || 'http://localhost:3000'}/api/status`,
      health: `${config.api.baseUrl || 'http://localhost:3000'}/health/detailed`,
      content: `${config.api.baseUrl || 'http://localhost:3000'}/api/content`,
      upload: `${config.api.baseUrl || 'http://localhost:3000'}/api/upload`
    },
    
    support: {
      website: 'https://storylofts.com',
      repository: 'https://github.com/nsr-compute/storylofts-backend',
      documentation: `${config.api.baseUrl || 'http://localhost:3000'}/api/docs`
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
    documentation: `${config.api.baseUrl || 'http://localhost:3000'}/api/docs`,
    timestamp: new Date().toISOString(),
    requestId: (req as any).requestId
  })
})

// General 404 handler
app.use(notFoundHandler)

// Global error handler (must be last)
app.use(errorHandler)

// ============================================================================
// SERVER STARTUP & SHUTDOWN
// ============================================================================

async function startServer() {
  try {
    console.log('🚀 Starting StoryLofts ContentHive API...')
    
    // Connect to PostgreSQL database
    console.log('🔌 Connecting to PostgreSQL database...')
    await db.connect()
    console.log('✅ Database connected successfully')
    
    // Verify external services
    console.log('🔍 Verifying external services...')
    const health = await healthService.getDetailedHealth()
    console.log('📊 Service status:', {
      database: health.services.database.status,
      storage: health.services.storage.status,
      auth: health.services.auth0.status
    })
    
    // Start HTTP server
    const port = config.server?.port || 3000
    const server = app.listen(port, () => {
      console.log('✨ StoryLofts ContentHive API is ready!')
      console.log(`🎯 Server running on port ${port}`)
      console.log(`📖 Documentation: ${config.api?.baseUrl || 'http://localhost:3000'}/api/docs`)
      console.log(`📊 API Status: ${config.api?.baseUrl || 'http://localhost:3000'}/api/status`)
      console.log(`❤️  Health Check: ${config.api?.baseUrl || 'http://localhost:3000'}/health/detailed`)
      console.log(`🌍 Environment: ${config.environment || 'development'}`)
      console.log(`🔗 Frontend: ${config.frontend?.url || 'http://localhost:3001'}`)
      console.log('✅ Zod validation enabled for type-safe API requests')
      console.log('🎬 Ready for professional video content management!')
    })

    // Configure server timeouts
    server.timeout = 120000 // 2 minutes
    server.keepAliveTimeout = 65000 // 65 seconds
    server.headersTimeout = 66000 // 66 seconds

    // Graceful shutdown handling
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n📡 Received ${signal}. Starting graceful shutdown...`)
      
      // Stop accepting new connections
      server.close(async () => {
        console.log('🔒 HTTP server closed')
        
        try {
          // Close database connections
          await db.disconnect()
          console.log('🔌 Database disconnected')
          
          console.log('👋 StoryLofts ContentHive API shutdown completed gracefully')
          process.exit(0)
        } catch (error) {
          console.error('❌ Error during shutdown:', error)
          process.exit(1)
        }
      })
      
      // Force close after timeout
      setTimeout(() => {
        console.error('⏰ Shutdown timeout exceeded, forcing exit')
        process.exit(1)
      }, 30000) // 30 seconds
    }

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
    process.on('SIGINT', () => gracefulShutdown('SIGINT'))
    
    // Handle uncaught exceptions and rejections
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error)
      gracefulShutdown('uncaughtException')
    })
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason)
      gracefulShutdown('unhandledRejection')
    })
    
  } catch (error) {
    console.error('❌ Failed to start StoryLofts ContentHive API:', error)
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