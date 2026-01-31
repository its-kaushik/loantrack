import { randomUUID, createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import prisma from '../lib/prisma.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';
import type { UserRole } from '@prisma/client';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function signAccessToken(userId: string, tenantId: string | null, role: UserRole): string {
  return jwt.sign({ userId, tenantId, role }, config.jwt.secret, {
    expiresIn: config.jwt.accessExpiry as jwt.SignOptions['expiresIn'],
  });
}

export async function login(phone: string, password: string) {
  // Find user by phone (could be tenant user or super admin)
  const user = await prisma.user.findFirst({
    where: { phone },
    include: { tenant: { select: { id: true, status: true } } },
  });

  if (!user) {
    throw AppError.unauthorized('Invalid phone or password');
  }

  if (!user.isActive) {
    throw AppError.unauthorized('User account is deactivated');
  }

  const passwordMatch = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatch) {
    throw AppError.unauthorized('Invalid phone or password');
  }

  // Check tenant status for tenant-scoped users
  if (user.tenant && user.tenant.status !== 'ACTIVE') {
    throw AppError.forbidden(`Tenant is ${user.tenant.status.toLowerCase()}`);
  }

  const accessToken = signAccessToken(user.id, user.tenantId, user.role);

  // Create refresh token
  const rawRefreshToken = randomUUID();
  const tokenHash = hashToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + config.jwt.refreshExpiryDays * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  return {
    access_token: accessToken,
    refresh_token: rawRefreshToken,
    expires_in: 900,
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      tenant_id: user.tenantId,
    },
  };
}

export async function refresh(rawRefreshToken: string) {
  const tokenHash = hashToken(rawRefreshToken);

  const storedToken = await prisma.refreshToken.findFirst({
    where: { tokenHash, isRevoked: false },
    include: { user: { select: { id: true, tenantId: true, role: true, isActive: true } } },
  });

  if (!storedToken) {
    throw AppError.unauthorized('Invalid refresh token');
  }

  if (storedToken.expiresAt < new Date()) {
    throw AppError.unauthorized('Refresh token expired');
  }

  if (!storedToken.user.isActive) {
    throw AppError.unauthorized('User account is deactivated');
  }

  // Revoke old token (rotation)
  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: { isRevoked: true },
  });

  // Issue new pair
  const { user } = storedToken;
  const accessToken = signAccessToken(user.id, user.tenantId, user.role);

  const newRawRefreshToken = randomUUID();
  const newTokenHash = hashToken(newRawRefreshToken);
  const expiresAt = new Date(Date.now() + config.jwt.refreshExpiryDays * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: newTokenHash,
      expiresAt,
    },
  });

  return {
    access_token: accessToken,
    refresh_token: newRawRefreshToken,
    expires_in: 900,
  };
}

export async function logout(userId: string) {
  await prisma.refreshToken.updateMany({
    where: { userId, isRevoked: false },
    data: { isRevoked: true },
  });
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!user) {
    throw AppError.notFound('User not found');
  }

  const match = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!match) {
    throw AppError.badRequest('Current password is incorrect');
  }

  const newHash = await bcrypt.hash(newPassword, config.bcrypt.rounds);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newHash },
  });
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      role: true,
      tenantId: true,
      isActive: true,
      createdAt: true,
      tenant: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
        },
      },
    },
  });

  if (!user) {
    throw AppError.notFound('User not found');
  }

  return user;
}
