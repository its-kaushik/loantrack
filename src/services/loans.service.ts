import Decimal from 'decimal.js';
import prisma from '../lib/prisma.js';
import { AppError } from '../utils/errors.js';
import { parseDate, toDateString, getDueDate, today, addDays, daysBetween } from '../utils/date.js';
import { generateLoanNumber } from '../utils/loan-number.js';

// ─── Shared Select Constants ───────────────────────────────────────────────

const loanListSelect = {
  id: true,
  loanNumber: true,
  loanType: true,
  borrowerId: true,
  borrower: { select: { fullName: true } },
  principalAmount: true,
  interestRate: true,
  disbursementDate: true,
  status: true,
  guarantorId: true,
  guarantor: { select: { fullName: true } },
  createdAt: true,
} as const;

const loanDetailSelect = {
  ...loanListSelect,
  remainingPrincipal: true,
  billingPrincipal: true,
  advanceInterestAmount: true,
  expectedMonths: true,
  monthlyDueDay: true,
  collateralDescription: true,
  collateralEstimatedValue: true,
  notes: true,
  closureDate: true,
  closedById: true,
  version: true,
} as const;

const loanDailyDetailSelect = {
  ...loanListSelect,
  termDays: true,
  totalRepaymentAmount: true,
  dailyPaymentAmount: true,
  termEndDate: true,
  graceDays: true,
  totalCollected: true,
  collateralDescription: true,
  collateralEstimatedValue: true,
  notes: true,
  closureDate: true,
  closedById: true,
  version: true,
} as const;

const loanFullDetailSelect = {
  ...loanDetailSelect,
  termDays: true,
  totalRepaymentAmount: true,
  dailyPaymentAmount: true,
  termEndDate: true,
  graceDays: true,
  totalCollected: true,
} as const;

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatLoanListItem(loan: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const l = loan as any;
  return {
    id: l.id,
    loanNumber: l.loanNumber,
    loanType: l.loanType,
    borrowerId: l.borrowerId,
    borrowerName: l.borrower.fullName,
    principalAmount: Number(l.principalAmount),
    interestRate: Number(l.interestRate),
    disbursementDate: toDateString(l.disbursementDate),
    status: l.status,
    guarantorId: l.guarantorId,
    guarantorName: l.guarantor?.fullName ?? null,
    createdAt: l.createdAt.toISOString(),
  };
}

function formatLoanDetail(loan: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const l = loan as any;
  return {
    ...formatLoanListItem(l),
    remainingPrincipal: Number(l.remainingPrincipal),
    billingPrincipal: Number(l.billingPrincipal),
    advanceInterestAmount: Number(l.advanceInterestAmount),
    expectedMonths: l.expectedMonths,
    monthlyDueDay: l.monthlyDueDay,
    collateralDescription: l.collateralDescription,
    collateralEstimatedValue: l.collateralEstimatedValue != null ? Number(l.collateralEstimatedValue) : null,
    notes: l.notes,
    closureDate: l.closureDate ? toDateString(l.closureDate) : null,
    closedById: l.closedById,
  };
}

function formatDailyLoanDetail(loan: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const l = loan as any;
  return {
    ...formatLoanListItem(l),
    termDays: l.termDays,
    totalRepaymentAmount: Number(l.totalRepaymentAmount),
    dailyPaymentAmount: Number(l.dailyPaymentAmount),
    termEndDate: l.termEndDate ? toDateString(l.termEndDate) : null,
    graceDays: l.graceDays,
    totalCollected: Number(l.totalCollected),
    collateralDescription: l.collateralDescription,
    collateralEstimatedValue: l.collateralEstimatedValue != null ? Number(l.collateralEstimatedValue) : null,
    notes: l.notes,
    closureDate: l.closureDate ? toDateString(l.closureDate) : null,
    closedById: l.closedById,
  };
}

// ─── createMonthlyLoan ─────────────────────────────────────────────────────

export async function createMonthlyLoan(
  tenantId: string,
  createdById: string,
  data: {
    loan_type: 'MONTHLY';
    borrower_id: string;
    principal_amount: number;
    interest_rate: number;
    disbursement_date: string;
    expected_months?: number;
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

    // Calculate advance interest
    const principal = new Decimal(data.principal_amount);
    const rate = new Decimal(data.interest_rate);
    const advanceInterest = principal.mul(rate).div(100);

    // Create loan
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
        remainingPrincipal: data.principal_amount,
        billingPrincipal: data.principal_amount,
        advanceInterestAmount: advanceInterest.toNumber(),
        guarantorId: data.guarantor_id,
        collateralDescription: data.collateral_description,
        collateralEstimatedValue: data.collateral_estimated_value,
        notes: data.notes,
        createdById,
      },
    });

    // Create DISBURSEMENT transaction (auto-approved)
    await tx.transaction.create({
      data: {
        tenantId,
        loanId: loan.id,
        transactionType: 'DISBURSEMENT',
        amount: data.principal_amount,
        transactionDate: disbursementDate,
        approvalStatus: 'APPROVED',
      },
    });

    // Create ADVANCE_INTEREST transaction (auto-approved)
    await tx.transaction.create({
      data: {
        tenantId,
        loanId: loan.id,
        transactionType: 'ADVANCE_INTEREST',
        amount: advanceInterest.toNumber(),
        transactionDate: disbursementDate,
        approvalStatus: 'APPROVED',
      },
    });

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

// ─── createDailyLoan ──────────────────────────────────────────────────────

export async function createDailyLoan(
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

    // Parse disbursement date and extract year
    const disbursementDate = parseDate(data.disbursement_date);
    const year = disbursementDate.getUTCFullYear();

    // Generate loan number
    const loanNumber = await generateLoanNumber(tx, tenantId, year, 'DAILY');

    // Calculate with Decimal.js
    const principal = new Decimal(data.principal_amount);
    const rate = new Decimal(data.interest_rate);
    const termDays = data.term_days;
    const totalRepayment = principal.mul(rate.div(100).mul(termDays).div(30).plus(1));
    const dailyPayment = totalRepayment.div(termDays);
    const termEndDate = addDays(disbursementDate, termDays);
    const graceDays = data.grace_days ?? 7;

    // Create loan
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
        totalCollected: 0,
        guarantorId: data.guarantor_id,
        collateralDescription: data.collateral_description,
        collateralEstimatedValue: data.collateral_estimated_value,
        notes: data.notes,
        createdById,
      },
    });

    // Create DISBURSEMENT transaction (auto-approved)
    await tx.transaction.create({
      data: {
        tenantId,
        loanId: loan.id,
        transactionType: 'DISBURSEMENT',
        amount: data.principal_amount,
        transactionDate: disbursementDate,
        approvalStatus: 'APPROVED',
      },
    });

    // NO advance interest for daily loans

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
      termDays: loan.termDays,
      totalRepaymentAmount: totalRepayment.toNumber(),
      dailyPaymentAmount: dailyPayment.toNumber(),
      termEndDate: toDateString(termEndDate),
      graceDays: loan.graceDays,
      totalCollected: 0,
      collateralDescription: loan.collateralDescription,
      collateralEstimatedValue: loan.collateralEstimatedValue != null ? Number(loan.collateralEstimatedValue) : null,
      notes: loan.notes,
      closureDate: null,
      closedById: null,
      createdAt: loan.createdAt.toISOString(),
      // Computed fields — all initial
      totalRemaining: totalRepayment.toNumber(),
      daysPaid: 0,
      daysRemaining: termDays,
      daysElapsed: 0,
      isOverdue: false,
      daysOverdue: 0,
      isBasePaid: false,
    };
  });
}

// ─── listLoans ─────────────────────────────────────────────────────────────

export async function listLoans(
  tenantId: string,
  query: {
    type?: 'MONTHLY' | 'DAILY';
    status?: string;
    borrower_id?: string;
    search?: string;
    page: number;
    limit: number;
  },
  callerRole?: 'ADMIN' | 'COLLECTOR',
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { tenantId };

  if (callerRole === 'COLLECTOR') {
    // Collectors can only see ACTIVE loans
    where.status = 'ACTIVE';
  } else if (query.status) {
    where.status = query.status;
  }

  if (query.type) {
    where.loanType = query.type;
  }
  if (query.borrower_id) {
    where.borrowerId = query.borrower_id;
  }
  if (query.search) {
    where.loanNumber = { contains: query.search, mode: 'insensitive' };
  }

  const skip = (query.page - 1) * query.limit;

  const [data, total] = await Promise.all([
    prisma.loan.findMany({
      where,
      select: loanListSelect,
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.limit,
    }),
    prisma.loan.count({ where }),
  ]);

  return {
    data: data.map(formatLoanListItem),
    pagination: { page: query.page, limit: query.limit, total },
  };
}

// ─── getLoan ───────────────────────────────────────────────────────────────

export async function getLoan(tenantId: string, loanId: string) {
  const loan = await prisma.loan.findFirst({
    where: { id: loanId, tenantId },
    select: loanFullDetailSelect,
  });

  if (!loan) {
    throw AppError.notFound('Loan not found');
  }

  if (loan.loanType === 'DAILY') {
    return getDailyLoanDetail(loan);
  }

  const detail = formatLoanDetail(loan);

  // Compute monthly fields
  const billingPrincipal = new Decimal(loan.billingPrincipal!.toString());
  const rate = new Decimal(loan.interestRate.toString());
  const monthlyInterestDue = billingPrincipal.mul(rate).div(100).toNumber();

  // Total interest collected: SUM of INTEREST_PAYMENT + ADVANCE_INTEREST amounts
  const interestAgg = await prisma.transaction.aggregate({
    where: {
      loanId,
      tenantId,
      transactionType: { in: ['INTEREST_PAYMENT', 'ADVANCE_INTEREST'] },
      approvalStatus: 'APPROVED',
    },
    _sum: { amount: true },
  });
  const totalInterestCollected = interestAgg._sum.amount ? Number(interestAgg._sum.amount) : 0;

  // Months active: from disbursement to today (or closure)
  const disbDate = loan.disbursementDate;
  const endDate = loan.closureDate ?? new Date();
  const monthsActive = computeMonthsActive(disbDate, endDate);

  // Compute nextDueDate and isOverdue using cycle enumeration
  const { nextDueDate, isOverdue } = await computeDueDateInfo(tenantId, loanId, loan);

  return {
    ...detail,
    monthlyInterestDue,
    nextDueDate,
    isOverdue,
    totalInterestCollected,
    monthsActive,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDailyLoanDetail(loan: any) {
  const detail = formatDailyLoanDetail(loan);
  const totalRepayment = new Decimal(loan.totalRepaymentAmount!.toString());
  const totalCollected = new Decimal(loan.totalCollected.toString());
  const dailyPayment = new Decimal(loan.dailyPaymentAmount!.toString());
  const termDays = loan.termDays!;

  const totalRemaining = totalRepayment.minus(totalCollected);
  const daysPaid = dailyPayment.gt(0) ? totalCollected.div(dailyPayment).floor().toNumber() : 0;
  const daysRemaining = Math.max(0, termDays - daysPaid);
  const daysElapsed = daysBetween(loan.disbursementDate, loan.closureDate ?? new Date());

  const todayDate = parseDate(today());
  const overdueThreshold = addDays(loan.termEndDate!, loan.graceDays);
  const isOverdue = loan.status === 'ACTIVE' && todayDate > overdueThreshold && totalCollected.lt(totalRepayment);
  const daysOverdue = isOverdue ? daysBetween(overdueThreshold, todayDate) : 0;
  const isBasePaid = totalCollected.gte(totalRepayment);

  return {
    ...detail,
    totalRemaining: totalRemaining.toNumber(),
    daysPaid,
    daysRemaining,
    daysElapsed,
    isOverdue,
    daysOverdue,
    isBasePaid,
  };
}

function computeMonthsActive(disbDate: Date, endDate: Date): number {
  const disbYear = disbDate.getUTCFullYear();
  const disbMonth = disbDate.getUTCMonth();
  const endYear = endDate.getUTCFullYear();
  const endMonth = endDate.getUTCMonth();
  return (endYear - disbYear) * 12 + (endMonth - disbMonth);
}

async function computeDueDateInfo(
  tenantId: string,
  loanId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loan: any,
): Promise<{ nextDueDate: string | null; isOverdue: boolean }> {
  if (loan.status === 'CLOSED') {
    return { nextDueDate: null, isOverdue: false };
  }

  const disbDate = loan.disbursementDate;
  const monthlyDueDay = loan.monthlyDueDay!;
  const rate = new Decimal(loan.interestRate.toString());

  const disbYear = disbDate.getUTCFullYear();
  const disbMonth = disbDate.getUTCMonth() + 1; // 1-indexed

  // Start from month after disbursement
  let cycleYear = disbYear;
  let cycleMonth = disbMonth + 1;
  if (cycleMonth > 12) {
    cycleMonth = 1;
    cycleYear++;
  }

  const todayStr = today();
  const todayDate = parseDate(todayStr);
  const todayYear = todayDate.getUTCFullYear();
  const todayMonth = todayDate.getUTCMonth() + 1;

  let nextDueDate: string | null = null;
  let isOverdue = false;

  // Iterate through cycles up to current month
  while (cycleYear < todayYear || (cycleYear === todayYear && cycleMonth <= todayMonth)) {
    const dueDate = getDueDate(monthlyDueDay, cycleYear, cycleMonth);
    const dueDateStr = toDateString(dueDate);

    // Check if this cycle is settled
    const billingPrincipalForCycle = await getBillingPrincipalForCycle(tenantId, loanId, loan, cycleYear, cycleMonth);
    const interestDue = new Decimal(billingPrincipalForCycle.toString()).mul(rate).div(100);

    const { paid, waived } = await getCyclePayments(tenantId, loanId, cycleYear, cycleMonth);
    const totalSettled = new Decimal(paid.toString()).plus(new Decimal(waived.toString()));
    const isSettled = totalSettled.gte(interestDue);

    if (!isSettled) {
      if (!nextDueDate) {
        nextDueDate = dueDateStr;
      }
      // If due date is in the past, it's overdue
      if (dueDate <= todayDate) {
        isOverdue = true;
      }
    }

    cycleMonth++;
    if (cycleMonth > 12) {
      cycleMonth = 1;
      cycleYear++;
    }
  }

  // If all past cycles are settled, next due date is the next upcoming cycle
  if (!nextDueDate) {
    const dueDate = getDueDate(monthlyDueDay, cycleYear, cycleMonth);
    nextDueDate = toDateString(dueDate);
  }

  return { nextDueDate, isOverdue };
}

// ─── getLoanTransactions ───────────────────────────────────────────────────

export async function getLoanTransactions(
  tenantId: string,
  loanId: string,
  query: { page: number; limit: number },
) {
  // Verify loan exists in tenant
  const loan = await prisma.loan.findFirst({
    where: { id: loanId, tenantId },
    select: { id: true },
  });
  if (!loan) {
    throw AppError.notFound('Loan not found');
  }

  const skip = (query.page - 1) * query.limit;

  const [data, total] = await Promise.all([
    prisma.transaction.findMany({
      where: { loanId, tenantId },
      select: {
        id: true,
        transactionType: true,
        amount: true,
        transactionDate: true,
        effectiveDate: true,
        approvalStatus: true,
        notes: true,
        createdAt: true,
      },
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: query.limit,
    }),
    prisma.transaction.count({ where: { loanId, tenantId } }),
  ]);

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: data.map((t: any) => ({
      id: t.id,
      transactionType: t.transactionType,
      amount: Number(t.amount),
      transactionDate: toDateString(t.transactionDate),
      effectiveDate: t.effectiveDate ? toDateString(t.effectiveDate) : null,
      approvalStatus: t.approvalStatus,
      notes: t.notes,
      createdAt: t.createdAt.toISOString(),
    })),
    pagination: { page: query.page, limit: query.limit, total },
  };
}

// ─── getPaymentStatus ──────────────────────────────────────────────────────

export async function getPaymentStatus(tenantId: string, loanId: string) {
  const loan = await prisma.loan.findFirst({
    where: { id: loanId, tenantId },
    select: {
      id: true,
      loanNumber: true,
      loanType: true,
      disbursementDate: true,
      monthlyDueDay: true,
      principalAmount: true,
      interestRate: true,
      status: true,
      closureDate: true,
      termDays: true,
      totalRepaymentAmount: true,
      dailyPaymentAmount: true,
      termEndDate: true,
      totalCollected: true,
    },
  });

  if (!loan) {
    throw AppError.notFound('Loan not found');
  }

  if (loan.loanType === 'DAILY') {
    return getDailyPaymentStatus(tenantId, loan);
  }

  const disbDate = loan.disbursementDate;
  const monthlyDueDay = loan.monthlyDueDay!;
  const rate = new Decimal(loan.interestRate.toString());

  const disbYear = disbDate.getUTCFullYear();
  const disbMonth = disbDate.getUTCMonth() + 1;

  // Determine end month: current month or closure month
  let endYear: number;
  let endMonth: number;
  if (loan.closureDate) {
    endYear = loan.closureDate.getUTCFullYear();
    endMonth = loan.closureDate.getUTCMonth() + 1;
  } else {
    const todayDate = parseDate(today());
    endYear = todayDate.getUTCFullYear();
    endMonth = todayDate.getUTCMonth() + 1;
  }

  // Start from month after disbursement
  let cycleYear = disbYear;
  let cycleMonth = disbMonth + 1;
  if (cycleMonth > 12) {
    cycleMonth = 1;
    cycleYear++;
  }

  const cycles = [];

  while (cycleYear < endYear || (cycleYear === endYear && cycleMonth <= endMonth)) {
    const dueDate = getDueDate(monthlyDueDay, cycleYear, cycleMonth);
    const dueDateStr = toDateString(dueDate);

    const billingPrincipalForCycle = await getBillingPrincipalForCycle(tenantId, loanId, loan, cycleYear, cycleMonth);
    const interestDue = new Decimal(billingPrincipalForCycle.toString()).mul(rate).div(100);

    const { paid, waived } = await getCyclePayments(tenantId, loanId, cycleYear, cycleMonth);
    const totalSettled = new Decimal(paid.toString()).plus(new Decimal(waived.toString()));
    const isSettled = totalSettled.gte(interestDue);

    cycles.push({
      cycleYear,
      cycleMonth,
      dueDate: dueDateStr,
      interestDue: interestDue.toNumber(),
      interestPaid: paid,
      interestWaived: waived,
      isSettled,
      billingPrincipalForCycle: Number(billingPrincipalForCycle),
    });

    cycleMonth++;
    if (cycleMonth > 12) {
      cycleMonth = 1;
      cycleYear++;
    }
  }

  return {
    loanId: loan.id,
    loanNumber: loan.loanNumber,
    cycles,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getDailyPaymentStatus(tenantId: string, loan: any) {
  const dailyPayment = new Decimal(loan.dailyPaymentAmount!.toString());
  const termDays = loan.termDays!;
  const disbursementDate = loan.disbursementDate as Date;
  const termEndDate = loan.termEndDate as Date;

  // Fetch all DAILY_COLLECTION transactions ordered by date
  const transactions = await prisma.transaction.findMany({
    where: {
      loanId: loan.id,
      tenantId,
      transactionType: 'DAILY_COLLECTION',
      approvalStatus: 'APPROVED',
    },
    orderBy: { transactionDate: 'asc' },
    select: { amount: true, transactionDate: true },
  });

  // Group collections by date
  const collectionsByDate: Record<string, Decimal> = {};
  for (const txn of transactions) {
    const dateStr = toDateString(txn.transactionDate);
    if (collectionsByDate[dateStr]) {
      collectionsByDate[dateStr] = collectionsByDate[dateStr]!.plus(new Decimal(txn.amount.toString()));
    } else {
      collectionsByDate[dateStr] = new Decimal(txn.amount.toString());
    }
  }

  // Enumerate days from disbursement+1 through min(today, termEndDate)
  const todayDate = parseDate(today());
  const endDate = todayDate < termEndDate ? todayDate : termEndDate;
  const days = [];
  let cumulativeCollected = new Decimal(0);

  for (let dayNum = 1; dayNum <= termDays; dayNum++) {
    const dayDate = addDays(disbursementDate, dayNum);
    if (dayDate > endDate) break;

    const dateStr = toDateString(dayDate);
    const amountCollected = collectionsByDate[dateStr] ?? new Decimal(0);
    cumulativeCollected = cumulativeCollected.plus(amountCollected);

    const isCovered = cumulativeCollected.gte(dailyPayment.mul(dayNum));

    days.push({
      dayNumber: dayNum,
      date: dateStr,
      dailyPaymentAmount: dailyPayment.toNumber(),
      amountCollected: amountCollected.toNumber(),
      cumulativeCollected: cumulativeCollected.toNumber(),
      isCovered,
    });
  }

  return {
    loanId: loan.id,
    loanNumber: loan.loanNumber,
    totalRepaymentAmount: Number(loan.totalRepaymentAmount),
    dailyPaymentAmount: dailyPayment.toNumber(),
    totalCollected: Number(loan.totalCollected),
    days,
  };
}

// ─── closeLoan ─────────────────────────────────────────────────────────────

export async function closeLoan(tenantId: string, loanId: string, closedById: string) {
  const loan = await prisma.loan.findFirst({
    where: { id: loanId, tenantId },
    select: {
      id: true,
      status: true,
      remainingPrincipal: true,
      version: true,
      loanType: true,
      disbursementDate: true,
      monthlyDueDay: true,
      principalAmount: true,
      interestRate: true,
      loanNumber: true,
      closureDate: true,
      totalCollected: true,
      totalRepaymentAmount: true,
    },
  });

  if (!loan) {
    throw AppError.notFound('Loan not found');
  }

  if (loan.status !== 'ACTIVE') {
    throw AppError.badRequest('Only ACTIVE loans can be closed');
  }

  if (loan.loanType === 'DAILY') {
    // DAILY: validate totalCollected >= totalRepaymentAmount
    const totalCollected = new Decimal(loan.totalCollected!.toString());
    const totalRepayment = new Decimal(loan.totalRepaymentAmount!.toString());
    if (totalCollected.lt(totalRepayment)) {
      throw AppError.badRequest('Cannot close loan: total collected is less than total repayment amount');
    }

    // Check for outstanding penalties
    const outstandingPenalties = await prisma.penalty.count({
      where: { loanId, tenantId, status: { in: ['PENDING', 'PARTIALLY_PAID'] } },
    });
    if (outstandingPenalties > 0) {
      throw AppError.badRequest('Cannot close loan with outstanding penalties');
    }
  } else {
    // MONTHLY: existing logic
    const remaining = new Decimal(loan.remainingPrincipal!.toString());
    if (!remaining.eq(0)) {
      throw AppError.badRequest('Cannot close loan with remaining principal');
    }

    // Validate all cycles are settled using payment status logic
    const paymentStatus = await getPaymentStatus(tenantId, loanId) as { cycles: Array<{ isSettled: boolean }> };
    const unsettledCycle = paymentStatus.cycles.find((c) => !c.isSettled);
    if (unsettledCycle) {
      throw AppError.badRequest('Cannot close loan with unsettled interest cycles');
    }
  }

  const closureDate = parseDate(today());

  // Optimistic lock update
  const result = await prisma.loan.updateMany({
    where: { id: loanId, tenantId, version: loan.version },
    data: {
      status: 'CLOSED',
      closureDate,
      closedById,
      version: { increment: 1 },
    },
  });

  if (result.count === 0) {
    throw AppError.conflict('Loan was modified concurrently, please retry');
  }

  // Re-fetch to return updated loan based on type
  if (loan.loanType === 'DAILY') {
    const updated = await prisma.loan.findFirst({
      where: { id: loanId, tenantId },
      select: loanDailyDetailSelect,
    });
    return getDailyLoanDetail(updated!);
  }

  const updated = await prisma.loan.findFirst({
    where: { id: loanId, tenantId },
    select: loanDetailSelect,
  });
  return formatLoanDetail(updated!);
}

// ─── Shared Helpers ────────────────────────────────────────────────────────

/**
 * Determines the billing principal for a given cycle.
 * Billing principal for cycle N = remainingPrincipal just before that cycle started.
 * = last principal_returns.remaining_principal_after where return_date < cycle start date,
 *   or principalAmount if no returns exist before that date.
 */
async function getBillingPrincipalForCycle(
  tenantId: string,
  loanId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loan: any,
  cycleYear: number,
  cycleMonth: number,
): Promise<number> {
  // Cycle start date is the 1st of that cycle month
  const cycleStartDate = new Date(Date.UTC(cycleYear, cycleMonth - 1, 1));

  const lastReturn = await prisma.principalReturn.findFirst({
    where: {
      loanId,
      tenantId,
      returnDate: { lt: cycleStartDate },
    },
    orderBy: { returnDate: 'desc' },
    select: { remainingPrincipalAfter: true },
  });

  if (lastReturn) {
    return Number(lastReturn.remainingPrincipalAfter);
  }

  return Number(loan.principalAmount);
}

/**
 * Gets the total INTEREST_PAYMENT and INTEREST_WAIVER amounts for a given cycle.
 * A cycle is identified by effective_date being in that calendar month.
 */
async function getCyclePayments(
  tenantId: string,
  loanId: string,
  cycleYear: number,
  cycleMonth: number,
): Promise<{ paid: number; waived: number }> {
  const startDate = new Date(Date.UTC(cycleYear, cycleMonth - 1, 1));
  const endDate = new Date(Date.UTC(cycleYear, cycleMonth, 1)); // first of next month

  const paidAgg = await prisma.transaction.aggregate({
    where: {
      loanId,
      tenantId,
      transactionType: 'INTEREST_PAYMENT',
      approvalStatus: 'APPROVED',
      effectiveDate: { gte: startDate, lt: endDate },
    },
    _sum: { amount: true },
  });

  const waivedAgg = await prisma.transaction.aggregate({
    where: {
      loanId,
      tenantId,
      transactionType: 'INTEREST_WAIVER',
      approvalStatus: 'APPROVED',
      effectiveDate: { gte: startDate, lt: endDate },
    },
    _sum: { amount: true },
  });

  return {
    paid: paidAgg._sum.amount ? Number(paidAgg._sum.amount) : 0,
    waived: waivedAgg._sum.amount ? Number(waivedAgg._sum.amount) : 0,
  };
}
