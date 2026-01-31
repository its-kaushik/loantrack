import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors.js';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  // Handle body-parser errors (payload too large, malformed JSON)
  const httpErr = err as Error & { status?: number; type?: string };
  if (httpErr.status && httpErr.status >= 400 && httpErr.status < 500) {
    res.status(httpErr.status).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: httpErr.message,
        details: [],
      },
    });
    return;
  }

  // Log unexpected errors in non-test environments
  if (process.env['NODE_ENV'] !== 'test') {
    console.error('Unhandled error:', err);
  }

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: [],
    },
  });
}
