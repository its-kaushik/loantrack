import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// ─── Param Schemas ─────────────────────────────────────────────────────────

export const expenseIdParamSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  })
  .openapi('ExpenseIdParam');

// ─── Request Schemas ───────────────────────────────────────────────────────

export const createExpenseSchema = z
  .object({
    category: z.enum(['TRAVEL', 'SALARY', 'OFFICE', 'LEGAL', 'MISC']).openapi({ example: 'TRAVEL' }),
    amount: z.number().positive().openapi({ example: 5000 }),
    description: z.string().max(2000).optional().openapi({ example: 'Travel to branch office' }),
    expense_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .openapi({ example: '2026-01-15' }),
  })
  .openapi('CreateExpenseRequest');

export const updateExpenseSchema = z
  .object({
    category: z.enum(['TRAVEL', 'SALARY', 'OFFICE', 'LEGAL', 'MISC']).optional().openapi({ example: 'OFFICE' }),
    amount: z.number().positive().optional().openapi({ example: 7500 }),
    description: z.string().max(2000).optional().openapi({ example: 'Updated description' }),
    expense_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .optional()
      .openapi({ example: '2026-01-20' }),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'At least one field must be provided',
  })
  .openapi('UpdateExpenseRequest');

// ─── Query Schemas ─────────────────────────────────────────────────────────

export const listExpensesQuerySchema = z
  .object({
    category: z.enum(['TRAVEL', 'SALARY', 'OFFICE', 'LEGAL', 'MISC']).optional().openapi({ example: 'TRAVEL' }),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .optional()
      .openapi({ example: '2026-01-01' }),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .optional()
      .openapi({ example: '2026-01-31' }),
    page: z.string().optional().default('1').openapi({ example: '1' }),
    limit: z.string().optional().default('20').openapi({ example: '20' }),
  })
  .transform((data) => ({
    category: data.category,
    from: data.from,
    to: data.to,
    page: Math.max(1, parseInt(data.page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(data.limit, 10) || 20)),
  }))
  .openapi('ListExpensesQuery');

// ─── Response Schemas ──────────────────────────────────────────────────────

export const expenseResponseSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    tenantId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    category: z.string().openapi({ example: 'TRAVEL' }),
    amount: z.number().openapi({ example: 5000 }),
    description: z.string().nullable().openapi({ example: 'Travel to branch office' }),
    expenseDate: z.string().openapi({ example: '2026-01-15' }),
    isDeleted: z.boolean().openapi({ example: false }),
    createdById: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    createdAt: z.string().openapi({ example: '2026-01-15T10:30:00.000Z' }),
    updatedAt: z.string().openapi({ example: '2026-01-15T10:30:00.000Z' }),
  })
  .openapi('ExpenseResponse');

export const expensesListResponseSchema = z.array(expenseResponseSchema).openapi('ExpensesListResponse');
