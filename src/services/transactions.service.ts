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
    transaction_type: 'INTEREST_PAYMENT' | 'PRINCIPAL_RETURN' | 'DAILY_COLLECTION' | 'PENALTY' | 'GUARANTOR_PAYMENT';
    amount: number;
    transaction_date: string;
    effective_date?: string;
    penalty_id?: string;
    corrected_transaction_id?: string;
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

    // Corrective transaction flow
    if (data.corrected_transaction_id) {
      if (callerRole !== 'ADMIN') {
        throw AppError.forbidden('Only admins can create corrective transactions');
      }
      return handleCorrectiveTransaction(tx, tenantId, createdById, loan, data);
    }

    // GUARANTOR_PAYMENT routing
    if (data.transaction_type === 'GUARANTOR_PAYMENT') {
      if (loan.status !== 'DEFAULTED') {
        throw AppError.badRequest('GUARANTOR_PAYMENT is only allowed on DEFAULTED loans');
      }
      return handleGuarantorPayment(tx, tenantId, createdById, loan, data, approvalStatus, isAutoApproved);
    }

    if (data.transaction_type === 'DAILY_COLLECTION') {
      if (loan.loanType !== 'DAILY') {
        throw AppError.badRequest('DAILY_COLLECTION is only for DAILY loans');
      }
      return handleDailyCollection(tx, tenantId, createdById, loan, data, approvalStatus, isAutoApproved);
    }

    if (data.transaction_type === 'PENALTY') {
      if (loan.loanType !== 'DAILY') {
        throw AppError.badRequest('PENALTY payments are only for DAILY loans');
      }
      return handlePenaltyPayment(tx, tenantId, createdById, loan, data, approvalStatus, isAutoApproved);
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

// ─── Penalty Payment Handler ─────────────────────────────────────────────

async function handlePenaltyPayment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string,
  createdById: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loan: any,
  data: { amount: number; transaction_date: string; penalty_id?: string; notes?: string },
  approvalStatus: string,
  isAutoApproved: boolean,
) {
  const transactionDate = parseDate(data.transaction_date);
  const amount = new Decimal(data.amount);

  // Resolve penalty: explicit penalty_id or auto-select oldest unpaid
  let penalty;
  if (data.penalty_id) {
    penalty = await tx.penalty.findFirst({
      where: { id: data.penalty_id, tenantId },
    });
    if (!penalty) {
      throw AppError.notFound('Penalty not found');
    }
    if (penalty.loanId !== loan.id) {
      throw AppError.badRequest('Penalty does not belong to this loan');
    }
  } else {
    penalty = await tx.penalty.findFirst({
      where: {
        loanId: loan.id,
        tenantId,
        status: { in: ['PENDING', 'PARTIALLY_PAID'] },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!penalty) {
      throw AppError.badRequest('No unpaid penalties found for this loan');
    }
  }

  if (penalty.status === 'PAID' || penalty.status === 'WAIVED') {
    throw AppError.badRequest(`Cannot pay a ${penalty.status} penalty`);
  }

  const netPayable = new Decimal(penalty.netPayable.toString());
  const amountCollected = new Decimal(penalty.amountCollected.toString());
  const remaining = netPayable.minus(amountCollected);

  if (amount.gt(remaining)) {
    throw AppError.badRequest(`Amount exceeds remaining penalty balance (max: ${remaining.toNumber()})`);
  }

  const txn = await tx.transaction.create({
    data: {
      tenantId,
      loanId: loan.id,
      penaltyId: penalty.id,
      transactionType: 'PENALTY',
      amount: amount.toNumber(),
      transactionDate,
      approvalStatus,
      collectedById: createdById,
      approvedById: isAutoApproved ? createdById : undefined,
      approvedAt: isAutoApproved ? new Date() : undefined,
      notes: data.notes,
    },
  });

  // Side effects only when auto-approved
  if (isAutoApproved) {
    await applyPenaltyPaymentSideEffect(tx, tenantId, penalty.id, amount.toNumber());
  }

  return [formatTransaction(txn)];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyPenaltyPaymentSideEffect(tx: any, tenantId: string, penaltyId: string, amount: number) {
  const penalty = await tx.penalty.findFirst({
    where: { id: penaltyId, tenantId },
  });

  if (!penalty) return;

  const netPayable = new Decimal(penalty.netPayable.toString());
  const newCollected = new Decimal(penalty.amountCollected.toString()).plus(new Decimal(amount));

  let newStatus: string;
  if (newCollected.gte(netPayable)) {
    newStatus = 'PAID';
  } else if (newCollected.gt(0)) {
    newStatus = 'PARTIALLY_PAID';
  } else {
    newStatus = 'PENDING';
  }

  await tx.penalty.update({
    where: { id: penaltyId },
    data: {
      amountCollected: newCollected.toNumber(),
      status: newStatus as 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'WAIVED',
    },
  });
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
      loanType: true,
      totalCollected: true,
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
  } else if (transaction.transactionType === 'PENALTY') {
    if (transaction.penaltyId) {
      await applyPenaltyPaymentSideEffect(tx, tenantId, transaction.penaltyId, Number(transaction.amount));
    }
  } else if (transaction.transactionType === 'GUARANTOR_PAYMENT') {
    // Increment totalCollected for DAILY loans only
    if (loan.loanType === 'DAILY') {
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
    }
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
    transaction_type?: 'INTEREST_PAYMENT' | 'PRINCIPAL_RETURN' | 'DAILY_COLLECTION' | 'PENALTY' | 'GUARANTOR_PAYMENT';
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

// ─── Guarantor Payment Handler ────────────────────────────────────────────

async function handleGuarantorPayment(
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
      transactionType: 'GUARANTOR_PAYMENT',
      amount: data.amount,
      transactionDate,
      approvalStatus,
      collectedById: createdById,
      approvedById: isAutoApproved ? createdById : undefined,
      approvedAt: isAutoApproved ? new Date() : undefined,
      notes: data.notes,
    },
  });

  // Increment totalCollected only for DAILY loans when auto-approved
  if (isAutoApproved && loan.loanType === 'DAILY') {
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

// ─── Corrective Transaction Handler ──────────────────────────────────────

async function handleCorrectiveTransaction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string,
  createdById: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loan: any,
  data: {
    loan_id: string;
    transaction_type: string;
    amount: number;
    corrected_transaction_id?: string;
    transaction_date: string;
    effective_date?: string;
    notes?: string;
  },
) {
  // Fetch the original transaction
  const original = await tx.transaction.findFirst({
    where: { id: data.corrected_transaction_id, tenantId },
  });

  if (!original) {
    throw AppError.notFound('Original transaction not found');
  }

  // Validate same loan
  if (original.loanId !== data.loan_id) {
    throw AppError.badRequest('Corrected transaction does not belong to the specified loan');
  }

  // Validate same type
  if (original.transactionType !== data.transaction_type) {
    throw AppError.badRequest('Corrective transaction must match the type of the original transaction');
  }

  // Validate original is APPROVED
  if (original.approvalStatus !== 'APPROVED') {
    throw AppError.badRequest('Can only correct APPROVED transactions');
  }

  // Validate no existing correction
  const existingCorrection = await tx.transaction.findFirst({
    where: { correctedTransactionId: data.corrected_transaction_id, tenantId },
  });
  if (existingCorrection) {
    throw AppError.conflict('This transaction has already been corrected');
  }

  // Amount must be negative (schema validates this, but double-check)
  if (data.amount >= 0) {
    throw AppError.badRequest('Corrective transaction amount must be negative');
  }

  const transactionDate = parseDate(data.transaction_date);

  // Create corrective transaction (auto-approved for admin)
  const txn = await tx.transaction.create({
    data: {
      tenantId,
      loanId: loan.id,
      transactionType: data.transaction_type,
      amount: data.amount,
      transactionDate,
      effectiveDate: data.effective_date ? parseDate(data.effective_date) : original.effectiveDate,
      approvalStatus: 'APPROVED',
      correctedTransactionId: data.corrected_transaction_id,
      collectedById: createdById,
      approvedById: createdById,
      approvedAt: new Date(),
      notes: data.notes ?? `Correction of transaction ${data.corrected_transaction_id}`,
    },
  });

  // Execute reversed side effects
  await executeReversedSideEffects(tx, tenantId, loan, original, Math.abs(data.amount), txn.id);

  return [formatTransaction(txn)];
}

// ─── Reversed Side Effects ───────────────────────────────────────────────

async function executeReversedSideEffects(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loanRef: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  original: any,
  absAmount: number,
  correctiveTransactionId: string,
) {
  const amount = new Decimal(absAmount);

  // Re-fetch loan to get current version (the passed loan object may be stale)
  const loan = await tx.loan.findFirst({
    where: { id: loanRef.id, tenantId },
    select: { id: true, version: true, loanType: true, remainingPrincipal: true, totalCollected: true },
  });
  if (!loan) {
    throw AppError.notFound('Loan not found');
  }

  if (original.transactionType === 'PRINCIPAL_RETURN') {
    // Increment remainingPrincipal back
    const updateResult = await tx.loan.updateMany({
      where: { id: loan.id, tenantId, version: loan.version },
      data: {
        remainingPrincipal: { increment: absAmount },
        version: { increment: 1 },
      },
    });
    if (updateResult.count === 0) {
      throw AppError.conflict('Loan was modified concurrently, please retry');
    }

    // Insert negative principal_returns record
    const currentLoan = await tx.loan.findFirst({
      where: { id: loan.id, tenantId },
      select: { remainingPrincipal: true },
    });
    await tx.principalReturn.create({
      data: {
        tenantId,
        loanId: loan.id,
        transactionId: correctiveTransactionId,
        amountReturned: -absAmount,
        remainingPrincipalAfter: Number(currentLoan.remainingPrincipal),
        returnDate: parseDate(new Date().toISOString().slice(0, 10)),
        createdById: original.collectedById ?? original.approvedById,
      },
    });
  } else if (original.transactionType === 'DAILY_COLLECTION') {
    // Decrement totalCollected
    const updateResult = await tx.loan.updateMany({
      where: { id: loan.id, tenantId, version: loan.version },
      data: {
        totalCollected: { decrement: absAmount },
        version: { increment: 1 },
      },
    });
    if (updateResult.count === 0) {
      throw AppError.conflict('Loan was modified concurrently, please retry');
    }
  } else if (original.transactionType === 'GUARANTOR_PAYMENT') {
    // Decrement totalCollected for daily loans only
    if (loan.loanType === 'DAILY') {
      const updateResult = await tx.loan.updateMany({
        where: { id: loan.id, tenantId, version: loan.version },
        data: {
          totalCollected: { decrement: absAmount },
          version: { increment: 1 },
        },
      });
      if (updateResult.count === 0) {
        throw AppError.conflict('Loan was modified concurrently, please retry');
      }
    }
  } else if (original.transactionType === 'PENALTY') {
    // Decrement penalty.amountCollected, recalculate status
    if (original.penaltyId) {
      const penalty = await tx.penalty.findFirst({
        where: { id: original.penaltyId, tenantId },
      });
      if (penalty) {
        const netPayable = new Decimal(penalty.netPayable.toString());
        const newCollected = new Decimal(penalty.amountCollected.toString()).minus(amount);
        const clamped = newCollected.lt(0) ? new Decimal(0) : newCollected;

        let newStatus: string;
        if (clamped.gte(netPayable)) {
          newStatus = 'PAID';
        } else if (clamped.gt(0)) {
          newStatus = 'PARTIALLY_PAID';
        } else {
          newStatus = 'PENDING';
        }

        await tx.penalty.update({
          where: { id: original.penaltyId },
          data: {
            amountCollected: clamped.toNumber(),
            status: newStatus as 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'WAIVED',
          },
        });
      }
    }
  }
  // INTEREST_PAYMENT — no loan-level side effect
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
