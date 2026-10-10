/**
 * Decides which recorded payments an admin may fix or remove.
 *
 * An "entry" is one recorded payment. It is usually one transaction row, but an
 * interest payment can be split across several months and a principal return, and
 * those rows share an `entryId`. Rows recorded before `entryId` existed have none
 * and are treated as one-row entries.
 *
 * Everything here is a pure function of the loan and its transaction rows, so the
 * same rule answers "may this be fixed?" for a single entry and for a whole list.
 */

export const FIXABLE_TYPES = [
  'INTEREST_PAYMENT',
  'PRINCIPAL_RETURN',
  'DAILY_COLLECTION',
  'PENALTY',
  'GUARANTOR_PAYMENT',
] as const;

export interface EntryRow {
  id: string;
  entryId: string | null;
  correctedTransactionId: string | null;
  transactionType: string;
  approvalStatus: string;
  createdAt: Date;
}

export interface EntryLoan {
  loanType: string;
  status: string;
}

/**
 * Rows recorded before entry ids existed that sit this close together on one loan
 * were parts of a single payment. Nobody records two payments on a loan this fast.
 */
const LEGACY_SPLIT_WINDOW_MS = 2000;

function isFixableType(type: string): boolean {
  return (FIXABLE_TYPES as readonly string[]).includes(type);
}

function correctedIdsOf(all: EntryRow[]): Set<string> {
  const ids = new Set<string>();
  for (const r of all) {
    if (r.correctedTransactionId) ids.add(r.correctedTransactionId);
  }
  return ids;
}

/** The rows of the same payment as `row` that still count: not corrections, not corrected, not rejected. */
export function entryRowsOf<T extends EntryRow>(row: T, all: T[]): T[] {
  const corrected = correctedIdsOf(all);
  const candidates = row.entryId ? all.filter((r) => r.entryId === row.entryId) : [row];
  return candidates.filter(
    (r) =>
      r.correctedTransactionId == null && !corrected.has(r.id) && r.approvalStatus !== 'REJECTED',
  );
}

/**
 * Returns null when the entry `row` belongs to may be fixed or removed, otherwise
 * the reason it may not, worded for the person looking at the screen.
 */
export function whyNotFixable<T extends EntryRow>(
  loan: EntryLoan,
  all: T[],
  row: T,
): string | null {
  const corrected = correctedIdsOf(all);

  if (row.correctedTransactionId != null) {
    return 'This is a correction, not a payment';
  }
  if (corrected.has(row.id)) {
    return 'This entry has already been corrected';
  }
  if (!isFixableType(row.transactionType)) {
    return 'This kind of entry cannot be changed here';
  }
  if (row.approvalStatus === 'REJECTED') {
    return 'This entry was rejected and has no effect';
  }

  const sameEntry = row.entryId ? all.filter((r) => r.entryId === row.entryId) : [row];
  if (sameEntry.some((r) => r.approvalStatus === 'PENDING')) {
    return 'This entry is waiting for approval: approve or reject it instead';
  }

  if (loan.status !== 'ACTIVE' && loan.status !== 'DEFAULTED') {
    return `Entries on a ${loan.status.toLowerCase().replace(/_/g, ' ')} loan cannot be changed`;
  }

  if (loan.loanType !== 'MONTHLY') {
    return null;
  }

  // A payment recorded in several rows before entry ids existed cannot be told
  // apart reliably, so it is not changed here. Checked before the latest-entry
  // rule so that each of its parts reports this reason.
  if (row.entryId == null) {
    const rowRecordedAt = row.createdAt.getTime();
    const hasSiblingPart = all.some(
      (r) =>
        r.id !== row.id &&
        r.entryId == null &&
        r.correctedTransactionId == null &&
        r.approvalStatus !== 'REJECTED' &&
        isFixableType(r.transactionType) &&
        Math.abs(r.createdAt.getTime() - rowRecordedAt) <= LEGACY_SPLIT_WINDOW_MS,
    );
    if (hasSiblingPart) {
      return 'This payment was recorded in several parts before corrections were supported and cannot be changed here';
    }
  }

  // Monthly loans: later entries are worked out on top of earlier ones (which months
  // a payment settled, what principal interest was charged on), so only the latest
  // entry can be changed without altering what the later ones mean.
  const entryIds = new Set(sameEntry.map((r) => r.id));
  const entryRecordedAt = Math.max(...sameEntry.map((r) => r.createdAt.getTime()));
  const laterEntryExists = all.some(
    (r) =>
      !entryIds.has(r.id) &&
      r.correctedTransactionId == null &&
      !corrected.has(r.id) &&
      (r.approvalStatus === 'APPROVED' || r.approvalStatus === 'PENDING') &&
      r.createdAt.getTime() > entryRecordedAt,
  );
  if (laterEntryExists) {
    return 'Only the latest entry on a monthly loan can be changed, and this loan has later entries';
  }

  return null;
}

/** Ids of every row on the loan that belongs to an entry which may be fixed or removed. */
export function fixableIds<T extends EntryRow>(loan: EntryLoan, all: T[]): Set<string> {
  const ids = new Set<string>();
  for (const row of all) {
    if (whyNotFixable(loan, all, row) === null) ids.add(row.id);
  }
  return ids;
}
