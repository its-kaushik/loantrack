import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// ─── Param Schemas ─────────────────────────────────────────────────────────

export const penaltyIdParamSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  })
  .openapi('PenaltyIdParam');

// ─── Request Schemas ───────────────────────────────────────────────────────

export const imposePenaltySchema = z
  .object({
    override_amount: z.number().positive().optional().openapi({ example: 5000 }),
    notes: z.string().max(2000).optional().openapi({ example: 'Penalty for overdue loan' }),
  })
  .openapi('ImposePenaltyRequest');

export const waivePenaltySchema = z
  .object({
    waive_amount: z.number().positive().openapi({ example: 1000 }),
    notes: z.string().max(2000).optional().openapi({ example: 'Partial waiver granted' }),
  })
  .openapi('WaivePenaltyRequest');

export const waiveInterestSchema = z
  .object({
    effective_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .openapi({ example: '2026-02-15' }),
    waive_amount: z.number().positive().openapi({ example: 2500 }),
    notes: z.string().max(2000).optional().openapi({ example: 'Interest waiver for cycle' }),
  })
  .openapi('WaiveInterestRequest');

// ─── Query Schemas ─────────────────────────────────────────────────────────

export const listPenaltiesQuerySchema = z
  .object({
    page: z.string().optional().default('1').openapi({ example: '1' }),
    limit: z.string().optional().default('20').openapi({ example: '20' }),
  })
  .transform((data) => ({
    page: Math.max(1, parseInt(data.page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(data.limit, 10) || 20)),
  }))
  .openapi('ListPenaltiesQuery');

export const listWaiversQuerySchema = z
  .object({
    page: z.string().optional().default('1').openapi({ example: '1' }),
    limit: z.string().optional().default('20').openapi({ example: '20' }),
  })
  .transform((data) => ({
    page: Math.max(1, parseInt(data.page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(data.limit, 10) || 20)),
  }))
  .openapi('ListWaiversQuery');

// ─── Response Schemas ──────────────────────────────────────────────────────

export const penaltyResponseSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    loanId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    daysOverdue: z.number().openapi({ example: 45 }),
    monthsCharged: z.number().openapi({ example: 2 }),
    penaltyAmount: z.number().openapi({ example: 5000 }),
    waivedAmount: z.number().openapi({ example: 0 }),
    netPayable: z.number().openapi({ example: 5000 }),
    imposedDate: z.string().openapi({ example: '2026-01-31' }),
    status: z.string().openapi({ example: 'PENDING' }),
    amountCollected: z.number().openapi({ example: 0 }),
    notes: z.string().nullable().openapi({ example: null }),
    createdById: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    createdAt: z.string().openapi({ example: '2026-01-31T10:30:00.000Z' }),
  })
  .openapi('PenaltyResponse');

export const penaltyCalculationResponseSchema = z
  .object({
    penalty: penaltyResponseSchema,
    calculation: z.object({
      daysOverdue: z.number().openapi({ example: 45 }),
      totalMonthsOwed: z.number().openapi({ example: 2 }),
      monthsAlreadyPenalised: z.number().openapi({ example: 0 }),
      incrementalMonths: z.number().openapi({ example: 2 }),
      principalAmount: z.number().openapi({ example: 100000 }),
      interestRate: z.number().openapi({ example: 5 }),
      calculatedAmount: z.number().openapi({ example: 10000 }),
      wasOverridden: z.boolean().openapi({ example: false }),
    }),
  })
  .openapi('PenaltyCalculationResponse');

export const waiverResponseSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    loanId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    transactionType: z.string().openapi({ example: 'PENALTY_WAIVER' }),
    amount: z.number().openapi({ example: 1000 }),
    transactionDate: z.string().openapi({ example: '2026-01-31' }),
    effectiveDate: z.string().nullable().openapi({ example: '2026-02-15' }),
    penaltyId: z.string().uuid().nullable().openapi({ example: null }),
    notes: z.string().nullable().openapi({ example: null }),
    createdAt: z.string().openapi({ example: '2026-01-31T10:30:00.000Z' }),
  })
  .openapi('WaiverResponse');
