export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details: unknown[];

  constructor(code: ErrorCode, statusCode: number, message: string, details: unknown[] = []) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(message: string, details: unknown[] = []): AppError {
    return new AppError('VALIDATION_ERROR', 400, message, details);
  }

  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError('UNAUTHORIZED', 401, message);
  }

  static forbidden(message = 'Insufficient permissions'): AppError {
    return new AppError('FORBIDDEN', 403, message);
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError('NOT_FOUND', 404, message);
  }

  static conflict(message: string): AppError {
    return new AppError('CONFLICT', 409, message);
  }

  static internal(message = 'Internal server error'): AppError {
    return new AppError('INTERNAL_ERROR', 500, message);
  }
}
