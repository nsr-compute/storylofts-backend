// src/middleware/validation.ts - Complete Zod Validation Middleware
import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';

/**
 * Enhanced Request interface with requestId support
 */
interface RequestWithId extends Request {
  requestId?: string;
}

/**
 * A middleware factory that returns a validation middleware.
 * It uses a Zod schema to validate the request's body, query, and params.
 *
 * @param schema The Zod schema to validate against.
 * @returns An Express middleware function.
 */
export const validate = (schema: AnyZodObject) =>
  async (req: RequestWithId, res: Response, next: NextFunction) => {
    try {
      // Asynchronously parse and validate the request data.
      // This allows for async refinements in Zod schemas if needed.
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      
      // If validation is successful, pass control to the next middleware or route handler.
      return next();
    } catch (error) {
      // Check if the caught error is a ZodError instance.
      if (error instanceof ZodError) {
        // If it is, respond with a 400 Bad Request status and a structured
        // error object containing the validation issues.
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          message: 'Request validation failed. Please check your input data.',
          errors: error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message,
            received: (e as any).received // Type assertion for received property
          })),
          timestamp: new Date().toISOString(),
          requestId: req.requestId || generateRequestId()
        });
      }
      
      // If the error is not a ZodError, it's an unexpected server error.
      // Pass it to the global error handler.
      return next(error);
    }
  };

/**
 * Generate a unique request ID for tracking
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Legacy validation middleware for backward compatibility
 * @deprecated Use the new `validate` middleware instead
 */
export const validateRequest = validate;

export default validate;
