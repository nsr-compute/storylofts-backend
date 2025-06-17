// src/config/security.ts - Enhanced security configuration
import helmet from 'helmet'
import { configService } from './index'

const config = configService.getConfig()

export const getHelmetConfig = () => {
  const isDevelopment = config.environment === 'development'
  
  return helmet({
    // Content Security Policy
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: isDevelopment 
          ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"] 
          : ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: [
          "'self'", 
          "https://api.storylofts.com",
          "https://*.backblazeb2.com",
          "https://*.auth0.com"
        ],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'", "https:", "blob:"],
        workerSrc: ["'self'", "blob:"],
        upgradeInsecureRequests: config.environment === 'production' ? [] : null,
      },
    },
    
    // Cross-Origin policies
    crossOriginEmbedderPolicy: false, // Disabled for video content
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    
    // DNS Prefetch Control
    dnsPrefetchControl: { allow: false },
    
    // Frame protection
    frameguard: { action: 'deny' },
    
    // Hide X-Powered-By header
    hidePoweredBy: true,
    
    // HTTP Strict Transport Security
    hsts: config.environment === 'production' ? {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true
    } : false,
    
    // IE specific protection
    ieNoOpen: true,
    
    // MIME type sniffing protection
    noSniff: true,
    
    // Origin Agent Cluster
    originAgentCluster: true,
    
    // Permitted Cross-Domain Policies
    permittedCrossDomainPolicies: false,
    
    // Referrer Policy
    referrerPolicy: { 
      policy: config.environment === 'production' 
        ? "strict-origin-when-cross-origin" 
        : "no-referrer" 
    },
    
    // XSS Protection
    xssFilter: true,
    
    // NOTE: expectCt has been REMOVED - deprecated in Helmet v7+
  })
}

// Enhanced CORS configuration
export const getCorsConfig = () => {
  const allowedOrigins = [
    config.frontend.url,
    'https://storylofts.com',
    'https://www.storylofts.com',
    'https://app.storylofts.com'
  ]
  
  if (config.environment === 'development') {
    allowedOrigins.push(
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3001',
      'http://localhost:8080'
    )
  }
  
  if (config.environment === 'staging') {
    allowedOrigins.push(
      'https://staging.storylofts.com',
      'https://preview.storylofts.com'
    )
  }
  
  return {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (mobile apps, Postman, curl)
      if (!origin) return callback(null, true)
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        console.warn(`🚫 CORS blocked origin: ${origin}`)
        const error = new Error(`Origin ${origin} not allowed by CORS policy`)
        error.name = 'CorsError'
        callback(error)
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization', 
      'X-Requested-With',
      'X-API-Key',
      'X-Upload-Session-Id',
      'X-Client-Version',
      'X-Request-ID'
    ],
    exposedHeaders: [
      'X-Total-Count',
      'X-Page-Count', 
      'X-Rate-Limit-Remaining',
      'X-Rate-Limit-Reset',
      'X-Request-ID'
    ],
    maxAge: 86400 // 24 hours
  }
}

// Rate limiting configurations
export const getRateLimitConfigs = () => {
  const createLimiter = (windowMs: number, max: number, message: string, skipSuccessfulRequests = false) => ({
    windowMs,
    max,
    message: {
      success: false,
      error: message,
      retryAfter: Math.ceil(windowMs / 1000) + ' seconds'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    keyGenerator: (req: any) => {
      // Use user ID if authenticated, otherwise IP
      return req.user?.sub || req.ip
    }
  })
  
  return {
    general: createLimiter(
      15 * 60 * 1000, // 15 minutes
      config.environment === 'development' ? 1000 : 200,
      'Too many requests, please try again later.'
    ),
    
    upload: createLimiter(
      60 * 60 * 1000, // 1 hour
      config.environment === 'development' ? 100 : 50,
      'Upload rate limit exceeded. Please try again later.',
      true // Don't count failed uploads against limit
    ),
    
    auth: createLimiter(
      15 * 60 * 1000, // 15 minutes
      config.environment === 'development' ? 100 : 20,
      'Too many authentication attempts. Please try again later.'
    ),
    
    search: createLimiter(
      60 * 1000, // 1 minute
      config.environment === 'development' ? 100 : 30,
      'Search rate limit exceeded. Please try again later.'
    )
  }
}

// Request ID middleware for tracking
export const requestIdMiddleware = (req: any, res: any, next: any) => {
  const requestId = req.headers['x-request-id'] || 
    `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  
  req.requestId = requestId
  res.setHeader('X-Request-ID', requestId)
  next()
}

// Security headers middleware
export const securityHeadersMiddleware = (req: any, res: any, next: any) => {
  // Custom security headers
  res.setHeader('X-API-Version', '1.0.0')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  
  // Remove server information
  res.removeHeader('X-Powered-By')
  res.removeHeader('Server')
  
  next()
}
