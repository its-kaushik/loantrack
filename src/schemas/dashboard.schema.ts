import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// ─── Query Schemas ─────────────────────────────────────────────────────────

export const dateRangeQuerySchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .openapi({ example: '2026-01-01' }),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .openapi({ example: '2026-01-31' }),
  })
  .openapi('DateRangeQuery');

// ─── Response Schemas ──────────────────────────────────────────────────────

export const todaySummaryResponseSchema = z
  .object({
    activeDailyLoanCount: z.number().openapi({ example: 25 }),
    expectedCollections: z.object({
      count: z.number().openapi({ example: 20 }),
      totalAmount: z.string().openapi({ example: '50000.00' }),
    }),
    receivedCollections: z.object({
      count: z.number().openapi({ example: 15 }),
      totalAmount: z.string().openapi({ example: '37500.00' }),
    }),
    missedToday: z.array(z.object({
      loanId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
      borrowerName: z.string().openapi({ example: 'John Doe' }),
      dailyPaymentAmount: z.string().openapi({ example: '2500.00' }),
    })),
    monthlyInterestDueToday: z.array(z.object({
      loanId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
      borrowerName: z.string().openapi({ example: 'Jane Smith' }),
      interestAmount: z.string().openapi({ example: '5000.00' }),
      dueDate: z.string().openapi({ example: '2026-01-31' }),
    })),
    pendingApprovalsCount: z.number().openapi({ example: 3 }),
    totalCollectedToday: z.string().openapi({ example: '42500.00' }),
  })
  .openapi('TodaySummaryResponse');

export const overdueLoansResponseSchema = z
  .object({
    overdueDailyLoans: z.array(z.object({
      loanId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
      loanNumber: z.string().openapi({ example: 'DL-2026-0001' }),
      borrowerName: z.string().openapi({ example: 'John Doe' }),
      daysOverdue: z.number().openapi({ example: 15 }),
      amountRemaining: z.string().openapi({ example: '25000.00' }),
      guarantorName: z.string().nullable().openapi({ example: 'Bob Smith' }),
      penaltyApplicable: z.string().openapi({ example: '5000.00' }),
    })),
    overdueMonthlyLoans: z.array(z.object({
      loanId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
      loanNumber: z.string().openapi({ example: 'ML-2026-0001' }),
      borrowerName: z.string().openapi({ example: 'Jane Smith' }),
      monthsOverdue: z.number().openapi({ example: 2 }),
      interestDue: z.string().openapi({ example: '10000.00' }),
      lastPaymentDate: z.string().nullable().openapi({ example: '2025-11-15' }),
    })),
  })
  .openapi('OverdueLoansResponse');

export const defaultersResponseSchema = z
  .object({
    defaulters: z.array(z.object({
      loanId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
      loanNumber: z.string().openapi({ example: 'DL-2026-0001' }),
      status: z.string().openapi({ example: 'DEFAULTED' }),
      borrowerName: z.string().openapi({ example: 'John Doe' }),
      borrowerPhone: z.string().openapi({ example: '9876543210' }),
      guarantorName: z.string().nullable().openapi({ example: 'Bob Smith' }),
      guarantorPhone: z.string().nullable().openapi({ example: '9876543211' }),
      outstandingAmount: z.string().openapi({ example: '50000.00' }),
      defaultedAt: z.string().nullable().openapi({ example: '2026-01-15T10:30:00.000Z' }),
      writtenOffAt: z.string().nullable().openapi({ example: null }),
    })),
  })
  .openapi('DefaultersResponse');

export const profitLossResponseSchema = z
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
  .openapi('ProfitLossResponse');

export const collectorSummaryResponseSchema = z
  .array(z.object({
    userId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    name: z.string().openapi({ example: 'John Collector' }),
    totalTransactions: z.number().openapi({ example: 50 }),
    totalAmount: z.string().openapi({ example: '250000.00' }),
    loansServiced: z.number().openapi({ example: 15 }),
    approved: z.number().openapi({ example: 40 }),
    pending: z.number().openapi({ example: 8 }),
    rejected: z.number().openapi({ example: 2 }),
  }))
  .openapi('CollectorSummaryResponse');

export const loanBookResponseSchema = z
  .array(z.object({
    loanId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    loanNumber: z.string().openapi({ example: 'DL-2026-0001' }),
    loanType: z.string().openapi({ example: 'DAILY' }),
    status: z.string().openapi({ example: 'ACTIVE' }),
    borrowerName: z.string().openapi({ example: 'John Doe' }),
    principalAmount: z.string().openapi({ example: '100000.00' }),
    disbursementDate: z.string().openapi({ example: '2026-01-01' }),
    outstandingAmount: z.string().openapi({ example: '75000.00' }),
    interestEarned: z.string().openapi({ example: '5000.00' }),
    guarantorName: z.string().nullable().openapi({ example: 'Bob Smith' }),
  }))
  .openapi('LoanBookResponse');
