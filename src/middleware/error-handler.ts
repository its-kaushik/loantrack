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
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  // Log unexpected errors in non-test environments
  if (process.env['NODE_ENV'] !== 'test') {
    console.error('Unhandled error:', err);
  }

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      details: [],
    },
  });
}
