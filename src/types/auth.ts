// src/types/auth.ts - Authentication Type Definitions for StoryLofts
import { Request } from 'express';

/**
 * Extended Express Request interface with optional authentication data
 * 
 * IMPORTANT: email and name are optional because Auth0 JWT tokens 
 * don't guarantee these fields will always be present
 */
export interface AuthenticatedRequest extends Request {
  user?: {
    sub: string;           // Always present in Auth0 JWT
    email?: string;        // Optional - not guaranteed by Auth0
    name?: string;         // Optional - not guaranteed by Auth0
    picture?: string;      // Optional - profile picture URL
  };
  auth?: {
    sub: string;
    email?: string;
    name?: string;
    picture?: string;
    iat?: number;          // Issued at timestamp
    exp?: number;          // Expiration timestamp
    aud?: string;          // Audience
    iss?: string;          // Issuer
    [key: string]: any;    // Allow additional JWT claims
  };
}

/**
 * Type for routes that require complete user information
 * Use this for routes that specifically need email and name
 */
export interface FullyAuthenticatedRequest extends Request {
  user: {
    sub: string;
    email: string;         // Required
    name: string;          // Required
    picture?: string;
  };
  auth: {
    sub: string;
    email: string;
    name: string;
    picture?: string;
    iat?: number;
    exp?: number;
    aud?: string;
    iss?: string;
    [key: string]: any;
  };
}

/**
 * User information extracted from JWT token
 */
export interface JWTUser {
  sub: string;             // User ID from Auth0
  email?: string;          // User email (optional)
  name?: string;           // User display name (optional)
  picture?: string;        // Profile picture URL (optional)
  email_verified?: boolean; // Email verification status
  nickname?: string;       // User nickname
  updated_at?: string;     // Last profile update
}

/**
 * Auth0 JWT payload structure
 */
export interface Auth0JWTPayload {
  sub: string;             // Subject (user ID)
  aud: string;             // Audience
  iss: string;             // Issuer
  iat: number;             // Issued at
  exp: number;             // Expires at
  email?: string;          // User email
  name?: string;           // User name
  picture?: string;        // Profile picture
  email_verified?: boolean;
  nickname?: string;
  updated_at?: string;
  [key: string]: any;      // Additional custom claims
}

/**
 * Authentication middleware options
 */
export interface AuthMiddlewareOptions {
  required?: boolean;      // Whether authentication is required
  requireEmail?: boolean;  // Whether email is required
  requireName?: boolean;   // Whether name is required
  allowExpired?: boolean;  // Whether to allow expired tokens (for refresh)
}

/**
 * Type guard to check if user has required authentication
 */
export function isAuthenticated(req: AuthenticatedRequest): req is AuthenticatedRequest & { user: { sub: string } } {
  return !!(req.user?.sub);
}

/**
 * Type guard to check if user has complete profile information
 */
export function isFullyAuthenticated(req: AuthenticatedRequest): req is FullyAuthenticatedRequest {
  return !!(req.user?.sub && req.user?.email && req.user?.name);
}

/**
 * Type guard to check if user has email
 */
export function hasUserEmail(req: AuthenticatedRequest): req is AuthenticatedRequest & { user: { sub: string; email: string } } {
  return !!(req.user?.sub && req.user?.email);
}

/**
 * Type guard to check if user has name
 */
export function hasUserName(req: AuthenticatedRequest): req is AuthenticatedRequest & { user: { sub: string; name: string } } {
  return !!(req.user?.sub && req.user?.name);
}

/**
 * Helper function to safely get user ID
 */
export function getUserId(req: AuthenticatedRequest): string | undefined {
  return req.user?.sub;
}

/**
 * Helper function to safely get user email with fallback
 */
export function getUserEmail(req: AuthenticatedRequest, fallback?: string): string | undefined {
  return req.user?.email || fallback;
}

/**
 * Helper function to safely get user name with fallback
 */
export function getUserName(req: AuthenticatedRequest, fallback?: string): string | undefined {
  return req.user?.name || fallback;
}

/**
 * Error thrown when authentication is required but missing
 */
export class AuthenticationError extends Error {
  constructor(message: string = 'Authentication required') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Error thrown when user information is incomplete
 */
export class IncompleteUserError extends Error {
  constructor(missing: string[]) {
    super(`Incomplete user information. Missing: ${missing.join(', ')}`);
    this.name = 'IncompleteUserError';
  }
}
};
