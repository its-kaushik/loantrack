import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const createUserSchema = z
  .object({
    name: z.string().min(1).max(100).openapi({ example: 'John Collector' }),
    phone: z.string().min(10).max(15).openapi({ example: '9876543210' }),
    email: z.string().email().max(255).optional().openapi({ example: 'john@example.com' }),
    password: z.string().min(8).openapi({ example: 'securePass123' }),
    role: z.enum(['COLLECTOR']).openapi({ example: 'COLLECTOR' }),
  })
  .openapi('CreateUserRequest');

export const updateUserSchema = z
  .object({
    name: z.string().min(1).max(100).optional().openapi({ example: 'Updated Name' }),
    phone: z.string().min(10).max(15).optional().openapi({ example: '9876543211' }),
    email: z.string().email().max(255).nullable().optional().openapi({ example: 'updated@example.com' }),
  })
  .openapi('UpdateUserRequest');

export const resetPasswordSchema = z
  .object({
    new_password: z.string().min(8).openapi({ example: 'newSecurePass456' }),
  })
  .openapi('ResetPasswordRequest');

export const userIdParamSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  })
  .openapi('UserIdParam');

// --- Response schemas ---

export const userResponseSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    name: z.string().openapi({ example: 'John Collector' }),
    phone: z.string().openapi({ example: '9876543210' }),
    email: z.string().email().nullable().openapi({ example: 'john@example.com' }),
    role: z.enum(['SUPER_ADMIN', 'ADMIN', 'COLLECTOR']).openapi({ example: 'COLLECTOR' }),
    isActive: z.boolean().openapi({ example: true }),
    createdAt: z.string().openapi({ example: '2025-01-15T10:30:00.000Z' }),
  })
  .openapi('UserResponse');

export const usersListResponseSchema = z.array(userResponseSchema).openapi('UsersListResponse');
