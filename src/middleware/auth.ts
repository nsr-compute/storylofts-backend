// src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import { expressjwt } from 'express-jwt';
import jwksClient from 'jwks-rsa';
import { config } from '../config';
import { AuthenticatedRequest } from '../types/auth';

// JWKS client for Auth0
const client = jwksClient({
  jwksUri: `https://${config.auth0.domain}/.well-known/jwks.json`,
  requestHeaders: {},
  timeout: 30000
});

// Get signing key from JWKS - Fixed for express-jwt compatibility
function getKey(header: any): Promise<string> {
  return new Promise((resolve, reject) => {
    client.getSigningKey(header.kid, (err, key) => {
      if (err) {
        return reject(err);
      }
      const signingKey = key?.getPublicKey();
      if (!signingKey) {
        return reject(new Error('Unable to get signing key'));
      }
      resolve(signingKey);
    });
  });
}

// JWT validation middleware
export const validateJWT = expressjwt({
  secret: getKey,
  audience: config.auth0.audience,
  issuer: `https://${config.auth0.domain}/`,
  algorithms: ['RS256']
});

// FIXED: Extract user info from JWT with proper optional handling
export const extractUserInfo = (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
  if (req.auth) {
    // FIXED: Keep properties as optional - don't cast undefined to string
    req.user = {
      sub: req.auth.sub as string,
      email: req.auth.email,      // Keep as string | undefined
      name: req.auth.name,        // Keep as string | undefined
      picture: req.auth.picture   // Keep as string | undefined
    };
  }
  next();
};

// Type guard to ensure required user properties exist
export const requireFullAuth = (req: AuthenticatedRequest): req is AuthenticatedRequest & { 
  user: { sub: string; email: string; name: string; picture?: string } 
} => {
  return !!(req.user?.sub && req.user?.email && req.user?.name);
};

// Middleware to require complete user information
export const requireCompleteUserInfo = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!requireFullAuth(req)) {
    return res.status(401).json({ 
      success: false,
      error: 'Complete user information required (email and name must be present)' 
    });
  }
  next();
};

// Optional authentication middleware
export const optionalAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }
  
  validateJWT(req, res, (err) => {
    if (err) {
      // Log error but continue without authentication
      console.warn('Optional auth failed:', err.message);
    }
    extractUserInfo(req as AuthenticatedRequest, res, next);
  });
};

// Required authentication middleware (basic)
export const requireAuth = [validateJWT, extractUserInfo];

// Required authentication middleware with complete user info
export const requireAuthWithUserInfo = [validateJWT, extractUserInfo, requireCompleteUserInfo];

// Export alias for compatibility with routes
export const authenticateToken = requireAuth;
