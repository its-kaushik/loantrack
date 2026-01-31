import Decimal from 'decimal.js';
import prisma from '../lib/prisma.js';
import { AppError } from '../utils/errors.js';
import { parseDate, toDateString } from '../utils/date.js';

// ─── recordTransaction ─────────────────────────────────────────────────────

export async function recordTransaction(
  tenantId: string,
  createdById: string,
  data: {
    loan_id: string;
    transaction_type: 'INTEREST_PAYMENT' | 'PRINCIPAL_RETURN' | 'DAILY_COLLECTION';
    amount: number;
    transaction_date: string;
    effective_date?: string;
    notes?: string;
  },
) {
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

    if (loan.status !== 'ACTIVE') {
      throw AppError.badRequest('Loan is not active');
    }

    if (data.transaction_type === 'DAILY_COLLECTION') {
      if (loan.loanType !== 'DAILY') {
        throw AppError.badRequest('DAILY_COLLECTION is only for DAILY loans');
      }
      return handleDailyCollection(tx, tenantId, createdById, loan, data);
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

      // If billingPrincipal differs from expected, sync it
      let activeBillingPrincipal = currentBillingPrincipal;
      if (!currentBillingPrincipal.eq(expectedBillingPrincipal)) {
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
            approvalStatus: 'APPROVED',
            collectedById: createdById,
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
            approvalStatus: 'APPROVED',
            collectedById: createdById,
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
            approvalStatus: 'APPROVED',
            collectedById: createdById,
            notes: data.notes ? `Auto-split: ${data.notes}` : 'Auto-split from overpayment',
          },
        });
        createdTransactions.push(formatTransaction(principalTxn));

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
          approvalStatus: 'APPROVED',
          collectedById: createdById,
          notes: data.notes,
        },
      });
      createdTransactions.push(formatTransaction(txn));

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
) {
  const transactionDate = parseDate(data.transaction_date);

  // Create DAILY_COLLECTION transaction (auto-approved, no effectiveDate)
  const txn = await tx.transaction.create({
    data: {
      tenantId,
      loanId: loan.id,
      transactionType: 'DAILY_COLLECTION',
      amount: data.amount,
      transactionDate,
      approvalStatus: 'APPROVED',
      collectedById: createdById,
      notes: data.notes,
    },
  });

  // Increment totalCollected with optimistic lock
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

  return [formatTransaction(txn)];
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
