import { Request, Response, NextFunction } from 'express';
import { expressjwt } from 'express-jwt';
import jwksClient from 'jwks-rsa';
import { config } from '../config';
import { AuthenticatedRequest } from '../types';

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

// Extract user info from JWT
export const extractUserInfo = (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
  if (req.auth) {
    req.user = {
      sub: req.auth.sub as string,
      email: req.auth.email as string,
      name: req.auth.name as string,
      picture: req.auth.picture as string
    };
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

// Required authentication middleware
export const requireAuth = [validateJWT, extractUserInfo];
