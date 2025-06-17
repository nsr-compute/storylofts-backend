// Install security packages
// npm install helmet cors

// src/middleware/security.ts
import helmet from 'helmet'
import cors from 'cors'
import { Application } from 'express'

export const configureSecurityMiddleware = (app: Application) => {
  // Helmet for security headers
  app.use(helmet({
    // Content Security Policy
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", "https://api.storylofts.com"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    // Cross-Origin Embedder Policy
    crossOriginEmbedderPolicy: { policy: "credentialless" },
    // Cross-Origin Opener Policy
    crossOriginOpenerPolicy: { policy: "same-origin" },
    // Cross-Origin Resource Policy
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // DNS Prefetch Control
    dnsPrefetchControl: { allow: false },
    // Expect-CT
    expectCt: {
      enforce: true,
      maxAge: 30 * 24 * 60 * 60, // 30 days
    },
    // Frame Guard
    frameguard: { action: 'deny' },
    // Hide X-Powered-By
    hidePoweredBy: true,
    // HTTP Strict Transport Security
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true
    },
    // IE No Open
    ieNoOpen: true,
    // No Sniff
    noSniff: true,
    // Origin Agent Cluster
    originAgentCluster: true,
    // Permitted Cross-Domain Policies
    permittedCrossDomainPolicies: false,
    // Referrer Policy
    referrerPolicy: { policy: "no-referrer" },
    // X-XSS-Protection
    xssFilter: true,
  }))

  // CORS configuration
  const corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (mobile apps, etc.)
      if (!origin) return callback(null, true)

      const allowedOrigins = getAllowedOrigins()
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        console.warn(`CORS blocked origin: ${origin}`)
        callback(new Error('Not allowed by CORS'), false)
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'Cache-Control',
      'Pragma'
    ],
    exposedHeaders: [
      'X-Total-Count',
      'X-Page-Count',
      'X-Rate-Limit-Remaining'
    ],
    maxAge: 86400 // 24 hours
  }

  app.use(cors(corsOptions))
}

// Get allowed origins based on environment
const getAllowedOrigins = (): string[] => {
  const baseOrigins = [
    'https://storylofts.com',
    'https://www.storylofts.com',
    'https://app.storylofts.com'
  ]

  if (process.env.NODE_ENV === 'development') {
    return [
      ...baseOrigins,
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000'
    ]
  }

  if (process.env.NODE_ENV === 'staging') {
    return [
      ...baseOrigins,
      'https://staging.storylofts.com',
      'https://preview.storylofts.com'
    ]
  }

  // Production - only allow production domains
  return baseOrigins
}

// Rate limiting middleware
import rateLimit from 'express-rate-limit'

export const configureRateLimiting = (app: Application) => {
  // General API rate limiting
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per windowMs
    message: {
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: Math.ceil(15 * 60) // 15 minutes in seconds
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Skip rate limiting for health checks
      return req.path === '/health'
    }
  })

  // Strict rate limiting for upload endpoints
  const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 50, // Limit each IP to 50 upload requests per hour
    message: {
      error: 'Upload rate limit exceeded, please try again later.',
      retryAfter: Math.ceil(60 * 60) // 1 hour in seconds
    },
    standardHeaders: true,
    legacyHeaders: false
  })

  // Auth rate limiting
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Limit each IP to 20 auth requests per 15 minutes
    message: {
      error: 'Too many authentication attempts, please try again later.',
      retryAfter: Math.ceil(15 * 60)
    },
    standardHeaders: true,
    legacyHeaders: false
  })

  // Apply rate limiting
  app.use('/api', generalLimiter)
  app.use('/api/upload', uploadLimiter)
  app.use('/api/auth', authLimiter)
}

// Updated server.ts integration
// src/server.ts (partial update)
import { configureSecurityMiddleware, configureRateLimiting } from './middleware/security'

// Apply security middleware early in the stack
configureSecurityMiddleware(app)
configureRateLimiting(app)

// ... rest of your middleware and routes
