import bcrypt from 'bcrypt';
import prisma from '../lib/prisma.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';
import type { TenantStatus } from '../generated/prisma/enums.js';

const tenantSelect = {
  id: true,
  name: true,
  slug: true,
  ownerName: true,
  ownerPhone: true,
  ownerEmail: true,
  address: true,
  status: true,
  subscriptionPlan: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function createTenant(data: {
  name: string;
  slug: string;
  owner_name: string;
  owner_phone: string;
  owner_email?: string;
  address?: string;
  admin_name: string;
  admin_phone: string;
  admin_password: string;
}) {
  return prisma.$transaction(async (tx) => {
    // Check slug uniqueness
    const existing = await tx.tenant.findUnique({
      where: { slug: data.slug },
      select: { id: true },
    });
    if (existing) {
      throw AppError.conflict(`Tenant with slug '${data.slug}' already exists`);
    }

    // Create tenant
    const tenant = await tx.tenant.create({
      data: {
        name: data.name,
        slug: data.slug,
        ownerName: data.owner_name,
        ownerPhone: data.owner_phone,
        ownerEmail: data.owner_email || null,
        address: data.address || null,
        status: 'ACTIVE',
      },
      select: tenantSelect,
    });

    // Check admin phone uniqueness within new tenant
    const existingUser = await tx.user.findFirst({
      where: { tenantId: tenant.id, phone: data.admin_phone },
      select: { id: true },
    });
    if (existingUser) {
      throw AppError.conflict(`User with phone '${data.admin_phone}' already exists in this tenant`);
    }

    // Hash admin password and create admin user
    const passwordHash = await bcrypt.hash(data.admin_password, config.bcrypt.rounds);
    const admin = await tx.user.create({
      data: {
        tenantId: tenant.id,
        name: data.admin_name,
        phone: data.admin_phone,
        email: null,
        passwordHash,
        role: 'ADMIN',
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        role: true,
      },
    });

    return { tenant, admin };
  });
}

export async function listTenants(query: {
  status?: TenantStatus;
  page: number;
  limit: number;
}) {
  const where: { status?: TenantStatus } = {};
  if (query.status) {
    where.status = query.status;
  }

  const [data, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      select: tenantSelect,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.tenant.count({ where }),
  ]);

  return {
    data,
    pagination: { page: query.page, limit: query.limit, total },
  };
}

export async function getTenant(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: tenantSelect,
  });

  if (!tenant) {
    throw AppError.notFound('Tenant not found');
  }

  const [activeLoansCount, totalUsersCount, totalCustomersCount] = await Promise.all([
    prisma.loan.count({ where: { tenantId, status: 'ACTIVE' } }),
    prisma.user.count({ where: { tenantId } }),
    prisma.customer.count({ where: { tenantId } }),
  ]);

  return {
    ...tenant,
    activeLoansCount,
    totalUsersCount,
    totalCustomersCount,
  };
}

export async function suspendTenant(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, status: true },
  });

  if (!tenant) {
    throw AppError.notFound('Tenant not found');
  }

  if (tenant.status !== 'ACTIVE') {
    throw AppError.badRequest(`Cannot suspend tenant with status '${tenant.status}'`);
  }

  return prisma.tenant.update({
    where: { id: tenantId },
    data: { status: 'SUSPENDED' },
    select: tenantSelect,
  });
}

export async function activateTenant(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, status: true },
  });

  if (!tenant) {
    throw AppError.notFound('Tenant not found');
  }

  if (tenant.status !== 'SUSPENDED') {
    throw AppError.badRequest(`Cannot activate tenant with status '${tenant.status}'`);
  }

  return prisma.tenant.update({
    where: { id: tenantId },
    data: { status: 'ACTIVE' },
    select: tenantSelect,
  });
}

export async function getPlatformStats() {
  const [tenantGroups, loanGroups, totalUsers] = await Promise.all([
    prisma.tenant.groupBy({
      by: ['status'],
      _count: { id: true },
    }),
    prisma.loan.groupBy({
      by: ['status'],
      _count: { id: true },
    }),
    prisma.user.count({
      where: { role: { not: 'SUPER_ADMIN' } },
    }),
  ]);

  const tenants = { active: 0, suspended: 0, deactivated: 0, total: 0 };
  for (const group of tenantGroups) {
    const key = group.status.toLowerCase() as keyof typeof tenants;
    tenants[key] = group._count.id;
    tenants.total += group._count.id;
  }

  const loans = { active: 0, closed: 0, defaulted: 0, writtenOff: 0, cancelled: 0, total: 0 };
  const loanStatusMap: Record<string, keyof typeof loans> = {
    ACTIVE: 'active',
    CLOSED: 'closed',
    DEFAULTED: 'defaulted',
    WRITTEN_OFF: 'writtenOff',
    CANCELLED: 'cancelled',
  };
  for (const group of loanGroups) {
    const key = loanStatusMap[group.status];
    if (key) {
      loans[key] = group._count.id;
      loans.total += group._count.id;
    }
  }

  return { tenants, loans, totalUsers };
}
