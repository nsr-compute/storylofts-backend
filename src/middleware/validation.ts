import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';

/**
 * A middleware factory that returns a validation middleware.
 * It uses a Zod schema to validate the request's body, query, and params.
 *
 * @param schema The Zod schema to validate against.
 * @returns An Express middleware function.
 */
export const validate = (schema: AnyZodObject) =>
  async (req: Request, res: Response, next: NextFunction) => {
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
          errors: error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
      }

      // If the error is not a ZodError, it's an unexpected server error.
      // Pass it to the global error handler.
      return next(error);
    }
  };
