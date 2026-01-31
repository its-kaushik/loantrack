import { Decimal } from 'decimal.js';
import prisma from '../lib/prisma.js';
import { AppError } from '../utils/errors.js';
import { parseDate, toDateString, addDays, daysBetween, today } from '../utils/date.js';

// ─── imposePenalty ────────────────────────────────────────────────────────────

export async function imposePenalty(
  tenantId: string,
  loanId: string,
  createdById: string,
  data: { override_amount?: number; notes?: string },
) {
  return prisma.$transaction(async (tx) => {
    const loan = await tx.loan.findFirst({
      where: { id: loanId, tenantId },
      select: {
        id: true,
        loanType: true,
        status: true,
        principalAmount: true,
        interestRate: true,
        termEndDate: true,
        graceDays: true,
        tenantId: true,
      },
    });

    if (!loan) {
      throw AppError.notFound('Loan not found');
    }

    if (loan.loanType !== 'DAILY') {
      throw AppError.badRequest('Penalties can only be imposed on DAILY loans');
    }

    if (loan.status === 'CLOSED' || loan.status === 'CANCELLED' || loan.status === 'WRITTEN_OFF') {
      throw AppError.badRequest(`Cannot impose penalty on a ${loan.status} loan`);
    }

    // Calculate days overdue
    const todayDate = parseDate(today());
    const overdueThreshold = addDays(loan.termEndDate!, loan.graceDays!);
    const daysOverdue = daysBetween(overdueThreshold, todayDate);

    if (daysOverdue <= 0) {
      throw AppError.badRequest('Loan is not overdue');
    }

    const totalMonthsOwed = Math.ceil(daysOverdue / 30);

    // Sum months_charged from ALL penalties (including WAIVED)
    const penaltiesAgg = await tx.penalty.aggregate({
      where: { loanId, tenantId },
      _sum: { monthsCharged: true },
    });
    const monthsAlreadyPenalised = penaltiesAgg._sum.monthsCharged ?? 0;

    const incrementalMonths = totalMonthsOwed - monthsAlreadyPenalised;

    if (incrementalMonths <= 0) {
      throw AppError.badRequest('No new penalty months to charge — all overdue months are already covered');
    }

    const principalAmount = new Decimal(loan.principalAmount.toString());
    const interestRate = new Decimal(loan.interestRate.toString());
    const calculatedAmount = principalAmount.mul(interestRate).div(100).mul(incrementalMonths);

    const wasOverridden = data.override_amount !== undefined;
    const finalAmount = wasOverridden ? new Decimal(data.override_amount!) : calculatedAmount;

    const imposedDate = parseDate(today());

    const penalty = await tx.penalty.create({
      data: {
        tenantId,
        loanId,
        daysOverdue,
        monthsCharged: incrementalMonths,
        penaltyAmount: finalAmount.toNumber(),
        waivedAmount: 0,
        netPayable: finalAmount.toNumber(),
        imposedDate,
        status: 'PENDING',
        amountCollected: 0,
        notes: data.notes,
        createdById,
      },
    });

    return {
      penalty: formatPenalty(penalty),
      calculation: {
        daysOverdue,
        totalMonthsOwed,
        monthsAlreadyPenalised,
        incrementalMonths,
        principalAmount: principalAmount.toNumber(),
        interestRate: interestRate.toNumber(),
        calculatedAmount: calculatedAmount.toNumber(),
        wasOverridden,
      },
    };
  });
}

// ─── listPenalties ───────────────────────────────────────────────────────────

export async function listPenalties(
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
  const where = { loanId, tenantId };

  const [data, total] = await Promise.all([
    prisma.penalty.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.limit,
    }),
    prisma.penalty.count({ where }),
  ]);

  return {
    data: data.map(formatPenalty),
    pagination: { page: query.page, limit: query.limit, total },
  };
}

// ─── waivePenalty ────────────────────────────────────────────────────────────

export async function waivePenalty(
  tenantId: string,
  penaltyId: string,
  adminId: string,
  data: { waive_amount: number; notes?: string },
) {
  return prisma.$transaction(async (tx) => {
    // Lock penalty row for update
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM penalties
      WHERE id = ${penaltyId}::uuid AND tenant_id = ${tenantId}::uuid
      FOR UPDATE
    `;

    if (rows.length === 0) {
      throw AppError.notFound('Penalty not found');
    }

    const penalty = await tx.penalty.findFirst({
      where: { id: penaltyId, tenantId },
    });

    if (!penalty) {
      throw AppError.notFound('Penalty not found');
    }

    if (penalty.status === 'PAID') {
      throw AppError.badRequest('Cannot waive a PAID penalty');
    }

    if (penalty.status === 'WAIVED') {
      throw AppError.badRequest('Cannot waive an already WAIVED penalty');
    }

    const penaltyAmount = new Decimal(penalty.penaltyAmount.toString());
    const currentWaived = new Decimal(penalty.waivedAmount.toString());
    const waiveAmount = new Decimal(data.waive_amount);
    const maxWaivable = penaltyAmount.minus(currentWaived);

    if (waiveAmount.gt(maxWaivable)) {
      throw AppError.badRequest(`Waive amount exceeds waivable amount (max: ${maxWaivable.toNumber()})`);
    }

    const newWaived = currentWaived.plus(waiveAmount);
    const newNetPayable = penaltyAmount.minus(newWaived);
    const amountCollected = new Decimal(penalty.amountCollected.toString());

    let newStatus: string;
    if (newNetPayable.eq(0)) {
      newStatus = 'WAIVED';
    } else if (amountCollected.gte(newNetPayable)) {
      newStatus = 'PAID';
    } else if (amountCollected.gt(0)) {
      newStatus = 'PARTIALLY_PAID';
    } else {
      newStatus = 'PENDING';
    }

    await tx.penalty.update({
      where: { id: penaltyId },
      data: {
        waivedAmount: newWaived.toNumber(),
        netPayable: newNetPayable.toNumber(),
        status: newStatus as 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'WAIVED',
      },
    });

    // Create PENALTY_WAIVER transaction (auto-approved)
    const txnDate = parseDate(today());
    const transaction = await tx.transaction.create({
      data: {
        tenantId,
        loanId: penalty.loanId,
        penaltyId,
        transactionType: 'PENALTY_WAIVER',
        amount: waiveAmount.toNumber(),
        transactionDate: txnDate,
        approvalStatus: 'APPROVED',
        approvedById: adminId,
        approvedAt: new Date(),
        collectedById: adminId,
        notes: data.notes,
      },
    });

    // Re-fetch the updated penalty
    const updated = await tx.penalty.findFirst({
      where: { id: penaltyId, tenantId },
    });

    return {
      penalty: formatPenalty(updated!),
      waiver: {
        id: transaction.id,
        loanId: transaction.loanId,
        transactionType: transaction.transactionType,
        amount: Number(transaction.amount),
        transactionDate: toDateString(transaction.transactionDate),
        effectiveDate: transaction.effectiveDate ? toDateString(transaction.effectiveDate) : null,
        penaltyId: transaction.penaltyId,
        notes: transaction.notes,
        createdAt: transaction.createdAt.toISOString(),
      },
    };
  });
}

// ─── waiveInterest ───────────────────────────────────────────────────────────

export async function waiveInterest(
  tenantId: string,
  loanId: string,
  adminId: string,
  data: { effective_date: string; waive_amount: number; notes?: string },
) {
  return prisma.$transaction(async (tx) => {
    const loan = await tx.loan.findFirst({
      where: { id: loanId, tenantId },
      select: { id: true, loanType: true, status: true },
    });

    if (!loan) {
      throw AppError.notFound('Loan not found');
    }

    if (loan.loanType !== 'MONTHLY') {
      throw AppError.badRequest('Interest waivers are only for MONTHLY loans');
    }

    if (loan.status === 'CLOSED' || loan.status === 'CANCELLED' || loan.status === 'WRITTEN_OFF') {
      throw AppError.badRequest(`Cannot waive interest on a ${loan.status} loan`);
    }

    const effectiveDate = parseDate(data.effective_date);
    const txnDate = parseDate(today());

    const transaction = await tx.transaction.create({
      data: {
        tenantId,
        loanId,
        transactionType: 'INTEREST_WAIVER',
        amount: data.waive_amount,
        transactionDate: txnDate,
        effectiveDate,
        approvalStatus: 'APPROVED',
        approvedById: adminId,
        approvedAt: new Date(),
        collectedById: adminId,
        notes: data.notes,
      },
    });

    return {
      id: transaction.id,
      loanId: transaction.loanId,
      transactionType: transaction.transactionType,
      amount: Number(transaction.amount),
      transactionDate: toDateString(transaction.transactionDate),
      effectiveDate: transaction.effectiveDate ? toDateString(transaction.effectiveDate) : null,
      penaltyId: transaction.penaltyId,
      notes: transaction.notes,
      createdAt: transaction.createdAt.toISOString(),
    };
  });
}

// ─── listWaivers ─────────────────────────────────────────────────────────────

export async function listWaivers(
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
  const where = {
    loanId,
    tenantId,
    transactionType: { in: ['PENALTY_WAIVER', 'INTEREST_WAIVER'] as ['PENALTY_WAIVER', 'INTEREST_WAIVER'] },
    approvalStatus: 'APPROVED' as const,
  };

  const [data, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: data.map((t: any) => ({
      id: t.id,
      loanId: t.loanId,
      transactionType: t.transactionType,
      amount: Number(t.amount),
      transactionDate: toDateString(t.transactionDate),
      effectiveDate: t.effectiveDate ? toDateString(t.effectiveDate) : null,
      penaltyId: t.penaltyId,
      notes: t.notes,
      createdAt: t.createdAt.toISOString(),
    })),
    pagination: { page: query.page, limit: query.limit, total },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatPenalty(p: any) {
  return {
    id: p.id,
    loanId: p.loanId,
    daysOverdue: p.daysOverdue,
    monthsCharged: p.monthsCharged,
    penaltyAmount: Number(p.penaltyAmount),
    waivedAmount: Number(p.waivedAmount),
    netPayable: Number(p.netPayable),
    imposedDate: toDateString(p.imposedDate),
    status: p.status,
    amountCollected: Number(p.amountCollected),
    notes: p.notes,
    createdById: p.createdById,
    createdAt: p.createdAt.toISOString(),
  };
}
