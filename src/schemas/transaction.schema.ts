import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// ─── Request Schemas ───────────────────────────────────────────────────────

export const createTransactionSchema = z
  .object({
    loan_id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    transaction_type: z
      .enum(['INTEREST_PAYMENT', 'PRINCIPAL_RETURN', 'DAILY_COLLECTION'])
      .openapi({ example: 'INTEREST_PAYMENT' }),
    amount: z.number().positive().openapi({ example: 2500 }),
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
