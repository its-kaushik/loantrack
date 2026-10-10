import Decimal from 'decimal.js';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma.js';
import { AppError } from '../utils/errors.js';
import { toDateString } from '../utils/date.js';
import { entryRowsOf, whyNotFixable } from '../utils/entry-fixability.js';
import {
  recordTransactionInTx,
  executeReversedSideEffects,
  formatTransaction,
  type RecordTransactionData,
} from './transactions.service.js';

/**
 * Fixing or removing a recorded payment ("entry").
 *
 * The wrong entry is never edited or deleted. Each of its rows gets a corrective
 * row (negative amount, dated the same day as the row it undoes, so that day's
 * totals become what they should have been) and its effect on the loan is
 * reversed. A fix then records the corrected payment in the same database
 * transaction: either both happen or neither does.
 */

const entryRowSelect = {
  id: true,
  loanId: true,
  penaltyId: true,
  entryId: true,
  correctedTransactionId: true,
  transactionType: true,
  amount: true,
  transactionDate: true,
  effectiveDate: true,
  approvalStatus: true,
  collectedById: true,
  approvedById: true,
  notes: true,
  createdAt: true,
} as const;

type Db = Prisma.TransactionClient | typeof prisma;

async function loadEntry(db: Db, tenantId: string, transactionId: string) {
  const target = await db.transaction.findFirst({
    where: { id: transactionId, tenantId },
    select: { id: true, loanId: true },
  });
  if (!target) {
    throw AppError.notFound('Transaction not found');
  }

  const loan = await db.loan.findFirst({
    where: { id: target.loanId, tenantId },
    select: {
      id: true,
      loanNumber: true,
      loanType: true,
      status: true,
      borrower: { select: { fullName: true } },
    },
  });
  if (!loan) {
    throw AppError.notFound('Loan not found');
  }

  const all = await db.transaction.findMany({
    where: { loanId: target.loanId, tenantId },
    select: entryRowSelect,
    orderBy: { createdAt: 'asc' },
  });
  const row = all.find((r) => r.id === transactionId)!;

  return {
    loan,
    rows: entryRowsOf(row, all),
    reason: whyNotFixable(loan, all, row),
  };
}

/** Serialises every change to the given loans for the rest of the transaction. */
async function lockLoans(tx: Prisma.TransactionClient, tenantId: string, loanIds: string[]) {
  // Always in the same order, so two fixes moving payments between the same loans cannot deadlock
  for (const loanId of [...new Set(loanIds)].sort()) {
    await tx.$queryRaw`
      SELECT id FROM loans
      WHERE id = ${loanId}::uuid AND tenant_id = ${tenantId}::uuid
      FOR UPDATE
    `;
  }
}

async function lockAndLoadFixableEntry(
  tx: Prisma.TransactionClient,
  tenantId: string,
  transactionId: string,
  otherLoanIds: string[],
) {
  const target = await tx.transaction.findFirst({
    where: { id: transactionId, tenantId },
    select: { loanId: true },
  });
  if (!target) {
    throw AppError.notFound('Transaction not found');
  }

  await lockLoans(tx, tenantId, [target.loanId, ...otherLoanIds]);

  // Read only after locking, so the check and the change see the same rows
  const entry = await loadEntry(tx, tenantId, transactionId);
  if (entry.reason) {
    throw AppError.badRequest(entry.reason);
  }
  return entry;
}

type EntryRows = Awaited<ReturnType<typeof loadEntry>>['rows'];

async function undoRows(
  tx: Prisma.TransactionClient,
  tenantId: string,
  adminId: string,
  rows: EntryRows,
  note: string,
) {
  const correctives = [];

  for (const row of rows) {
    const amount = new Decimal(row.amount.toString());

    const corrective = await tx.transaction.create({
      data: {
        tenantId,
        loanId: row.loanId,
        penaltyId: row.penaltyId,
        transactionType: row.transactionType,
        amount: amount.negated().toNumber(),
        transactionDate: row.transactionDate,
        effectiveDate: row.effectiveDate,
        approvalStatus: 'APPROVED',
        correctedTransactionId: row.id,
        collectedById: row.collectedById ?? adminId,
        approvedById: adminId,
        approvedAt: new Date(),
        notes: note,
      },
    });

    await executeReversedSideEffects(
      tx,
      tenantId,
      { id: row.loanId },
      row,
      amount.toNumber(),
      corrective.id,
    );

    correctives.push(formatTransaction(corrective));
  }

  return correctives;
}

function withReason(prefix: string, reason: string | undefined) {
  const trimmed = reason?.trim();
  return trimmed ? `${prefix}: ${trimmed}` : prefix;
}

// ─── getEntry ────────────────────────────────────────────────────────────

/** The payment a transaction row belongs to, as it was entered, and whether it may be changed. */
export async function getEntry(tenantId: string, transactionId: string) {
  const { loan, rows, reason } = await loadEntry(prisma, tenantId, transactionId);

  // An interest payment's excess is recorded as a principal return; what was entered is the interest payment
  const entered = rows.find((r) => r.transactionType === 'INTEREST_PAYMENT') ?? rows[0];
  const amount = rows.reduce(
    (sum, r) => sum.plus(new Decimal(r.amount.toString())),
    new Decimal(0),
  );

  return {
    transactionId,
    loanId: loan.id,
    loanNumber: loan.loanNumber,
    borrowerName: loan.borrower.fullName,
    loanType: loan.loanType,
    transactionType: entered?.transactionType ?? null,
    amount: amount.toNumber(),
    transactionDate: entered ? toDateString(entered.transactionDate) : null,
    notes: entered?.notes ?? null,
    canFix: reason === null,
    reason,
    rows: rows.map(formatTransaction),
  };
}

// ─── removeEntry ─────────────────────────────────────────────────────────

/** Undoes a payment that should not have been recorded at all. */
export async function removeEntry(
  tenantId: string,
  adminId: string,
  transactionId: string,
  data: { reason?: string },
) {
  return prisma.$transaction(async (tx) => {
    const { rows } = await lockAndLoadFixableEntry(tx, tenantId, transactionId, []);

    const removed = await undoRows(
      tx,
      tenantId,
      adminId,
      rows,
      withReason('Removed, entered by mistake', data.reason),
    );

    return { removed, recorded: [] as ReturnType<typeof formatTransaction>[] };
  });
}

// ─── fixEntry ────────────────────────────────────────────────────────────

/**
 * Undoes a wrongly recorded payment and records the corrected one in its place.
 * The replacement may differ in loan, type, amount or date, and goes through the
 * same rules as any newly recorded payment; if it is refused, nothing is undone.
 */
export async function fixEntry(
  tenantId: string,
  adminId: string,
  transactionId: string,
  data: Omit<RecordTransactionData, 'corrected_transaction_id'> & { reason?: string },
) {
  const { reason, ...replacement } = data;

  return prisma.$transaction(async (tx) => {
    const { rows } = await lockAndLoadFixableEntry(tx, tenantId, transactionId, [
      replacement.loan_id,
    ]);

    const removed = await undoRows(
      tx,
      tenantId,
      adminId,
      rows,
      withReason('Corrected, replaced by a new entry', reason),
    );

    // Still credited to whoever collected the money; the admin is recorded as approver
    const recorded = await recordTransactionInTx(tx, tenantId, adminId, 'ADMIN', replacement, {
      collectedById: rows[0]?.collectedById ?? adminId,
    });

    return { removed, recorded };
  });
}
