import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const migrateMonthlyLoanSchema = z
  .object({
    loan_type: z.literal('MONTHLY').openapi({ example: 'MONTHLY' }),
    borrower_id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    principal_amount: z.number().positive().openapi({ example: 100000 }),
    interest_rate: z.number().positive().openapi({ example: 2.5 }),
    disbursement_date: z
      .string()
      .regex(dateRegex, 'Date must be YYYY-MM-DD')
      .openapi({ example: '2025-06-15' }),
    expected_months: z.number().int().positive().optional().openapi({ example: 12 }),
    remaining_principal: z.number().positive().openapi({ example: 80000 }),
    last_interest_paid_through: z
      .string()
      .regex(dateRegex, 'Date must be YYYY-MM-DD')
      .openapi({ example: '2025-12-15' }),
    guarantor_id: z.string().uuid().optional().openapi({ example: '660e8400-e29b-41d4-a716-446655440000' }),
    collateral_description: z.string().max(2000).optional().openapi({ example: 'Gold necklace' }),
    collateral_estimated_value: z.number().positive().optional().openapi({ example: 50000 }),
    notes: z.string().max(2000).optional().openapi({ example: 'Migrated from old system' }),
  })
  .openapi('MigrateMonthlyLoanRequest');

export const migrateDailyLoanSchema = z
  .object({
    loan_type: z.literal('DAILY').openapi({ example: 'DAILY' }),
    borrower_id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    principal_amount: z.number().positive().openapi({ example: 100000 }),
    interest_rate: z.number().positive().openapi({ example: 5 }),
    disbursement_date: z
      .string()
      .regex(dateRegex, 'Date must be YYYY-MM-DD')
      .openapi({ example: '2025-06-10' }),
    term_days: z.number().int().positive().openapi({ example: 120 }),
    grace_days: z.number().int().min(0).optional().openapi({ example: 7 }),
    total_base_collected_so_far: z.number().min(0).openapi({ example: 50000 }),
    guarantor_id: z.string().uuid().optional().openapi({ example: '660e8400-e29b-41d4-a716-446655440000' }),
    collateral_description: z.string().max(2000).optional().openapi({ example: 'Gold necklace' }),
    collateral_estimated_value: z.number().positive().optional().openapi({ example: 50000 }),
    notes: z.string().max(2000).optional().openapi({ example: 'Migrated from old system' }),
    pre_existing_penalties: z
      .array(
        z.object({
          days_overdue: z.number().int().positive().openapi({ example: 45 }),
          months_charged: z.number().int().positive().openapi({ example: 2 }),
          penalty_amount: z.number().positive().openapi({ example: 5000 }),
          status: z.enum(['PENDING', 'PAID']).openapi({ example: 'PENDING' }),
        }),
      )
      .optional()
      .openapi({ example: [] }),
  })
  .openapi('MigrateDailyLoanRequest');

export const migrateLoanSchema = z
  .discriminatedUnion('loan_type', [migrateMonthlyLoanSchema, migrateDailyLoanSchema])
  .openapi('MigrateLoanRequest');
