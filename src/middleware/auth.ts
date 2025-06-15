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

// Get signing key from JWKS
function getKey(header: any, callback: any) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      return callback(err);
    }
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
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
export const extractUserInfo = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
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