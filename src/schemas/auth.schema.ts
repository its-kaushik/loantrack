import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const loginSchema = z
  .object({
    phone: z.string().min(10).max(15).openapi({ example: '9876543210' }),
    password: z.string().min(1).openapi({ example: 'password123' }),
  })
  .openapi('LoginRequest');

export const refreshSchema = z
  .object({
    refresh_token: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
  })
  .openapi('RefreshRequest');

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1).openapi({ example: 'oldPassword123' }),
    new_password: z.string().min(8).openapi({ example: 'newPassword456' }),
  })
  .openapi('ChangePasswordRequest');

// --- Response schemas ---

export const loginResponseSchema = z
  .object({
    access_token: z.string().openapi({ example: 'eyJhbGciOiJIUzI1NiIs...' }),
    refresh_token: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }),
    expires_in: z.number().openapi({ example: 900 }),
    user: z.object({
      id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
      name: z.string().openapi({ example: 'Jane Admin' }),
      role: z.enum(['SUPER_ADMIN', 'ADMIN', 'COLLECTOR']).openapi({ example: 'ADMIN' }),
      tenant_id: z.string().uuid().nullable().openapi({ example: '660e8400-e29b-41d4-a716-446655440000' }),
    }),
  })
  .openapi('LoginResponse');

export const refreshResponseSchema = z
  .object({
    access_token: z.string().openapi({ example: 'eyJhbGciOiJIUzI1NiIs...' }),
    refresh_token: z.string().uuid().openapi({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' }),
    expires_in: z.number().openapi({ example: 900 }),
  })
  .openapi('RefreshResponse');

export const messageResponseSchema = z
  .object({
    message: z.string().openapi({ example: 'Operation completed successfully' }),
  })
  .openapi('MessageResponse');

export const getMeResponseSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    name: z.string().openapi({ example: 'Jane Admin' }),
    phone: z.string().openapi({ example: '9876543210' }),
    email: z.string().email().nullable().openapi({ example: 'jane@example.com' }),
    role: z.enum(['SUPER_ADMIN', 'ADMIN', 'COLLECTOR']).openapi({ example: 'ADMIN' }),
    tenantId: z.string().uuid().nullable().openapi({ example: '660e8400-e29b-41d4-a716-446655440000' }),
    isActive: z.boolean().openapi({ example: true }),
    createdAt: z.string().openapi({ example: '2025-01-15T10:30:00.000Z' }),
    tenant: z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        slug: z.string(),
        status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
      })
      .nullable(),
  })
  .openapi('GetMeResponse');
