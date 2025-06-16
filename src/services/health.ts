// src/services/health.ts - StoryLofts Health Check Service with Database Integration
import { Request, Response } from 'express';
import { config, configPromise } from '../config';
import { backblazeService } from './backblaze';
import { secretsService } from './secrets';
import { db } from './database';
import { HealthCheckResponse } from '../types';

interface HealthStatus {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  details?: any;
  error?: string;
}

interface HealthCheckResult {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  services: HealthStatus[];
  summary: {
    healthy: number;
    degraded: number;
    unhealthy: number;
    total: number;
  };
}

// Interface for JWKS response
interface JWKSResponse {
  keys?: Array<{
    kty: string;
    use?: string;
    kid: string;
    x5t?: string;
    n?: string;
    e?: string;
    [key: string]: any;
  }>;
}

export class HealthCheckService {
  private startTime = Date.now();

  /**
   * Get detailed health check (required by server.ts)
   */
  async getDetailedHealth(): Promise<HealthCheckResponse> {
    const timestamp = new Date().toISOString();
    const uptime = Date.now() - this.startTime;
    const version = '1.0.0';
    const environment = config.server.nodeEnv;

    // Check all services in parallel
    const [databaseHealth, auth0Health, storageHealth] = await Promise.allSettled([
      this.checkDatabase(),
      this.checkAuth0(),
      this.checkBackblaze()
    ]);

    const services = {
      database: databaseHealth.status === 'fulfilled' 
        ? this.convertToSimpleHealth(databaseHealth.value)
        : { status: 'unhealthy' as const, responseTime: 0, error: 'Database check failed' },
      
      auth0: auth0Health.status === 'fulfilled' 
        ? this.convertToSimpleHealth(auth0Health.value)
        : { status: 'unhealthy' as const, responseTime: 0, error: 'Auth0 check failed' },
      
      storage: storageHealth.status === 'fulfilled' 
        ? this.convertToSimpleHealth(storageHealth.value)
        : { status: 'unhealthy' as const, responseTime: 0, error: 'Storage check failed' }
    };

    // Overall status is healthy if all critical services are healthy
    const isHealthy = services.database.status === 'healthy' && 
                     services.auth0.status === 'healthy' && 
                     services.storage.status === 'healthy';

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp,
      uptime,
      version,
      environment,
      services
    };
  }

  /**
   * Convert detailed health status to simple format for server.ts compatibility
   */
  private convertToSimpleHealth(healthStatus: HealthStatus): {
    status: 'healthy' | 'unhealthy';
    responseTime: number;
    error?: string;
  } {
    return {
      status: healthStatus.status === 'healthy' ? 'healthy' : 'unhealthy',
      responseTime: healthStatus.responseTime,
      error: healthStatus.error
    };
  }

  /**
   * Check PostgreSQL database connectivity
   */
  async checkDatabase(): Promise<HealthStatus> {
    const start = Date.now();
    
    try {
      const healthCheck = await db.healthCheck();
      const responseTime = Date.now() - start;
      
      return {
        service: 'Database',
        status: healthCheck.healthy ? 'healthy' : 'unhealthy',
        responseTime: healthCheck.responseTime,
        error: healthCheck.error,
        details: {
          type: 'PostgreSQL',
          connected: healthCheck.healthy,
          host: 'DigitalOcean Managed Database',
          ssl: 'enabled'
        }
      };
    } catch (error: any) {
      return {
        service: 'Database',
        status: 'unhealthy',
        responseTime: Date.now() - start,
        error: error.message,
        details: {
          type: 'PostgreSQL',
          connected: false,
          host: 'DigitalOcean Managed Database'
        }
      };
    }
  }

  /**
   * Check Auth0 connectivity
   */
  async checkAuth0(): Promise<HealthStatus> {
    const start = Date.now();
    
    try {
      // Test JWKS endpoint connectivity
      const response = await fetch(`https://${config.auth0.domain}/.well-known/jwks.json`, {
        method: 'GET',
        headers: { 'User-Agent': 'StoryLofts-HealthCheck/1.0' },
        signal: AbortSignal.timeout(5000)
      });

      const responseTime = Date.now() - start;

      if (!response.ok) {
        return {
          service: 'Auth0',
          status: 'unhealthy',
          responseTime,
          error: `HTTP ${response.status}: ${response.statusText}`,
          details: {
            domain: config.auth0.domain,
            endpoint: `${config.auth0.domain}/.well-known/jwks.json`,
            httpStatus: response.status
          }
        };
      }

      // Explicit type assertion to fix TypeScript error
      const jwks = await response.json() as JWKSResponse;
      
      return {
        service: 'Auth0',
        status: 'healthy',
        responseTime,
        details: {
          domain: config.auth0.domain,
          audience: config.auth0.audience,
          keysCount: jwks.keys?.length || 0,
          endpoint: `${config.auth0.domain}/.well-known/jwks.json`
        }
      };

    } catch (error: any) {
      return {
        service: 'Auth0',
        status: 'unhealthy',
        responseTime: Date.now() - start,
        error: error.message,
        details: {
          domain: config.auth0.domain,
          endpoint: `${config.auth0.domain}/.well-known/jwks.json`
        }
      };
    }
  }

  /**
   * Check Google Secret Manager connectivity
   */
  async checkSecretManager(): Promise<HealthStatus> {
    const start = Date.now();

    if (!config.secrets.useGoogleSecretManager) {
      return {
        service: 'Google Secret Manager',
        status: 'healthy',
        responseTime: 0,
        details: { mode: 'disabled', source: 'environment_variables' }
      };
    }

    try {
      // Test secret access with a lightweight operation
      const testSecret = await secretsService.getSecret('auth0-domain');
      const responseTime = Date.now() - start;

      return {
        service: 'Google Secret Manager',
        status: 'healthy',
        responseTime,
        details: {
          projectId: config.secrets.googleCloudProjectId,
          secretAccess: 'functional',
          testSecret: testSecret ? 'accessible' : 'not_found'
        }
      };

    } catch (error: any) {
      return {
        service: 'Google Secret Manager',
        status: 'unhealthy',
        responseTime: Date.now() - start,
        error: error.message,
        details: {
          projectId: config.secrets.googleCloudProjectId,
          mode: 'enabled'
        }
      };
    }
  }

  /**
   * Check Backblaze B2 connectivity
   */
  async checkBackblaze(): Promise<HealthStatus> {
    const start = Date.now();

    try {
      // Test B2 authorization (lightweight operation)
      await backblazeService.initialize();
      const responseTime = Date.now() - start;

      // Test bucket access with a simple list operation
      await backblazeService.listFiles(undefined, undefined, 1);
      
      return {
        service: 'Backblaze B2',
        status: 'healthy',
        responseTime,
        details: {
          bucketId: config.backblaze.bucketId.substring(0, 8) + '...',
          bucketName: config.backblaze.bucketName,
          authorization: 'successful',
          bucketAccess: 'functional'
        }
      };

    } catch (error: any) {
      const responseTime = Date.now() - start;
      
      // Determine if it's an auth issue or bucket issue
      const isAuthError = error.message.includes('authorization') || 
                         error.message.includes('unauthorized') ||
                         error.message.includes('invalid key');

      return {
        service: 'Backblaze B2',
        status: isAuthError ? 'unhealthy' : 'degraded',
        responseTime,
        error: error.message,
        details: {
          bucketName: config.backblaze.bucketName,
          errorType: isAuthError ? 'authentication' : 'bucket_access'
        }
      };
    }
  }

  /**
   * Run all health checks
   */
  async runAllChecks(): Promise<HealthCheckResult> {
    // Run all checks in parallel for faster response
    const [auth0, secretManager, backblaze, database] = await Promise.all([
      this.checkAuth0(),
      this.checkSecretManager(),
      this.checkBackblaze(),
      this.checkDatabase()
    ]);

    const services = [auth0, secretManager, backblaze, database];
    
    // Calculate overall status
    const unhealthyCount = services.filter(s => s.status === 'unhealthy').length;
    const degradedCount = services.filter(s => s.status === 'degraded').length;
    const healthyCount = services.filter(s => s.status === 'healthy').length;

    let overall: 'healthy' | 'degraded' | 'unhealthy';
    if (unhealthyCount > 0) {
      overall = 'unhealthy';
    } else if (degradedCount > 0) {
      overall = 'degraded';
    } else {
      overall = 'healthy';
    }

    return {
      overall,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: '1.0.0',
      environment: config.server.nodeEnv,
      services,
      summary: {
        healthy: healthyCount,
        degraded: degradedCount,
        unhealthy: unhealthyCount,
        total: services.length
      }
    };
  }

  /**
   * Get basic health status (fast check)
   */
  async getBasicHealth(): Promise<any> {
    return {
      success: true,
      message: 'StoryLofts ContentHive API is running',
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: '1.0.0',
      environment: config.server.nodeEnv,
      platform: 'StoryLofts'
    };
  }
}

// Export both names for compatibility
export const healthCheckService = new HealthCheckService();
export const healthService = healthCheckService;
export default healthService;
