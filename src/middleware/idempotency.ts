import type { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma.js';
import { AppError } from '../utils/errors.js';

export function requireIdempotencyKey() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['idempotency-key'];

    if (!key || typeof key !== 'string') {
      throw AppError.badRequest('Idempotency-Key header is required');
    }

    if (key.length > 255) {
      throw AppError.badRequest('Idempotency-Key must be at most 255 characters');
    }

    const existing = await prisma.idempotencyKey.findUnique({
      where: { key },
    });

    if (existing) {
      // Check if expired
      if (existing.expiresAt < new Date()) {
        await prisma.idempotencyKey.delete({ where: { key } });
        // Proceed as new request
        req.idempotencyKey = key;
        return next();
      }

      // Validate same tenant + user
      if (existing.tenantId !== req.tenantId || existing.userId !== req.user!.userId) {
        throw AppError.conflict('Idempotency-Key already used by a different user or tenant');
      }

      // Return cached response
      return res.status(existing.responseStatus).json(existing.responseBody);
    }

    // New key — set on request and proceed
    req.idempotencyKey = key;
    next();
  };
}
