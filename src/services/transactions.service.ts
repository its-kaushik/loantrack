import Decimal from 'decimal.js';
import prisma from '../lib/prisma.js';
import { AppError } from '../utils/errors.js';
import { parseDate, toDateString } from '../utils/date.js';

// ─── recordTransaction ─────────────────────────────────────────────────────

export async function recordTransaction(
  tenantId: string,
  createdById: string,
  callerRole: 'ADMIN' | 'COLLECTOR',
  data: {
    loan_id: string;
    transaction_type: 'INTEREST_PAYMENT' | 'PRINCIPAL_RETURN' | 'DAILY_COLLECTION';
    amount: number;
    transaction_date: string;
    effective_date?: string;
    notes?: string;
  },
) {
  const approvalStatus = callerRole === 'ADMIN' ? 'APPROVED' : 'PENDING';
  const isAutoApproved = callerRole === 'ADMIN';

  return prisma.$transaction(async (tx) => {
    // Fetch loan with version for optimistic locking
    const loan = await tx.loan.findFirst({
      where: { id: data.loan_id, tenantId },
      select: {
        id: true,
        status: true,
        loanType: true,
        interestRate: true,
        remainingPrincipal: true,
        billingPrincipal: true,
        principalAmount: true,
        version: true,
        tenantId: true,
        totalCollected: true,
        totalRepaymentAmount: true,
      },
    });

    if (!loan) {
      throw AppError.notFound('Loan not found');
    }

    // Expanded loan status validation
    if (loan.status === 'CANCELLED' || loan.status === 'CLOSED' || loan.status === 'WRITTEN_OFF') {
      throw AppError.badRequest(`Cannot record transactions on a ${loan.status} loan`);
    }
    // ACTIVE and DEFAULTED are accepted

    if (data.transaction_type === 'DAILY_COLLECTION') {
      if (loan.loanType !== 'DAILY') {
        throw AppError.badRequest('DAILY_COLLECTION is only for DAILY loans');
      }
      return handleDailyCollection(tx, tenantId, createdById, loan, data, approvalStatus, isAutoApproved);
    }

    if (loan.loanType !== 'MONTHLY') {
      throw AppError.badRequest('INTEREST_PAYMENT and PRINCIPAL_RETURN are only for MONTHLY loans');
    }

    const transactionDate = parseDate(data.transaction_date);
    const amount = new Decimal(data.amount);
    const rate = new Decimal(loan.interestRate.toString());
    const remainingPrincipal = new Decimal(loan.remainingPrincipal!.toString());
    const currentBillingPrincipal = new Decimal(loan.billingPrincipal!.toString());

    const createdTransactions: Array<{
      id: string;
      loanId: string;
      transactionType: string;
      amount: number;
      transactionDate: string;
      effectiveDate: string | null;
      approvalStatus: string;
      notes: string | null;
      createdAt: string;
    }> = [];

    if (data.transaction_type === 'INTEREST_PAYMENT') {
      const effectiveDate = parseDate(data.effective_date!);
      const effectiveYear = effectiveDate.getUTCFullYear();
      const effectiveMonth = effectiveDate.getUTCMonth() + 1;

      // Sync billingPrincipal at cycle boundary:
      // Check if we need to sync billingPrincipal = remainingPrincipal for this cycle.
      // Billing principal syncs when entering a new cycle.
      const cycleStartDate = new Date(Date.UTC(effectiveYear, effectiveMonth - 1, 1));

      // Find the last principal return before this cycle
      const lastReturn = await tx.principalReturn.findFirst({
        where: {
          loanId: loan.id,
          tenantId,
          returnDate: { lt: cycleStartDate },
        },
        orderBy: { returnDate: 'desc' },
        select: { remainingPrincipalAfter: true },
      });

      // The expected billingPrincipal for this cycle
      const expectedBillingPrincipal = lastReturn
        ? new Decimal(lastReturn.remainingPrincipalAfter.toString())
        : new Decimal(loan.principalAmount.toString());

      // If billingPrincipal differs from expected, sync it (only for admin auto-approved)
      let activeBillingPrincipal = currentBillingPrincipal;
      if (isAutoApproved && !currentBillingPrincipal.eq(expectedBillingPrincipal)) {
        const syncResult = await tx.loan.updateMany({
          where: { id: loan.id, tenantId, version: loan.version },
          data: {
            billingPrincipal: expectedBillingPrincipal.toNumber(),
            version: { increment: 1 },
          },
        });
        if (syncResult.count === 0) {
          throw AppError.conflict('Loan was modified concurrently, please retry');
        }
        activeBillingPrincipal = expectedBillingPrincipal;
        loan.version++;
      } else {
        // For collector PENDING or when already synced, use expected for calculation
        activeBillingPrincipal = expectedBillingPrincipal;
      }

      const interestDue = activeBillingPrincipal.mul(rate).div(100);

      if (amount.lte(interestDue)) {
        // Exact or underpayment — single INTEREST_PAYMENT
        const txn = await tx.transaction.create({
          data: {
            tenantId,
            loanId: loan.id,
            transactionType: 'INTEREST_PAYMENT',
            amount: amount.toNumber(),
            transactionDate,
            effectiveDate,
            approvalStatus,
            collectedById: createdById,
            approvedById: isAutoApproved ? createdById : undefined,
            approvedAt: isAutoApproved ? new Date() : undefined,
            notes: data.notes,
          },
        });
        createdTransactions.push(formatTransaction(txn));
      } else {
        // Overpayment — auto-split
        const interestPortion = interestDue;
        const principalPortion = amount.minus(interestDue);

        if (principalPortion.gt(remainingPrincipal)) {
          throw AppError.badRequest('Overpayment exceeds remaining principal');
        }

        // Create INTEREST_PAYMENT for interest portion
        const interestTxn = await tx.transaction.create({
          data: {
            tenantId,
            loanId: loan.id,
            transactionType: 'INTEREST_PAYMENT',
            amount: interestPortion.toNumber(),
            transactionDate,
            effectiveDate,
            approvalStatus,
            collectedById: createdById,
            approvedById: isAutoApproved ? createdById : undefined,
            approvedAt: isAutoApproved ? new Date() : undefined,
            notes: data.notes,
          },
        });
        createdTransactions.push(formatTransaction(interestTxn));

        // Create PRINCIPAL_RETURN for principal portion
        const newRemaining = remainingPrincipal.minus(principalPortion);

        const principalTxn = await tx.transaction.create({
          data: {
            tenantId,
            loanId: loan.id,
            transactionType: 'PRINCIPAL_RETURN',
            amount: principalPortion.toNumber(),
            transactionDate,
            approvalStatus,
            collectedById: createdById,
            approvedById: isAutoApproved ? createdById : undefined,
            approvedAt: isAutoApproved ? new Date() : undefined,
            notes: data.notes ? `Auto-split: ${data.notes}` : 'Auto-split from overpayment',
          },
        });
        createdTransactions.push(formatTransaction(principalTxn));

        // Side effects only when auto-approved
        if (isAutoApproved) {
          // Decrement remaining principal with optimistic lock
          const updateResult = await tx.loan.updateMany({
            where: { id: loan.id, tenantId, version: loan.version },
            data: {
              remainingPrincipal: newRemaining.toNumber(),
              version: { increment: 1 },
            },
          });
          if (updateResult.count === 0) {
            throw AppError.conflict('Loan was modified concurrently, please retry');
          }

          // Insert principal_returns record
          await tx.principalReturn.create({
            data: {
              tenantId,
              loanId: loan.id,
              transactionId: principalTxn.id,
              amountReturned: principalPortion.toNumber(),
              remainingPrincipalAfter: newRemaining.toNumber(),
              returnDate: transactionDate,
              createdById,
            },
          });
        }
      }
    } else {
      // PRINCIPAL_RETURN
      if (amount.gt(remainingPrincipal)) {
        throw AppError.badRequest('Amount exceeds remaining principal');
      }

      const newRemaining = remainingPrincipal.minus(amount);

      const txn = await tx.transaction.create({
        data: {
          tenantId,
          loanId: loan.id,
          transactionType: 'PRINCIPAL_RETURN',
          amount: amount.toNumber(),
          transactionDate,
          approvalStatus,
          collectedById: createdById,
          approvedById: isAutoApproved ? createdById : undefined,
          approvedAt: isAutoApproved ? new Date() : undefined,
          notes: data.notes,
        },
      });
      createdTransactions.push(formatTransaction(txn));

      // Side effects only when auto-approved
      if (isAutoApproved) {
        // Decrement remaining principal with optimistic lock
        const updateResult = await tx.loan.updateMany({
          where: { id: loan.id, tenantId, version: loan.version },
          data: {
            remainingPrincipal: newRemaining.toNumber(),
            version: { increment: 1 },
          },
        });
        if (updateResult.count === 0) {
          throw AppError.conflict('Loan was modified concurrently, please retry');
        }

        // Insert principal_returns record
        await tx.principalReturn.create({
          data: {
            tenantId,
            loanId: loan.id,
            transactionId: txn.id,
            amountReturned: amount.toNumber(),
            remainingPrincipalAfter: newRemaining.toNumber(),
            returnDate: transactionDate,
            createdById,
          },
        });
      }
    }

    return createdTransactions;
  });
}

// ─── Daily Collection Handler ─────────────────────────────────────────────

async function handleDailyCollection(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string,
  createdById: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loan: any,
  data: { amount: number; transaction_date: string; notes?: string },
  approvalStatus: string,
  isAutoApproved: boolean,
) {
  const transactionDate = parseDate(data.transaction_date);

  const txn = await tx.transaction.create({
    data: {
      tenantId,
      loanId: loan.id,
      transactionType: 'DAILY_COLLECTION',
      amount: data.amount,
      transactionDate,
      approvalStatus,
      collectedById: createdById,
      approvedById: isAutoApproved ? createdById : undefined,
      approvedAt: isAutoApproved ? new Date() : undefined,
      notes: data.notes,
    },
  });

  // Increment totalCollected only when auto-approved
  if (isAutoApproved) {
    const updateResult = await tx.loan.updateMany({
      where: { id: loan.id, tenantId, version: loan.version },
      data: {
        totalCollected: { increment: data.amount },
        version: { increment: 1 },
      },
    });

    if (updateResult.count === 0) {
      throw AppError.conflict('Loan was modified concurrently, please retry');
    }
  }

  return [formatTransaction(txn)];
}

// ─── executeSideEffects ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeSideEffects(tx: any, tenantId: string, approvedById: string, transaction: any) {
  const loan = await tx.loan.findFirst({
    where: { id: transaction.loanId, tenantId },
    select: {
      id: true,
      version: true,
      remainingPrincipal: true,
      principalAmount: true,
      interestRate: true,
      billingPrincipal: true,
    },
  });

  if (!loan) {
    throw AppError.notFound('Loan not found');
  }

  if (transaction.transactionType === 'DAILY_COLLECTION') {
    const updateResult = await tx.loan.updateMany({
      where: { id: loan.id, tenantId, version: loan.version },
      data: {
        totalCollected: { increment: Number(transaction.amount) },
        version: { increment: 1 },
      },
    });
    if (updateResult.count === 0) {
      throw AppError.conflict('Loan was modified concurrently, please retry');
    }
  } else if (transaction.transactionType === 'PRINCIPAL_RETURN') {
    const amount = new Decimal(transaction.amount.toString());
    const remainingPrincipal = new Decimal(loan.remainingPrincipal!.toString());

    if (amount.gt(remainingPrincipal)) {
      throw AppError.badRequest('Amount exceeds remaining principal');
    }

    const newRemaining = remainingPrincipal.minus(amount);

    const updateResult = await tx.loan.updateMany({
      where: { id: loan.id, tenantId, version: loan.version },
      data: {
        remainingPrincipal: newRemaining.toNumber(),
        version: { increment: 1 },
      },
    });
    if (updateResult.count === 0) {
      throw AppError.conflict('Loan was modified concurrently, please retry');
    }

    // Insert principal_returns record
    await tx.principalReturn.create({
      data: {
        tenantId,
        loanId: loan.id,
        transactionId: transaction.id,
        amountReturned: amount.toNumber(),
        remainingPrincipalAfter: newRemaining.toNumber(),
        returnDate: transaction.transactionDate,
        createdById: approvedById,
      },
    });
  }
  // INTEREST_PAYMENT — no loan-level side effect
}

// ─── approveTransaction ──────────────────────────────────────────────────

export async function approveTransaction(tenantId: string, transactionId: string, approvedById: string) {
  return prisma.$transaction(async (tx) => {
    // Lock the transaction row
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM transactions
      WHERE id = ${transactionId}::uuid AND tenant_id = ${tenantId}::uuid
      FOR UPDATE
    `;

    if (rows.length === 0) {
      throw AppError.notFound('Transaction not found');
    }

    const transaction = await tx.transaction.findFirst({
      where: { id: transactionId, tenantId },
      include: {
        loan: { select: { loanNumber: true, borrower: { select: { fullName: true } } } },
        collectedBy: { select: { name: true } },
      },
    });

    if (!transaction) {
      throw AppError.notFound('Transaction not found');
    }

    if (transaction.approvalStatus !== 'PENDING') {
      throw AppError.conflict(`Transaction is already ${transaction.approvalStatus}`);
    }

    // Update to APPROVED
    const updated = await tx.transaction.update({
      where: { id: transactionId },
      data: {
        approvalStatus: 'APPROVED',
        approvedById,
        approvedAt: new Date(),
      },
      include: {
        loan: { select: { loanNumber: true, borrower: { select: { fullName: true } } } },
        collectedBy: { select: { name: true } },
      },
    });

    // Execute side effects
    await executeSideEffects(tx, tenantId, approvedById, updated);

    return formatTransactionDetail(updated);
  });
}

// ─── rejectTransaction ───────────────────────────────────────────────────

export async function rejectTransaction(
  tenantId: string,
  transactionId: string,
  _rejectedById: string,
  rejectionReason: string,
) {
  return prisma.$transaction(async (tx) => {
    // Lock the transaction row
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM transactions
      WHERE id = ${transactionId}::uuid AND tenant_id = ${tenantId}::uuid
      FOR UPDATE
    `;

    if (rows.length === 0) {
      throw AppError.notFound('Transaction not found');
    }

    const transaction = await tx.transaction.findFirst({
      where: { id: transactionId, tenantId },
    });

    if (!transaction) {
      throw AppError.notFound('Transaction not found');
    }

    if (transaction.approvalStatus !== 'PENDING') {
      throw AppError.conflict(`Transaction is already ${transaction.approvalStatus}`);
    }

    const updated = await tx.transaction.update({
      where: { id: transactionId },
      data: {
        approvalStatus: 'REJECTED',
        rejectionReason,
      },
      include: {
        loan: { select: { loanNumber: true, borrower: { select: { fullName: true } } } },
        collectedBy: { select: { name: true } },
      },
    });

    return formatTransactionDetail(updated);
  });
}

// ─── listPendingTransactions ─────────────────────────────────────────────

export async function listPendingTransactions(
  tenantId: string,
  query: { page: number; limit: number },
) {
  const skip = (query.page - 1) * query.limit;

  const where = { tenantId, approvalStatus: 'PENDING' as const };

  const [data, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: {
        loan: { select: { loanNumber: true, borrower: { select: { fullName: true } } } },
        collectedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
      skip,
      take: query.limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return {
    data: data.map(formatTransactionDetail),
    pagination: { page: query.page, limit: query.limit, total },
  };
}

// ─── listTransactions ────────────────────────────────────────────────────

export async function listTransactions(
  tenantId: string,
  query: {
    approval_status?: 'PENDING' | 'APPROVED' | 'REJECTED';
    transaction_type?: 'INTEREST_PAYMENT' | 'PRINCIPAL_RETURN' | 'DAILY_COLLECTION';
    loan_id?: string;
    collected_by?: string;
    page: number;
    limit: number;
  },
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { tenantId };

  if (query.approval_status) {
    where.approvalStatus = query.approval_status;
  }
  if (query.transaction_type) {
    where.transactionType = query.transaction_type;
  }
  if (query.loan_id) {
    where.loanId = query.loan_id;
  }
  if (query.collected_by) {
    where.collectedById = query.collected_by;
  }

  const skip = (query.page - 1) * query.limit;

  const [data, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: {
        loan: { select: { loanNumber: true, borrower: { select: { fullName: true } } } },
        collectedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return {
    data: data.map(formatTransactionDetail),
    pagination: { page: query.page, limit: query.limit, total },
  };
}

// ─── recordBulkCollections ───────────────────────────────────────────────

export async function recordBulkCollections(
  tenantId: string,
  collectorId: string,
  collections: Array<{
    loan_id: string;
    amount: number;
    transaction_date: string;
    notes?: string;
  }>,
) {
  let created = 0;
  let failed = 0;
  const results: Array<{
    success: boolean;
    transaction?: {
      id: string;
      loanId: string;
      transactionType: string;
      amount: number;
      transactionDate: string;
      effectiveDate: string | null;
      approvalStatus: string;
      notes: string | null;
      createdAt: string;
    };
    error?: string;
  }> = [];

  for (const item of collections) {
    try {
      const txns = await recordTransaction(tenantId, collectorId, 'COLLECTOR', {
        loan_id: item.loan_id,
        transaction_type: 'DAILY_COLLECTION',
        amount: item.amount,
        transaction_date: item.transaction_date,
        notes: item.notes,
      });
      created++;
      results.push({ success: true, transaction: txns[0] });
    } catch (err) {
      failed++;
      const message = err instanceof AppError ? err.message : 'Unknown error';
      results.push({ success: false, error: message });
    }
  }

  return { created, failed, results };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatTransaction(txn: any) {
  return {
    id: txn.id,
    loanId: txn.loanId,
    transactionType: txn.transactionType,
    amount: Number(txn.amount),
    transactionDate: toDateString(txn.transactionDate),
    effectiveDate: txn.effectiveDate ? toDateString(txn.effectiveDate) : null,
    approvalStatus: txn.approvalStatus,
    notes: txn.notes,
    createdAt: txn.createdAt.toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatTransactionDetail(txn: any) {
  return {
    id: txn.id,
    loanId: txn.loanId,
    loanNumber: txn.loan?.loanNumber ?? null,
    borrowerName: txn.loan?.borrower?.fullName ?? null,
    transactionType: txn.transactionType,
    amount: Number(txn.amount),
    transactionDate: toDateString(txn.transactionDate),
    effectiveDate: txn.effectiveDate ? toDateString(txn.effectiveDate) : null,
    approvalStatus: txn.approvalStatus,
    collectedById: txn.collectedById,
    collectorName: txn.collectedBy?.name ?? null,
    approvedById: txn.approvedById,
    approvedAt: txn.approvedAt ? txn.approvedAt.toISOString() : null,
    rejectionReason: txn.rejectionReason,
    notes: txn.notes,
    createdAt: txn.createdAt.toISOString(),
  };
}
