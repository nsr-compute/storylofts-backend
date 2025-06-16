// src/server.ts - StoryLofts ContentHive API Server
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { configService } from './config';
import { db } from './services/database';
import { healthService } from './services/health';

// Import routes
import contentRoutes from './routes/content';
import uploadRoutes from './routes/upload';
import healthRoutes from './routes/health';

const app = express();
const config = configService.getConfig();

// Trust proxy (important for DigitalOcean App Platform)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.storylofts.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
    },
  },
}));

// CORS configuration for StoryLofts
const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    const allowedOrigins = [
      config.frontend.url,
      'https://storylofts.com',
      'https://www.storylofts.com',
      'https://app.storylofts.com'
    ];
    
    // Allow development origins
    if (config.environment === 'development') {
      allowedOrigins.push(
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3001',
        'http://localhost:8080'
      );
    }
    
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS: Blocked origin ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'X-API-Key',
    'X-Upload-Session-Id'
  ]
};

app.use(cors(corsOptions));

// Body parsing middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path.startsWith('/health');
  }
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // limit each IP to 20 upload requests per hour
  message: {
    success: false,
    error: 'Too many upload requests from this IP, please try again later.',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 auth requests per windowMs
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting
app.use(generalLimiter);
app.use('/api/upload', uploadLimiter);
app.use('/api/auth', authLimiter);

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const userAgent = req.get('User-Agent') || 'Unknown';
  const method = req.method;
  const path = req.path;
  const ip = req.ip;
  
  // Log requests (exclude health checks in production to reduce noise)
  if (config.environment === 'development' || !req.path.startsWith('/health')) {
    console.log(`${timestamp} ${method} ${path} - IP: ${ip} - UA: ${userAgent.substring(0, 50)}`);
  }
  
  next();
});

// Routes
app.use('/health', healthRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/upload', uploadRoutes);

// API documentation endpoint
app.get('/api/docs', (req, res) => {
  const docs = {
    title: 'StoryLofts ContentHive API',
    version: '1.0.0',
    description: 'Professional video content platform API - Vimeo for professionals',
    baseUrl: config.api.baseUrl,
    authentication: {
      type: 'Bearer token (Auth0 JWT)',
      header: 'Authorization: Bearer <token>',
      endpoint: 'https://storylofts.auth0.com'
    },
    endpoints: {
      health: {
        'GET /health': 'Basic health check',
        'GET /health/detailed': 'Detailed system health including database',
        'GET /health/auth0': 'Auth0 service health check',
        'GET /health/storage': 'Backblaze B2 storage health check',
        'GET /health/database': 'PostgreSQL database health check'
      },
      content: {
        'GET /api/content': 'List video content with pagination and filtering',
        'GET /api/content/:id': 'Get specific video content by ID',
        'POST /api/content': 'Create new video content (authentication required)',
        'PUT /api/content/:id': 'Update video content (authentication + ownership required)',
        'DELETE /api/content/:id': 'Delete video content (authentication + ownership required)',
        'GET /api/content/meta/tags': 'Get available professional tags',
        'POST /api/content/meta/tags': 'Create new content tag (authentication required)'
      },
      upload: {
        'POST /api/upload/url': 'Get pre-signed upload URL for Backblaze B2 (auth required)',
        'POST /api/upload/direct': 'Direct file upload to Backblaze B2 (auth required)',
        'POST /api/upload/complete': 'Complete upload process and create content record (auth required)'
      }
    },
    parameters: {
      pagination: {
        page: 'Page number (default: 1, min: 1)',
        limit: 'Items per page (default: 20, max: 100)'
      },
      filtering: {
        status: 'uploading | processing | ready | failed',
        visibility: 'public | private | unlisted',
        tags: 'Comma-separated tag names (e.g., "business,marketing")',
        search: 'Search in title and description (full-text search)'
      },
      sorting: {
        sortBy: 'created_at | updated_at | title | duration',
        sortOrder: 'asc | desc (default: desc)'
      }
    },
    examples: {
      'List public content': 'GET /api/content?visibility=public&page=1&limit=10',
      'Search business videos': 'GET /api/content?search=tutorial&tags=business,training',
      'Get user content': 'GET /api/content?page=1&limit=20 (with Authorization header)',
      'Upload workflow': [
        '1. POST /api/upload/url - Get pre-signed upload URL',
        '2. PUT to upload URL - Upload file directly to Backblaze B2',
        '3. POST /api/upload/complete - Complete upload and create content record'
      ]
    },
    rateLimit: {
      general: '100 requests per 15 minutes',
      uploads: '20 requests per hour',
      authentication: '50 requests per 15 minutes'
    },
    errorCodes: {
      400: 'Bad Request - Invalid input data',
      401: 'Unauthorized - Missing or invalid authentication',
      403: 'Forbidden - Insufficient permissions',
      404: 'Not Found - Resource does not exist',
      429: 'Too Many Requests - Rate limit exceeded',
      500: 'Internal Server Error - Server malfunction'
    }
  };
  
  res.json(docs);
});

// API status endpoint
app.get('/api/status', async (req, res) => {
  try {
    const health = await healthService.getDetailedHealth();
    
    res.json({
      name: 'StoryLofts ContentHive API',
      version: '1.0.0',
      status: health.status,
      environment: config.environment,
      timestamp: new Date().toISOString(),
      uptime: health.uptime,
      services: {
        database: health.services.database.status,
        storage: health.services.storage.status,
        auth: health.services.auth0.status
      },
      endpoints: {
        docs: `${config.api.baseUrl}/api/docs`,
        health: `${config.api.baseUrl}/health/detailed`,
        content: `${config.api.baseUrl}/api/content`,
        upload: `${config.api.baseUrl}/api/upload`
      }
    });
  } catch (error) {
    res.status(500).json({
      name: 'StoryLofts ContentHive API',
      status: 'error',
      error: 'Failed to retrieve status'
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'StoryLofts ContentHive API',
    version: '1.0.0',
    description: 'Professional video content platform - Vimeo for professionals, not YouTube for everyone',
    status: 'operational',
    environment: config.environment,
    timestamp: new Date().toISOString(),
    links: {
      documentation: `${config.api.baseUrl}/api/docs`,
      status: `${config.api.baseUrl}/api/status`,
      health: `${config.api.baseUrl}/health/detailed`,
      content: `${config.api.baseUrl}/api/content`,
      upload: `${config.api.baseUrl}/api/upload`
    },
    support: {
      website: 'https://storylofts.com',
      repository: 'https://github.com/nsr-compute/storylofts-backend'
    }
  });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found',
    message: `The endpoint ${req.method} ${req.originalUrl} does not exist`,
    suggestion: 'Check the API documentation for available endpoints',
    documentation: `${config.api.baseUrl}/api/docs`
  });
});

// General 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Resource not found',
    message: `The resource ${req.method} ${req.originalUrl} was not found`,
    api: {
      documentation: `${config.api.baseUrl}/api/docs`,
      status: `${config.api.baseUrl}/api/status`
    }
  });
});

// Global error handler
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error handler:', {
    error: error.message,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  // Don't leak error details in production
  const isDevelopment = config.environment === 'development';
  
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: isDevelopment ? error.message : 'Something went wrong on our end',
    stack: isDevelopment ? error.stack : undefined,
    timestamp: new Date().toISOString(),
    requestId: req.ip + '-' + Date.now()
  });
});

// Database connection and server startup
async function startServer() {
  try {
    console.log('🚀 Starting StoryLofts ContentHive API...');
    
    // Connect to PostgreSQL database first
    console.log('🔌 Connecting to PostgreSQL database...');
    await db.connect();
    console.log('✅ Database connected successfully');
    
    // Start HTTP server
    const port = config.server.port;
    const server = app.listen(port, () => {
      console.log(`🎯 StoryLofts ContentHive API running on port ${port}`);
      console.log(`📖 Documentation: ${config.api.baseUrl}/api/docs`);
      console.log(`📊 Status: ${config.api.baseUrl}/api/status`);
      console.log(`❤️  Health Check: ${config.api.baseUrl}/health/detailed`);
      console.log(`🌍 Environment: ${config.environment}`);
      console.log(`🔗 Frontend: ${config.frontend.url}`);
      console.log('✨ StoryLofts is ready for professional video content!');
    });

    // Graceful shutdown handling
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n📡 Received ${signal}. Starting graceful shutdown...`);
      
      server.close(async () => {
        console.log('🔒 HTTP server closed');
        
        try {
          await db.disconnect();
          console.log('🔌 Database disconnected');
          console.log('👋 StoryLofts ContentHive API shutdown completed gracefully');
          process.exit(0);
        } catch (error) {
          console.error('❌ Error during shutdown:', error);
          process.exit(1);
        }
      });
      
      // Force close server after 30 seconds
      setTimeout(() => {
        console.error('⏰ Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 30000);
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      gracefulShutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
      gracefulShutdown('unhandledRejection');
    });
    
  } catch (error) {
    console.error('❌ Failed to start StoryLofts ContentHive API:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

export default app;
