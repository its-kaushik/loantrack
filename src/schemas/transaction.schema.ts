import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// ─── Request Schemas ───────────────────────────────────────────────────────

export const createTransactionSchema = z
  .object({
    loan_id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    transaction_type: z
      .enum(['INTEREST_PAYMENT', 'PRINCIPAL_RETURN', 'DAILY_COLLECTION', 'PENALTY'])
      .openapi({ example: 'INTEREST_PAYMENT' }),
    amount: z.number().positive().openapi({ example: 2500 }),
    penalty_id: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    transaction_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .openapi({ example: '2026-02-15' }),
    effective_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .optional()
      .openapi({ example: '2026-02-15' }),
    notes: z.string().max(2000).optional().openapi({ example: 'Monthly interest payment' }),
  })
  .refine(
    (data) => {
      if (data.transaction_type === 'INTEREST_PAYMENT' && !data.effective_date) {
        return false;
      }
      return true;
    },
    { message: 'effective_date is required for INTEREST_PAYMENT', path: ['effective_date'] },
  )
  .openapi('CreateTransactionRequest');

// ─── Response Schemas ──────────────────────────────────────────────────────

export const transactionResponseSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    loanId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    transactionType: z.string().openapi({ example: 'INTEREST_PAYMENT' }),
    amount: z.number().openapi({ example: 2500 }),
    transactionDate: z.string().openapi({ example: '2026-02-15' }),
    effectiveDate: z.string().nullable().openapi({ example: '2026-02-15' }),
    approvalStatus: z.string().openapi({ example: 'APPROVED' }),
    notes: z.string().nullable().openapi({ example: null }),
    createdAt: z.string().openapi({ example: '2026-02-15T10:30:00.000Z' }),
  })
  .openapi('TransactionResponse');

// ─── Bulk Collection Schemas ─────────────────────────────────────────────

export const bulkCollectionItemSchema = z
  .object({
    loan_id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    amount: z.number().positive().openapi({ example: 500 }),
    transaction_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .openapi({ example: '2026-02-15' }),
    notes: z.string().max(2000).optional().openapi({ example: 'Daily collection' }),
  })
  .openapi('BulkCollectionItem');

export const bulkCollectionSchema = z
  .object({
    collections: z.array(bulkCollectionItemSchema).min(1).max(100),
  })
  .openapi('BulkCollectionRequest');

// ─── Reject Transaction Schema ───────────────────────────────────────────

export const rejectTransactionSchema = z
  .object({
    rejection_reason: z.string().min(1).max(2000).openapi({ example: 'Incorrect amount recorded' }),
  })
  .openapi('RejectTransactionRequest');

// ─── Param Schemas ───────────────────────────────────────────────────────

export const transactionIdParamSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  })
  .openapi('TransactionIdParam');

// ─── Query Schemas ───────────────────────────────────────────────────────

export const listTransactionsQuerySchema = z
  .object({
    approval_status: z.string().optional().openapi({ example: 'PENDING' }),
    transaction_type: z.string().optional().openapi({ example: 'DAILY_COLLECTION' }),
    loan_id: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    collected_by: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    page: z.string().optional().default('1').openapi({ example: '1' }),
    limit: z.string().optional().default('20').openapi({ example: '20' }),
  })
  .transform((data) => ({
    approval_status: data.approval_status as 'PENDING' | 'APPROVED' | 'REJECTED' | undefined,
    transaction_type: data.transaction_type as
      | 'INTEREST_PAYMENT'
      | 'PRINCIPAL_RETURN'
      | 'DAILY_COLLECTION'
      | 'PENALTY'
      | undefined,
    loan_id: data.loan_id,
    collected_by: data.collected_by,
    page: Math.max(1, parseInt(data.page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(data.limit, 10) || 20)),
  }))
  .openapi('ListTransactionsQuery');

export const pendingTransactionsQuerySchema = z
  .object({
    page: z.string().optional().default('1').openapi({ example: '1' }),
    limit: z.string().optional().default('20').openapi({ example: '20' }),
  })
  .transform((data) => ({
    page: Math.max(1, parseInt(data.page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(data.limit, 10) || 20)),
  }))
  .openapi('PendingTransactionsQuery');

// ─── Detail Response Schemas ─────────────────────────────────────────────

export const transactionDetailResponseSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    loanId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    loanNumber: z.string().openapi({ example: 'ML-2026-0001' }),
    borrowerName: z.string().openapi({ example: 'John Doe' }),
    transactionType: z.string().openapi({ example: 'INTEREST_PAYMENT' }),
    amount: z.number().openapi({ example: 2500 }),
    transactionDate: z.string().openapi({ example: '2026-02-15' }),
    effectiveDate: z.string().nullable().openapi({ example: '2026-02-15' }),
    approvalStatus: z.string().openapi({ example: 'PENDING' }),
    collectedById: z.string().uuid().nullable().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    collectorName: z.string().nullable().openapi({ example: 'Jane Collector' }),
    approvedById: z.string().uuid().nullable().openapi({ example: null }),
    approvedAt: z.string().nullable().openapi({ example: null }),
    rejectionReason: z.string().nullable().openapi({ example: null }),
    notes: z.string().nullable().openapi({ example: null }),
    createdAt: z.string().openapi({ example: '2026-02-15T10:30:00.000Z' }),
  })
  .openapi('TransactionDetailResponse');

export const bulkCollectionResponseSchema = z
  .object({
    created: z.number().openapi({ example: 3 }),
    failed: z.number().openapi({ example: 0 }),
    results: z.array(
      z.object({
        success: z.boolean().openapi({ example: true }),
        transaction: transactionResponseSchema.optional(),
        error: z.string().optional().openapi({ example: 'Loan not found' }),
      }),
    ),
  })
  .openapi('BulkCollectionResponse');
