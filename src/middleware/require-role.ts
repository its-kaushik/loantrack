import type { Request, Response, NextFunction } from 'express';
import type { UserRole } from '@prisma/client';
import { AppError } from '../utils/errors.js';

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    if (!roles.includes(req.user.role)) {
      throw AppError.forbidden('Insufficient permissions');
    }

    next();
  };
}
