// src/routes/health.ts - Health Check API Routes (FIXED)
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { healthCheckService } from '../services/health';
import { validate } from '../middleware/validation';
import rateLimit from 'express-rate-limit';
import { AuthenticatedRequest } from '../types/auth';

const router = Router();

// ============================================================================
// ZOD SCHEMAS - Health Check Validation
// ============================================================================

// Optional query parameters for health checks
const healthQuerySchema = z.object({
  query: z.object({
    format: z.enum(['json', 'text', 'prometheus']).optional().default('json'),
    timeout: z.string()
      .transform(val => parseInt(val, 10))
      .refine(val => !isNaN(val) && val > 0 && val <= 30000, 'Timeout must be between 1 and 30000ms')
      .optional()
      .default('5000'),
    includeDetails: z.string()
      .transform(val => val.toLowerCase() === 'true')
      .optional()
      .default('false')
  })
});

// Metrics query parameters
const metricsQuerySchema = z.object({
  query: z.object({
    format: z.enum(['prometheus', 'json']).optional().default('prometheus'),
    services: z.string()
      .transform(val => val.split(',').map(s => s.trim()).filter(Boolean))
      .optional()
  })
});

// ============================================================================
// RATE LIMITING
// ============================================================================

// Rate limiting for health checks (prevent abuse)
const healthLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: {
    success: false,
    error: 'Too many health check requests',
    message: 'Health check rate limit exceeded. Please wait before making more requests.',
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false
});

// More restrictive rate limiting for detailed checks
const detailedHealthLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute for detailed checks
  message: {
    success: false,
    error: 'Too many detailed health check requests',
    message: 'Detailed health check rate limit exceeded. Please wait before making more requests.',
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false
});

// ============================================================================
// HEALTH CHECK ROUTES
// ============================================================================

/**
 * GET /health
 * Basic health check (fast response, minimal validation)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();
    const health = await healthCheckService.getBasicHealth();
    const responseTime = Date.now() - startTime;

    // Add performance headers
    res.set({
      'X-Response-Time': `${responseTime}ms`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Health-Check': 'basic'
    });

    res.json({
      ...health,
      responseTime,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Basic health check failed:', error);
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: 'Health check failed',
      message: 'Basic health check encountered an error',
      timestamp: new Date().toISOString(),
      responseTime: 0
    });
  }
});

/**
 * GET /health/detailed
 * Comprehensive health check with external service monitoring
 * Enhanced with optional query parameters for customization
 */
router.get('/detailed', 
  detailedHealthLimiter,
  validate(healthQuerySchema),
  async (req: Request, res: Response) => {
    try {
      const startTime = Date.now();
      
      const healthCheck = await healthCheckService.runAllChecks();
      
      const responseTime = Date.now() - startTime;

      // Return appropriate HTTP status based on overall health
      let statusCode = 200;
      if (healthCheck.overall === 'degraded') {
        statusCode = 200; // Still functional but with issues
      } else if (healthCheck.overall === 'unhealthy') {
        statusCode = 503; // Service unavailable
      }

      // Add performance and health headers
      res.set({
        'X-Response-Time': `${responseTime}ms`,
        'X-Health-Status': healthCheck.overall,
        'X-Services-Checked': healthCheck.services?.length.toString() || '0',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Health-Check': 'detailed'
      });

      res.status(statusCode).json({
        success: healthCheck.overall !== 'unhealthy',
        ...healthCheck,
        responseTime,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Detailed health check failed:', error);
      res.status(503).json({
        success: false,
        overall: 'unhealthy',
        error: 'Health check system failure',
        message: 'Detailed health check encountered a system error',
        timestamp: new Date().toISOString(),
        responseTime: 0
      });
    }
  }
);

/**
 * GET /health/auth0
 * Check only Auth0 connectivity
 * Enhanced with timeout validation
 */
router.get('/auth0', 
  healthLimiter,
  validate(healthQuerySchema),
  async (req: Request, res: Response) => {
    try {
      const startTime = Date.now();
      
      const auth0Status = await healthCheckService.checkAuth0();
      const responseTime = Date.now() - startTime;
      const statusCode = auth0Status.status === 'healthy' ? 200 : 503;
      
      res.set({
        'X-Response-Time': `${responseTime}ms`,
        'X-Service-Status': auth0Status.status,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Health-Check': 'auth0'
      });

      res.status(statusCode).json({
        success: auth0Status.status === 'healthy',
        ...auth0Status,
        responseTime,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Auth0 health check failed:', error);
      res.status(503).json({
        success: false,
        service: 'Auth0',
        status: 'unhealthy',
        error: 'Auth0 health check failed',
        message: 'Unable to verify Auth0 service connectivity',
        timestamp: new Date().toISOString(),
        responseTime: 0
      });
    }
  }
);

/**
 * GET /health/secrets
 * Check Google Secret Manager connectivity
 * Enhanced with timeout validation
 */
router.get('/secrets', 
  healthLimiter,
  validate(healthQuerySchema),
  async (req: Request, res: Response) => {
    try {
      const startTime = Date.now();
      
      const secretsStatus = await healthCheckService.checkSecretManager();
      const responseTime = Date.now() - startTime;
      const statusCode = secretsStatus.status === 'healthy' ? 200 : 503;
      
      res.set({
        'X-Response-Time': `${responseTime}ms`,
        'X-Service-Status': secretsStatus.status,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Health-Check': 'secrets'
      });

      res.status(statusCode).json({
        success: secretsStatus.status === 'healthy',
        ...secretsStatus,
        responseTime,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Secret Manager health check failed:', error);
      res.status(503).json({
        success: false,
        service: 'Google Secret Manager',
        status: 'unhealthy',
        error: 'Secret Manager health check failed',
        message: 'Unable to verify Google Secret Manager connectivity',
        timestamp: new Date().toISOString(),
        responseTime: 0
      });
    }
  }
);

/**
 * GET /health/storage
 * Check Backblaze B2 connectivity
 * Enhanced with timeout validation
 */
router.get('/storage', 
  healthLimiter,
  validate(healthQuerySchema),
  async (req: Request, res: Response) => {
    try {
      const startTime = Date.now();
      
      const storageStatus = await healthCheckService.checkBackblaze();
      const responseTime = Date.now() - startTime;
      const statusCode = storageStatus.status === 'healthy' ? 200 : 503;
      
      res.set({
        'X-Response-Time': `${responseTime}ms`,
        'X-Service-Status': storageStatus.status,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Health-Check': 'storage'
      });

      res.status(statusCode).json({
        success: storageStatus.status === 'healthy',
        ...storageStatus,
        responseTime,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Backblaze health check failed:', error);
      res.status(503).json({
        success: false,
        service: 'Backblaze B2',
        status: 'unhealthy',
        error: 'Storage health check failed',
        message: 'Unable to verify Backblaze B2 storage connectivity',
        timestamp: new Date().toISOString(),
        responseTime: 0
      });
    }
  }
);

/**
 * GET /health/database
 * Check PostgreSQL database connectivity
 * New endpoint for database-specific health checks
 */
router.get('/database',
  healthLimiter,
  validate(healthQuerySchema),
  async (req: Request, res: Response) => {
    try {
      const startTime = Date.now();
      
      const databaseStatus = await healthCheckService.checkDatabase();
      const responseTime = Date.now() - startTime;
      const statusCode = databaseStatus.status === 'healthy' ? 200 : 503;
      
      res.set({
        'X-Response-Time': `${responseTime}ms`,
        'X-Service-Status': databaseStatus.status,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Health-Check': 'database'
      });

      res.status(statusCode).json({
        success: databaseStatus.status === 'healthy',
        ...databaseStatus,
        responseTime,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Database health check failed:', error);
      res.status(503).json({
        success: false,
        service: 'PostgreSQL Database',
        status: 'unhealthy',
        error: 'Database health check failed',
        message: 'Unable to verify PostgreSQL database connectivity',
        timestamp: new Date().toISOString(),
        responseTime: 0
      });
    }
  }
);

/**
 * GET /health/metrics
 * Prometheus-style metrics for monitoring systems
 * Enhanced with format validation and service filtering
 */
router.get('/metrics',
  validate(metricsQuerySchema),
  async (req: Request, res: Response) => {
    try {
      const { format, services } = req.query as any;
      const startTime = Date.now();
      
      const healthCheck = await healthCheckService.runAllChecks();
      const responseTime = Date.now() - startTime;

      // Filter services if specified
      let filteredServices = healthCheck.services || [];
      if (services && services.length > 0) {
        filteredServices = filteredServices.filter(service => 
          services.some((s: string) => 
            service.service.toLowerCase().includes(s.toLowerCase())
          )
        );
      }

      if (format === 'json') {
        res.set({
          'Content-Type': 'application/json',
          'X-Response-Time': `${responseTime}ms`,
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });

        res.json({
          success: true,
          overall: healthCheck.overall,
          services: filteredServices,
          uptime: healthCheck.uptime,
          timestamp: new Date().toISOString(),
          responseTime
        });
      } else {
        // Generate Prometheus-style metrics
        const metrics = [
          '# HELP storylofts_api_health Overall API health status',
          '# TYPE storylofts_api_health gauge',
          `storylofts_api_health{status="${healthCheck.overall}"} ${healthCheck.overall === 'healthy' ? 1 : 0}`,
          '',
          '# HELP storylofts_service_health Individual service health status',
          '# TYPE storylofts_service_health gauge',
          ...filteredServices.map(service => 
            `storylofts_service_health{service="${service.service.toLowerCase().replace(/\s+/g, '_')}"} ${service.status === 'healthy' ? 1 : 0}`
          ),
          '',
          '# HELP storylofts_service_response_time Service response time in milliseconds',
          '# TYPE storylofts_service_response_time gauge',
          ...filteredServices.map(service => 
            `storylofts_service_response_time{service="${service.service.toLowerCase().replace(/\s+/g, '_')}"} ${service.responseTime || 0}`
          ),
          '',
          '# HELP storylofts_uptime_seconds Application uptime in seconds',
          '# TYPE storylofts_uptime_seconds counter',
          `storylofts_uptime_seconds ${Math.floor((healthCheck.uptime || 0) / 1000)}`,
          '',
          '# HELP storylofts_health_check_duration_ms Health check execution time',
          '# TYPE storylofts_health_check_duration_ms gauge',
          `storylofts_health_check_duration_ms ${responseTime}`,
          ''
        ].join('\n');

        res.set({
          'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
          'X-Response-Time': `${responseTime}ms`,
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        
        res.send(metrics);
      }

    } catch (error) {
      console.error('Metrics endpoint failed:', error);
      
      if (req.query.format === 'json') {
        res.status(503).json({
          success: false,
          error: 'Metrics generation failed',
          message: 'Unable to generate health metrics',
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(503)
          .set('Content-Type', 'text/plain')
          .send('# Health check failed - unable to generate metrics\n');
      }
    }
  }
);

/**
 * GET /health/readiness
 * Kubernetes readiness probe endpoint
 * Simple binary ready/not-ready check
 */
router.get('/readiness', async (req: Request, res: Response) => {
  try {
    // FIXED: Check if checkReadiness method exists before calling
    let isReady = true;
    
    if (typeof (healthCheckService as any).checkReadiness === 'function') {
      isReady = await (healthCheckService as any).checkReadiness();
    } else {
      // Fallback: check basic health if checkReadiness doesn't exist
      const health = await healthCheckService.getBasicHealth();
      isReady = health.status === 'healthy';
    }
    
    if (isReady) {
      res.status(200).json({
        success: true,
        status: 'ready',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({
        success: false,
        status: 'not-ready',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Readiness check failed:', error);
    res.status(503).json({
      success: false,
      status: 'not-ready',
      error: 'Readiness check failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /health/liveness
 * Kubernetes liveness probe endpoint
 * Basic application alive check
 */
router.get('/liveness', async (req: Request, res: Response) => {
  try {
    // Simple check - if we can respond, we're alive
    res.status(200).json({
      success: true,
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'dead',
      error: 'Liveness check failed',
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
