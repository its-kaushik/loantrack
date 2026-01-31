import bcrypt from 'bcrypt';
import prisma from '../lib/prisma.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';

export async function listUsers(tenantId: string) {
  return prisma.user.findMany({
    where: { tenantId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createUser(
  tenantId: string,
  data: { name: string; phone: string; email?: string; password: string; role: 'COLLECTOR' },
) {
  // Check phone uniqueness within tenant
  const existing = await prisma.user.findFirst({
    where: { tenantId, phone: data.phone },
  });
  if (existing) {
    throw AppError.conflict('A user with this phone number already exists in this tenant');
  }

  const passwordHash = await bcrypt.hash(data.password, config.bcrypt.rounds);

  return prisma.user.create({
    data: {
      tenantId,
      name: data.name,
      phone: data.phone,
      email: data.email,
      passwordHash,
      role: data.role,
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });
}

export async function updateUser(
  tenantId: string,
  userId: string,
  data: { name?: string; phone?: string; email?: string | null },
) {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
  });
  if (!user) {
    throw AppError.notFound('User not found');
  }

  // Check phone uniqueness if phone is being changed
  if (data.phone && data.phone !== user.phone) {
    const existing = await prisma.user.findFirst({
      where: { tenantId, phone: data.phone, id: { not: userId } },
    });
    if (existing) {
      throw AppError.conflict('A user with this phone number already exists in this tenant');
    }
  }

  return prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.email !== undefined && { email: data.email }),
    },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
  });
}

export async function deactivateUser(tenantId: string, userId: string, requestingUserId: string) {
  if (userId === requestingUserId) {
    throw AppError.badRequest('Cannot deactivate your own account');
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
  });
  if (!user) {
    throw AppError.notFound('User not found');
  }

  // Deactivate and revoke all refresh tokens
  await prisma.user.update({
    where: { id: userId },
    data: { isActive: false },
  });

  await prisma.refreshToken.updateMany({
    where: { userId, isRevoked: false },
    data: { isRevoked: true },
  });

  return { message: 'User deactivated successfully' };
}

export async function resetPassword(tenantId: string, userId: string, newPassword: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
  });
  if (!user) {
    throw AppError.notFound('User not found');
  }

  const passwordHash = await bcrypt.hash(newPassword, config.bcrypt.rounds);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  // Revoke all refresh tokens so user must re-login
  await prisma.refreshToken.updateMany({
    where: { userId, isRevoked: false },
    data: { isRevoked: true },
  });

  return { message: 'Password reset successfully' };
}
