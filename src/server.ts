// src/server.ts - Updated Server for StoryLofts with Secret Manager
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { configPromise } from './config';
import { uploadRouter } from './routes/upload';
import { contentRouter } from './routes/content';

async function createApp() {
  // Load configuration (including secrets)
  const config = await configPromise;
  
  const app = express();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https:"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'", "https:"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // CORS configuration - Updated for StoryLofts domains
  app.use(cors({
    origin: [
      // Production StoryLofts domains
      'https://storylofts.com',
      'https://www.storylofts.com',
      'https://storylofts.app',
      'https://app.storylofts.com',
      'https://staging.storylofts.com',
      
      // Config-based frontend URL
      config.server.frontendUrl,
      
      // Development origins
      'http://localhost:3001',
      'http://localhost:3000',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:3000',
      
      // Deployment preview domains
      /^https:\/\/.*\.vercel\.app$/,
      /^https:\/\/.*\.netlify\.app$/,
      /^https:\/\/.*\.herokuapp\.com$/
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
  }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
      success: false,
      error: 'Too many requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use(limiter);

  // Stricter rate limiting for upload endpoints
  const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // Limit each IP to 10 uploads per hour
    message: {
      success: false,
      error: 'Upload limit exceeded. Please try again later.'
    }
  });

  // Body parsing middleware
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      success: true,
      message: 'StoryLofts ContentHive API is running',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: config.server.nodeEnv,
      platform: 'StoryLofts'
    });
  });

  // API routes
  app.use('/api/upload', uploadLimiter, uploadRouter);
  app.use('/api/content', contentRouter);

  // Root endpoint - Updated for StoryLofts
  app.get('/', (req, res) => {
    res.json({
      success: true,
      message: 'Welcome to StoryLofts ContentHive API',
      description: 'Backend API for StoryLofts video platform',
      documentation: '/api/docs',
      health: '/health',
      version: '1.0.0',
      platform: 'StoryLofts'
    });
  });

  // API documentation endpoint
  app.get('/api/docs', (req, res) => {
    res.json({
      success: true,
      message: 'StoryLofts ContentHive API Documentation',
      platform: 'StoryLofts',
      baseUrl: config.server.apiBaseUrl,
      endpoints: {
        upload: {
          'GET /api/upload/url': 'Get pre-signed upload URL',
          'POST /api/upload/direct': 'Direct upload to server',
          'POST /api/upload/complete': 'Complete upload process',
          'GET /api/upload/status/:id': 'Get upload status'
        },
        content: {
          'GET /api/content': 'List videos (paginated)',
          'GET /api/content/:id': 'Get specific video',
          'PUT /api/content/:id': 'Update video metadata',
          'DELETE /api/content/:id': 'Delete video',
          'GET /api/content/user/:userId': 'Get user videos'
        }
      },
      authentication: 'Bearer token (Auth0 JWT) required for most endpoints',
      rateLimit: {
        general: '100 requests per 15 minutes',
        uploads: '10 uploads per hour'
      }
    });
  });

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({
      success: false,
      error: 'Endpoint not found',
      message: `Cannot ${req.method} ${req.originalUrl}`,
      availableEndpoints: ['/health', '/api/docs', '/api/content', '/api/upload']
    });
  });

  // Global error handler
  app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Global error handler:', error);

    // Handle JWT errors
    if (error.name === 'UnauthorizedError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    // Handle multer errors
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large',
        maxSize: config.upload.maxFileSize
      });
    }

    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        error: 'Unexpected file field'
      });
    }

    // Handle validation errors
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({
        success: false,
        error: 'Invalid JSON in request body'
      });
    }

    // Default error response
    res.status(500).json({
      success: false,
      error: config.server.nodeEnv === 'development' ? error.message : 'Internal server error'
    });
  });

  return { app, config };
}

// Start server
async function startServer() {
  try {
    const { app, config } = await createApp();
    
    const PORT = config.server.port;
    
    app.listen(PORT, () => {
      console.log('🚀 StoryLofts ContentHive API Server Started');
      console.log('================================================');
      console.log(`📍 Port: ${PORT}`);
      console.log(`🌍 Environment: ${config.server.nodeEnv}`);
      console.log(`🔗 API URL: ${config.server.apiBaseUrl}`);
      console.log(`📚 Documentation: ${config.server.apiBaseUrl}/api/docs`);
      console.log(`💚 Health check: ${config.server.apiBaseUrl}/health`);
      console.log(`🏠 Platform: StoryLofts`);
      console.log('================================================');
      
      if (config.server.nodeEnv === 'development') {
        console.log('🔧 Development mode - CORS allows localhost origins');
        console.log('🔑 Secrets source:', config.secrets.useGoogleSecretManager ? 'Google Secret Manager' : 'Environment Variables');
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start the server
startServer();

export default createApp;