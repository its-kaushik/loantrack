import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// ─── Param Schemas ────────────────────────────────────────────────────────

export const tenantIdParamSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  })
  .openapi('TenantIdParam');

// ─── Query Schemas ────────────────────────────────────────────────────────

export const listTenantsQuerySchema = z
  .object({
    status: z.string().optional().openapi({ example: 'ACTIVE' }),
    page: z.string().optional().default('1').openapi({ example: '1' }),
    limit: z.string().optional().default('20').openapi({ example: '20' }),
  })
  .transform((data) => ({
    status: data.status as 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' | undefined,
    page: Math.max(1, parseInt(data.page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(data.limit, 10) || 20)),
  }))
  .openapi('ListTenantsQuery');

// ─── Request Schemas ──────────────────────────────────────────────────────

export const createTenantSchema = z
  .object({
    name: z.string().min(1).max(200).openapi({ example: 'Sunrise Finance' }),
    slug: z
      .string()
      .min(2)
      .max(50)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens')
      .openapi({ example: 'sunrise-finance' }),
    owner_name: z.string().min(1).max(200).openapi({ example: 'Ramesh Kumar' }),
    owner_phone: z.string().min(10).max(15).openapi({ example: '9876543210' }),
    owner_email: z.string().email().max(255).optional().openapi({ example: 'ramesh@example.com' }),
    address: z.string().max(2000).optional().openapi({ example: '123 Main St, Chennai' }),
    admin_name: z.string().min(1).max(100).openapi({ example: 'Admin User' }),
    admin_phone: z.string().min(10).max(15).openapi({ example: '9876543211' }),
    admin_password: z.string().min(8).openapi({ example: 'SecurePass123' }),
  })
  .openapi('CreateTenantRequest');

// ─── Response Schemas ─────────────────────────────────────────────────────

export const tenantResponseSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    name: z.string().openapi({ example: 'Sunrise Finance' }),
    slug: z.string().openapi({ example: 'sunrise-finance' }),
    ownerName: z.string().openapi({ example: 'Ramesh Kumar' }),
    ownerPhone: z.string().openapi({ example: '9876543210' }),
    ownerEmail: z.string().nullable().openapi({ example: 'ramesh@example.com' }),
    address: z.string().nullable().openapi({ example: '123 Main St, Chennai' }),
    status: z.string().openapi({ example: 'ACTIVE' }),
    subscriptionPlan: z.string().nullable().openapi({ example: null }),
    createdAt: z.string().openapi({ example: '2026-01-01T10:30:00.000Z' }),
    updatedAt: z.string().openapi({ example: '2026-01-01T10:30:00.000Z' }),
  })
  .openapi('TenantResponse');

export const tenantDetailResponseSchema = tenantResponseSchema
  .extend({
    activeLoansCount: z.number().openapi({ example: 42 }),
    totalUsersCount: z.number().openapi({ example: 5 }),
    totalCustomersCount: z.number().openapi({ example: 120 }),
  })
  .openapi('TenantDetailResponse');

export const createTenantResponseSchema = z
  .object({
    tenant: tenantResponseSchema,
    admin: z.object({
      id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
      name: z.string().openapi({ example: 'Admin User' }),
      phone: z.string().openapi({ example: '9876543211' }),
      email: z.string().nullable().openapi({ example: null }),
      role: z.string().openapi({ example: 'ADMIN' }),
    }),
  })
  .openapi('CreateTenantResponse');

export const platformStatsResponseSchema = z
  .object({
    tenants: z.object({
      active: z.number().openapi({ example: 10 }),
      suspended: z.number().openapi({ example: 2 }),
      deactivated: z.number().openapi({ example: 1 }),
      total: z.number().openapi({ example: 13 }),
    }),
    loans: z.object({
      active: z.number().openapi({ example: 150 }),
      closed: z.number().openapi({ example: 50 }),
      defaulted: z.number().openapi({ example: 10 }),
      writtenOff: z.number().openapi({ example: 5 }),
      cancelled: z.number().openapi({ example: 3 }),
      total: z.number().openapi({ example: 218 }),
    }),
    totalUsers: z.number().openapi({ example: 45 }),
  })
  .openapi('PlatformStatsResponse');
