import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// ─── Request Schemas ───────────────────────────────────────────────────────

export const createFundEntrySchema = z
  .object({
    entry_type: z.enum(['INJECTION', 'WITHDRAWAL']).openapi({ example: 'INJECTION' }),
    amount: z.number().positive().openapi({ example: 500000 }),
    description: z.string().max(2000).optional().openapi({ example: 'Initial capital injection' }),
    entry_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .openapi({ example: '2026-01-01' }),
  })
  .openapi('CreateFundEntryRequest');

// ─── Query Schemas ─────────────────────────────────────────────────────────

export const listFundEntriesQuerySchema = z
  .object({
    entry_type: z.enum(['INJECTION', 'WITHDRAWAL']).optional().openapi({ example: 'INJECTION' }),
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
    entry_type: data.entry_type,
    from: data.from,
    to: data.to,
    page: Math.max(1, parseInt(data.page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(data.limit, 10) || 20)),
  }))
  .openapi('ListFundEntriesQuery');

// ─── Response Schemas ──────────────────────────────────────────────────────

export const fundEntryResponseSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    tenantId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    entryType: z.string().openapi({ example: 'INJECTION' }),
    amount: z.number().openapi({ example: 500000 }),
    description: z.string().nullable().openapi({ example: 'Initial capital injection' }),
    entryDate: z.string().openapi({ example: '2026-01-01' }),
    createdById: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    createdAt: z.string().openapi({ example: '2026-01-01T10:30:00.000Z' }),
  })
  .openapi('FundEntryResponse');

export const fundSummaryResponseSchema = z
  .object({
    totalCapitalInvested: z.string().openapi({ example: '500000.00' }),
    moneyDeployed: z.string().openapi({ example: '350000.00' }),
    totalInterestEarned: z.string().openapi({ example: '25000.00' }),
    moneyLostToDefaults: z.string().openapi({ example: '10000.00' }),
    totalExpenses: z.string().openapi({ example: '5000.00' }),
    revenueForgone: z.string().openapi({ example: '2000.00' }),
    netProfit: z.string().openapi({ example: '10000.00' }),
    cashInHand: z.string().openapi({ example: '160000.00' }),
  })
  .openapi('FundSummaryResponse');

export const reconciliationResponseSchema = z
  .object({
    queryResult: z.string().openapi({ example: '160000.00' }),
    bottomUpResult: z.string().openapi({ example: '160000.00' }),
    matches: z.boolean().openapi({ example: true }),
  })
  .openapi('ReconciliationResponse');
