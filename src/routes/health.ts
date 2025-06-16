// src/routes/health.ts - Health Check API Routes
import { Router, Request, Response } from 'express';
import { healthCheckService } from '../services/health';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiting for health checks (prevent abuse)
const healthLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: {
    success: false,
    error: 'Too many health check requests'
  }
});

/**
 * GET /health
 * Basic health check (fast response)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const health = await healthCheckService.getBasicHealth();
    res.json(health);
  } catch (error) {
    console.error('Basic health check failed:', error);
    res.status(503).json({
      success: false,
      error: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /health/detailed
 * Comprehensive health check with external service monitoring
 */
router.get('/detailed', healthLimiter, async (req: Request, res: Response) => {
  try {
    const healthCheck = await healthCheckService.runAllChecks();
    
    // Return appropriate HTTP status based on overall health
    let statusCode = 200;
    if (healthCheck.overall === 'degraded') {
      statusCode = 200; // Still functional but with issues
    } else if (healthCheck.overall === 'unhealthy') {
      statusCode = 503; // Service unavailable
    }

    res.status(statusCode).json({
      success: healthCheck.overall !== 'unhealthy',
      ...healthCheck
    });

  } catch (error) {
    console.error('Detailed health check failed:', error);
    res.status(503).json({
      success: false,
      overall: 'unhealthy',
      error: 'Health check system failure',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /health/auth0
 * Check only Auth0 connectivity
 */
router.get('/auth0', healthLimiter, async (req: Request, res: Response) => {
  try {
    const auth0Status = await healthCheckService.checkAuth0();
    const statusCode = auth0Status.status === 'healthy' ? 200 : 503;
    
    res.status(statusCode).json({
      success: auth0Status.status === 'healthy',
      ...auth0Status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      service: 'Auth0',
      status: 'unhealthy',
      error: 'Auth0 health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /health/secrets
 * Check Google Secret Manager connectivity
 */
router.get('/secrets', healthLimiter, async (req: Request, res: Response) => {
  try {
    const secretsStatus = await healthCheckService.checkSecretManager();
    const statusCode = secretsStatus.status === 'healthy' ? 200 : 503;
    
    res.status(statusCode).json({
      success: secretsStatus.status === 'healthy',
      ...secretsStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      service: 'Google Secret Manager',
      status: 'unhealthy',
      error: 'Secret Manager health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /health/storage
 * Check Backblaze B2 connectivity
 */
router.get('/storage', healthLimiter, async (req: Request, res: Response) => {
  try {
    const storageStatus = await healthCheckService.checkBackblaze();
    const statusCode = storageStatus.status === 'healthy' ? 200 : 503;
    
    res.status(statusCode).json({
      success: storageStatus.status === 'healthy',
      ...storageStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      service: 'Backblaze B2',
      status: 'unhealthy',
      error: 'Storage health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /health/metrics
 * Prometheus-style metrics for monitoring systems
 */
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const healthCheck = await healthCheckService.runAllChecks();
    
    // Generate Prometheus-style metrics
    const metrics = [
      '# HELP storylofts_api_health Overall API health status',
      '# TYPE storylofts_api_health gauge',
      `storylofts_api_health{status="${healthCheck.overall}"} ${healthCheck.overall === 'healthy' ? 1 : 0}`,
      '',
      '# HELP storylofts_service_health Individual service health status',
      '# TYPE storylofts_service_health gauge',
      ...healthCheck.services.map(service => 
        `storylofts_service_health{service="${service.service.toLowerCase().replace(/\s+/g, '_')}"} ${service.status === 'healthy' ? 1 : 0}`
      ),
      '',
      '# HELP storylofts_service_response_time Service response time in milliseconds',
      '# TYPE storylofts_service_response_time gauge',
      ...healthCheck.services.map(service => 
        `storylofts_service_response_time{service="${service.service.toLowerCase().replace(/\s+/g, '_')}"} ${service.responseTime}`
      ),
      '',
      '# HELP storylofts_uptime_seconds Application uptime in seconds',
      '# TYPE storylofts_uptime_seconds counter',
      `storylofts_uptime_seconds ${Math.floor(healthCheck.uptime / 1000)}`,
      ''
    ].join('\n');

    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics);

  } catch (error) {
    res.status(503).set('Content-Type', 'text/plain').send('# Health check failed\n');
  }
});

export { router as healthRouter };