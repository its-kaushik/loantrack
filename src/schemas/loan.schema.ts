import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// ─── Param Schemas ─────────────────────────────────────────────────────────

export const loanIdParamSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  })
  .openapi('LoanIdParam');

// ─── Query Schemas ─────────────────────────────────────────────────────────

export const listLoansQuerySchema = z
  .object({
    type: z.string().optional().openapi({ example: 'MONTHLY' }),
    status: z.string().optional().openapi({ example: 'ACTIVE' }),
    borrower_id: z.string().uuid().optional().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    search: z.string().optional().openapi({ example: 'ML-2026' }),
    page: z.string().optional().default('1').openapi({ example: '1' }),
    limit: z.string().optional().default('20').openapi({ example: '20' }),
  })
  .transform((data) => ({
    type: data.type as 'MONTHLY' | 'DAILY' | undefined,
    status: data.status as 'ACTIVE' | 'CLOSED' | 'DEFAULTED' | 'WRITTEN_OFF' | 'CANCELLED' | undefined,
    borrower_id: data.borrower_id,
    search: data.search,
    page: Math.max(1, parseInt(data.page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(data.limit, 10) || 20)),
  }))
  .openapi('ListLoansQuery');

export const listLoanTransactionsQuerySchema = z
  .object({
    page: z.string().optional().default('1').openapi({ example: '1' }),
    limit: z.string().optional().default('20').openapi({ example: '20' }),
  })
  .transform((data) => ({
    page: Math.max(1, parseInt(data.page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(data.limit, 10) || 20)),
  }))
  .openapi('ListLoanTransactionsQuery');

// ─── Request Schemas ───────────────────────────────────────────────────────

export const createMonthlyLoanSchema = z
  .object({
    loan_type: z.literal('MONTHLY').openapi({ example: 'MONTHLY' }),
    borrower_id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    principal_amount: z.number().positive().openapi({ example: 100000 }),
    interest_rate: z.number().positive().openapi({ example: 2.5 }),
    disbursement_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .openapi({ example: '2026-01-15' }),
    expected_months: z.number().int().positive().optional().openapi({ example: 12 }),
    guarantor_id: z.string().uuid().optional().openapi({ example: '660e8400-e29b-41d4-a716-446655440000' }),
    collateral_description: z.string().max(2000).optional().openapi({ example: 'Gold necklace' }),
    collateral_estimated_value: z.number().positive().optional().openapi({ example: 50000 }),
    notes: z.string().max(2000).optional().openapi({ example: 'First loan' }),
  })
  .openapi('CreateMonthlyLoanRequest');

export const createDailyLoanSchema = z
  .object({
    loan_type: z.literal('DAILY').openapi({ example: 'DAILY' }),
    borrower_id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    principal_amount: z.number().positive().openapi({ example: 100000 }),
    interest_rate: z.number().positive().openapi({ example: 5 }),
    disbursement_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .openapi({ example: '2026-01-10' }),
    term_days: z.number().int().positive().openapi({ example: 120 }),
    grace_days: z.number().int().min(0).optional().openapi({ example: 7 }),
    guarantor_id: z.string().uuid().optional().openapi({ example: '660e8400-e29b-41d4-a716-446655440000' }),
    collateral_description: z.string().max(2000).optional().openapi({ example: 'Gold necklace' }),
    collateral_estimated_value: z.number().positive().optional().openapi({ example: 50000 }),
    notes: z.string().max(2000).optional().openapi({ example: 'Daily loan' }),
  })
  .openapi('CreateDailyLoanRequest');

export const createLoanSchema = z
  .discriminatedUnion('loan_type', [createMonthlyLoanSchema, createDailyLoanSchema])
  .openapi('CreateLoanRequest');

// ─── Response Schemas ──────────────────────────────────────────────────────

export const loanResponseSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    loanNumber: z.string().openapi({ example: 'ML-2026-0001' }),
    loanType: z.enum(['MONTHLY', 'DAILY']).openapi({ example: 'MONTHLY' }),
    borrowerId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    borrowerName: z.string().openapi({ example: 'Rajesh Kumar' }),
    principalAmount: z.number().openapi({ example: 100000 }),
    interestRate: z.number().openapi({ example: 2.5 }),
    disbursementDate: z.string().openapi({ example: '2026-01-15' }),
    status: z.string().openapi({ example: 'ACTIVE' }),
    guarantorId: z.string().uuid().nullable().openapi({ example: null }),
    guarantorName: z.string().nullable().openapi({ example: null }),
    createdAt: z.string().openapi({ example: '2026-01-15T10:30:00.000Z' }),
  })
  .openapi('LoanResponse');

export const monthlyLoanDetailResponseSchema = loanResponseSchema
  .extend({
    remainingPrincipal: z.number().openapi({ example: 100000 }),
    billingPrincipal: z.number().openapi({ example: 100000 }),
    advanceInterestAmount: z.number().openapi({ example: 2500 }),
    expectedMonths: z.number().nullable().openapi({ example: 12 }),
    monthlyDueDay: z.number().openapi({ example: 15 }),
    collateralDescription: z.string().nullable().openapi({ example: 'Gold necklace' }),
    collateralEstimatedValue: z.number().nullable().openapi({ example: 50000 }),
    notes: z.string().nullable().openapi({ example: 'First loan' }),
    closureDate: z.string().nullable().openapi({ example: null }),
    closedById: z.string().uuid().nullable().openapi({ example: null }),
    // Computed fields
    monthlyInterestDue: z.number().openapi({ example: 2500 }),
    nextDueDate: z.string().nullable().openapi({ example: '2026-02-15' }),
    isOverdue: z.boolean().openapi({ example: false }),
    totalInterestCollected: z.number().openapi({ example: 5000 }),
    monthsActive: z.number().openapi({ example: 2 }),
  })
  .openapi('MonthlyLoanDetailResponse');

export const loanTransactionResponseSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    transactionType: z.string().openapi({ example: 'INTEREST_PAYMENT' }),
    amount: z.number().openapi({ example: 2500 }),
    transactionDate: z.string().openapi({ example: '2026-02-15' }),
    effectiveDate: z.string().nullable().openapi({ example: '2026-02-15' }),
    approvalStatus: z.string().openapi({ example: 'APPROVED' }),
    notes: z.string().nullable().openapi({ example: null }),
    createdAt: z.string().openapi({ example: '2026-02-15T10:30:00.000Z' }),
  })
  .openapi('LoanTransactionResponse');

export const paymentStatusCycleSchema = z
  .object({
    cycleYear: z.number().openapi({ example: 2026 }),
    cycleMonth: z.number().openapi({ example: 2 }),
    dueDate: z.string().openapi({ example: '2026-02-15' }),
    interestDue: z.number().openapi({ example: 2500 }),
    interestPaid: z.number().openapi({ example: 2500 }),
    interestWaived: z.number().openapi({ example: 0 }),
    isSettled: z.boolean().openapi({ example: true }),
    billingPrincipalForCycle: z.number().openapi({ example: 100000 }),
  })
  .openapi('PaymentStatusCycle');

export const paymentStatusResponseSchema = z
  .object({
    loanId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    loanNumber: z.string().openapi({ example: 'ML-2026-0001' }),
    cycles: z.array(paymentStatusCycleSchema),
  })
  .openapi('PaymentStatusResponse');

export const dailyLoanDetailResponseSchema = loanResponseSchema
  .extend({
    termDays: z.number().openapi({ example: 120 }),
    totalRepaymentAmount: z.number().openapi({ example: 120000 }),
    dailyPaymentAmount: z.number().openapi({ example: 1000 }),
    termEndDate: z.string().openapi({ example: '2026-05-10' }),
    graceDays: z.number().openapi({ example: 7 }),
    totalCollected: z.number().openapi({ example: 0 }),
    collateralDescription: z.string().nullable().openapi({ example: 'Gold necklace' }),
    collateralEstimatedValue: z.number().nullable().openapi({ example: 50000 }),
    notes: z.string().nullable().openapi({ example: 'Daily loan' }),
    closureDate: z.string().nullable().openapi({ example: null }),
    closedById: z.string().uuid().nullable().openapi({ example: null }),
    // Computed fields
    totalRemaining: z.number().openapi({ example: 120000 }),
    daysPaid: z.number().openapi({ example: 0 }),
    daysRemaining: z.number().openapi({ example: 120 }),
    daysElapsed: z.number().openapi({ example: 0 }),
    isOverdue: z.boolean().openapi({ example: false }),
    daysOverdue: z.number().openapi({ example: 0 }),
    isBasePaid: z.boolean().openapi({ example: false }),
  })
  .openapi('DailyLoanDetailResponse');

export const dailyPaymentStatusDaySchema = z
  .object({
    dayNumber: z.number().openapi({ example: 1 }),
    date: z.string().openapi({ example: '2026-01-11' }),
    dailyPaymentAmount: z.number().openapi({ example: 1000 }),
    amountCollected: z.number().openapi({ example: 1000 }),
    cumulativeCollected: z.number().openapi({ example: 1000 }),
    isCovered: z.boolean().openapi({ example: true }),
  })
  .openapi('DailyPaymentStatusDay');

export const dailyPaymentStatusResponseSchema = z
  .object({
    loanId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    loanNumber: z.string().openapi({ example: 'DL-2026-0001' }),
    totalRepaymentAmount: z.number().openapi({ example: 120000 }),
    dailyPaymentAmount: z.number().openapi({ example: 1000 }),
    totalCollected: z.number().openapi({ example: 5000 }),
    days: z.array(dailyPaymentStatusDaySchema),
  })
  .openapi('DailyPaymentStatusResponse');
