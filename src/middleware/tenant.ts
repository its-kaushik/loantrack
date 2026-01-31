import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors.js';
import prisma from '../lib/prisma.js';

export async function requireTenant(req: Request, _res: Response, next: NextFunction) {
  const tenantId = req.user?.tenantId;

  // SUPER_ADMIN has no tenant — skip tenant check
  if (!tenantId) {
    if (req.user?.role === 'SUPER_ADMIN') {
      return next();
    }
    throw AppError.unauthorized('Missing tenant context');
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { status: true },
  });

  if (!tenant) {
    throw AppError.unauthorized('Tenant not found');
  }

  if (tenant.status !== 'ACTIVE') {
    throw AppError.forbidden(`Tenant is ${tenant.status.toLowerCase()}`);
  }

  req.tenantId = tenantId;
  next();
}
