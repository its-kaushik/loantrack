import Decimal from 'decimal.js';
import prisma from '../lib/prisma.js';
import { AppError } from '../utils/errors.js';
import { parseDate, toDateString, addDays } from '../utils/date.js';
import { generateLoanNumber } from '../utils/loan-number.js';

// ─── migrateMonthlyLoan ──────────────────────────────────────────────────

export async function migrateMonthlyLoan(
  tenantId: string,
  createdById: string,
  data: {
    loan_type: 'MONTHLY';
    borrower_id: string;
    principal_amount: number;
    interest_rate: number;
    disbursement_date: string;
    expected_months?: number;
    remaining_principal: number;
    last_interest_paid_through: string;
    guarantor_id?: string;
    collateral_description?: string;
    collateral_estimated_value?: number;
    notes?: string;
  },
) {
  return prisma.$transaction(async (tx) => {
    // Validate borrower exists in tenant
    const borrower = await tx.customer.findFirst({
      where: { id: data.borrower_id, tenantId },
      select: { id: true, fullName: true },
    });
    if (!borrower) {
      throw AppError.notFound('Borrower not found');
    }

    // Validate guarantor if provided
    let guarantorName: string | null = null;
    if (data.guarantor_id) {
      if (data.guarantor_id === data.borrower_id) {
        throw AppError.badRequest('Guarantor cannot be the same as borrower');
      }
      const guarantor = await tx.customer.findFirst({
        where: { id: data.guarantor_id, tenantId },
        select: { id: true, fullName: true },
      });
      if (!guarantor) {
        throw AppError.notFound('Guarantor not found');
      }
      guarantorName = guarantor.fullName;
    }

    // Parse disbursement date and extract monthlyDueDay
    const disbursementDate = parseDate(data.disbursement_date);
    const monthlyDueDay = disbursementDate.getUTCDate();
    const year = disbursementDate.getUTCFullYear();

    // Generate loan number
    const loanNumber = await generateLoanNumber(tx, tenantId, year, 'MONTHLY');

    // Calculate advance interest (informational — no transaction created)
    const principal = new Decimal(data.principal_amount);
    const rate = new Decimal(data.interest_rate);
    const advanceInterest = principal.mul(rate).div(100);

    // Parse last_interest_paid_through
    const lastInterestPaidThrough = parseDate(data.last_interest_paid_through);

    // Create loan record
    const loan = await tx.loan.create({
      data: {
        tenantId,
        loanNumber,
        borrowerId: data.borrower_id,
        loanType: 'MONTHLY',
        principalAmount: data.principal_amount,
        interestRate: data.interest_rate,
        disbursementDate,
        expectedMonths: data.expected_months,
        monthlyDueDay,
        remainingPrincipal: data.remaining_principal,
        billingPrincipal: data.remaining_principal,
        advanceInterestAmount: advanceInterest.toNumber(),
        lastInterestPaidThrough,
        isMigrated: true,
        guarantorId: data.guarantor_id,
        collateralDescription: data.collateral_description,
        collateralEstimatedValue: data.collateral_estimated_value,
        notes: data.notes,
        createdById,
      },
    });

    // NO DISBURSEMENT transaction — money was already given
    // NO ADVANCE_INTEREST transaction — already collected
    // NO OPENING_BALANCE transaction — state captured by remaining_principal + last_interest_paid_through

    return {
      id: loan.id,
      loanNumber: loan.loanNumber,
      loanType: loan.loanType,
      borrowerId: loan.borrowerId,
      borrowerName: borrower.fullName,
      principalAmount: Number(loan.principalAmount),
      interestRate: Number(loan.interestRate),
      disbursementDate: toDateString(loan.disbursementDate),
      status: loan.status,
      guarantorId: loan.guarantorId,
      guarantorName,
      isMigrated: true,
      lastInterestPaidThrough: toDateString(lastInterestPaidThrough),
      remainingPrincipal: Number(loan.remainingPrincipal),
      billingPrincipal: Number(loan.billingPrincipal),
      advanceInterestAmount: advanceInterest.toNumber(),
      expectedMonths: loan.expectedMonths,
      monthlyDueDay: loan.monthlyDueDay,
      collateralDescription: loan.collateralDescription,
      collateralEstimatedValue: loan.collateralEstimatedValue != null ? Number(loan.collateralEstimatedValue) : null,
      notes: loan.notes,
      closureDate: null,
      closedById: null,
      createdAt: loan.createdAt.toISOString(),
    };
  });
}

// ─── migrateDailyLoan ──────────────────────────────────────────────────

export async function migrateDailyLoan(
  tenantId: string,
  createdById: string,
  data: {
    loan_type: 'DAILY';
    borrower_id: string;
    principal_amount: number;
    interest_rate: number;
    disbursement_date: string;
    term_days: number;
    grace_days?: number;
    total_base_collected_so_far: number;
    guarantor_id?: string;
    collateral_description?: string;
    collateral_estimated_value?: number;
    notes?: string;
    pre_existing_penalties?: Array<{
      days_overdue: number;
      months_charged: number;
      penalty_amount: number;
      status: 'PENDING' | 'PAID';
    }>;
  },
) {
  return prisma.$transaction(async (tx) => {
    // Validate borrower exists in tenant
    const borrower = await tx.customer.findFirst({
      where: { id: data.borrower_id, tenantId },
      select: { id: true, fullName: true },
    });
    if (!borrower) {
      throw AppError.notFound('Borrower not found');
    }

    // Validate guarantor if provided
    let guarantorName: string | null = null;
    if (data.guarantor_id) {
      if (data.guarantor_id === data.borrower_id) {
        throw AppError.badRequest('Guarantor cannot be the same as borrower');
      }
      const guarantor = await tx.customer.findFirst({
        where: { id: data.guarantor_id, tenantId },
        select: { id: true, fullName: true },
      });
      if (!guarantor) {
        throw AppError.notFound('Guarantor not found');
      }
      guarantorName = guarantor.fullName;
    }

    // Parse disbursement date and extract year
    const disbursementDate = parseDate(data.disbursement_date);
    const year = disbursementDate.getUTCFullYear();

    // Generate loan number
    const loanNumber = await generateLoanNumber(tx, tenantId, year, 'DAILY');

    // Calculate with Decimal.js (same formulas as createDailyLoan)
    const principal = new Decimal(data.principal_amount);
    const rate = new Decimal(data.interest_rate);
    const termDays = data.term_days;
    const totalRepayment = principal.mul(rate.div(100).mul(termDays).div(30).plus(1));
    const dailyPayment = totalRepayment.div(termDays);
    const termEndDate = addDays(disbursementDate, termDays);
    const graceDays = data.grace_days ?? 7;

    // Create loan record
    const loan = await tx.loan.create({
      data: {
        tenantId,
        loanNumber,
        borrowerId: data.borrower_id,
        loanType: 'DAILY',
        principalAmount: data.principal_amount,
        interestRate: data.interest_rate,
        disbursementDate,
        termDays,
        totalRepaymentAmount: totalRepayment.toNumber(),
        dailyPaymentAmount: dailyPayment.toNumber(),
        termEndDate,
        graceDays,
        totalCollected: data.total_base_collected_so_far,
        isMigrated: true,
        guarantorId: data.guarantor_id,
        collateralDescription: data.collateral_description,
        collateralEstimatedValue: data.collateral_estimated_value,
        notes: data.notes,
        createdById,
      },
    });

    // NO DISBURSEMENT transaction — money was already given

    // Create OPENING_BALANCE transaction (auto-approved)
    await tx.transaction.create({
      data: {
        tenantId,
        loanId: loan.id,
        transactionType: 'OPENING_BALANCE',
        amount: data.total_base_collected_so_far,
        transactionDate: disbursementDate,
        approvalStatus: 'APPROVED',
      },
    });

    // Create pre-existing penalty rows if provided
    if (data.pre_existing_penalties && data.pre_existing_penalties.length > 0) {
      for (const p of data.pre_existing_penalties) {
        const isPaid = p.status === 'PAID';
        await tx.penalty.create({
          data: {
            tenantId,
            loanId: loan.id,
            daysOverdue: p.days_overdue,
            monthsCharged: p.months_charged,
            penaltyAmount: p.penalty_amount,
            waivedAmount: 0,
            netPayable: isPaid ? 0 : p.penalty_amount,
            imposedDate: disbursementDate,
            status: p.status,
            amountCollected: isPaid ? p.penalty_amount : 0,
            createdById,
          },
        });
      }
    }

    return {
      id: loan.id,
      loanNumber: loan.loanNumber,
      loanType: loan.loanType,
      borrowerId: loan.borrowerId,
      borrowerName: borrower.fullName,
      principalAmount: Number(loan.principalAmount),
      interestRate: Number(loan.interestRate),
      disbursementDate: toDateString(loan.disbursementDate),
      status: loan.status,
      guarantorId: loan.guarantorId,
      guarantorName,
      isMigrated: true,
      termDays: loan.termDays,
      totalRepaymentAmount: totalRepayment.toNumber(),
      dailyPaymentAmount: dailyPayment.toNumber(),
      termEndDate: toDateString(termEndDate),
      graceDays: loan.graceDays,
      totalCollected: data.total_base_collected_so_far,
      collateralDescription: loan.collateralDescription,
      collateralEstimatedValue: loan.collateralEstimatedValue != null ? Number(loan.collateralEstimatedValue) : null,
      notes: loan.notes,
      closureDate: null,
      closedById: null,
      createdAt: loan.createdAt.toISOString(),
      // Computed fields — initial based on migration state
      totalRemaining: totalRepayment.minus(data.total_base_collected_so_far).toNumber(),
      daysPaid: dailyPayment.gt(0) ? new Decimal(data.total_base_collected_so_far).div(dailyPayment).floor().toNumber() : 0,
      daysRemaining: Math.max(0, termDays - (dailyPayment.gt(0) ? new Decimal(data.total_base_collected_so_far).div(dailyPayment).floor().toNumber() : 0)),
      daysElapsed: 0,
      isOverdue: false,
      daysOverdue: 0,
      isBasePaid: new Decimal(data.total_base_collected_so_far).gte(totalRepayment),
    };
  });
}
