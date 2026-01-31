import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';
import prisma from '../lib/prisma.js';
import type { UserRole } from '#generated/prisma/enums.js';

interface JwtPayload {
  userId: string;
  tenantId: string | null;
  role: UserRole;
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw AppError.unauthorized('Missing or invalid Authorization header');
  }

  const token = header.slice(7);

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, config.jwt.secret) as JwtPayload;
  } catch {
    throw AppError.unauthorized('Invalid or expired access token');
  }

  // Verify user is still active
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { isActive: true },
  });

  if (!user || !user.isActive) {
    throw AppError.unauthorized('User account is deactivated');
  }

  req.user = {
    userId: payload.userId,
    tenantId: payload.tenantId,
    role: payload.role,
  };

  next();
}
