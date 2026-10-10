import {
  entryRowsOf,
  fixableIds,
  whyNotFixable,
  type EntryRow,
} from '../../src/utils/entry-fixability.js';

const MONTHLY = { loanType: 'MONTHLY', status: 'ACTIVE' };
const DAILY = { loanType: 'DAILY', status: 'ACTIVE' };

let clock = Date.UTC(2026, 9, 1, 10, 0, 0);

/** Builds a row recorded one minute after the previous one, unless `at` says otherwise. */
function row(id: string, overrides: Partial<EntryRow> & { at?: number } = {}): EntryRow {
  const { at, ...rest } = overrides;
  clock += 60_000;
  return {
    id,
    entryId: `entry-${id}`,
    correctedTransactionId: null,
    transactionType: 'DAILY_COLLECTION',
    approvalStatus: 'APPROVED',
    createdAt: new Date(at ?? clock),
    ...rest,
  };
}

describe('whyNotFixable — any loan', () => {
  it('allows an approved payment on an active loan', () => {
    const a = row('a');
    expect(whyNotFixable(DAILY, [a], a)).toBeNull();
  });

  it('allows it on a defaulted loan, which still accepts payments', () => {
    const a = row('a');
    expect(whyNotFixable({ loanType: 'DAILY', status: 'DEFAULTED' }, [a], a)).toBeNull();
  });

  it.each(['CLOSED', 'WRITTEN_OFF', 'CANCELLED'])('refuses on a %s loan', (status) => {
    const a = row('a');
    expect(whyNotFixable({ loanType: 'DAILY', status }, [a], a)).toMatch(/loan cannot be changed/);
  });

  it('refuses a correction row', () => {
    const a = row('a');
    const undo = row('undo', { correctedTransactionId: 'a' });
    expect(whyNotFixable(DAILY, [a, undo], undo)).toMatch(/is a correction/);
  });

  it('refuses an entry that has already been corrected', () => {
    const a = row('a');
    const undo = row('undo', { correctedTransactionId: 'a' });
    expect(whyNotFixable(DAILY, [a, undo], a)).toMatch(/already been corrected/);
  });

  it('refuses a pending entry: it should be approved or rejected instead', () => {
    const a = row('a', { approvalStatus: 'PENDING' });
    expect(whyNotFixable(DAILY, [a], a)).toMatch(/waiting for approval/);
  });

  it('refuses a rejected entry', () => {
    const a = row('a', { approvalStatus: 'REJECTED' });
    expect(whyNotFixable(DAILY, [a], a)).toMatch(/rejected/);
  });

  it.each([
    'DISBURSEMENT',
    'OPENING_BALANCE',
    'INTEREST_WAIVER',
    'PENALTY_WAIVER',
    'ADVANCE_INTEREST',
  ])('refuses a %s row', (transactionType) => {
    const a = row('a', { transactionType });
    expect(whyNotFixable(DAILY, [a], a)).toMatch(/cannot be changed here/);
  });
});

describe('whyNotFixable — daily loans', () => {
  it('allows an older entry even when later ones exist', () => {
    const first = row('first');
    const second = row('second');
    const third = row('third');
    const all = [first, second, third];

    expect(whyNotFixable(DAILY, all, first)).toBeNull();
    expect([...fixableIds(DAILY, all)].sort()).toEqual(['first', 'second', 'third']);
  });
});

describe('whyNotFixable — monthly loans', () => {
  const interest = (id: string, overrides: Partial<EntryRow> & { at?: number } = {}) =>
    row(id, { transactionType: 'INTEREST_PAYMENT', ...overrides });

  it('allows the latest entry only', () => {
    const disbursement = row('disb', { transactionType: 'DISBURSEMENT', entryId: null });
    const older = interest('older');
    const latest = interest('latest');
    const all = [disbursement, older, latest];

    expect(whyNotFixable(MONTHLY, all, latest)).toBeNull();
    expect(whyNotFixable(MONTHLY, all, older)).toMatch(/Only the latest entry/);
    expect([...fixableIds(MONTHLY, all)]).toEqual(['latest']);
  });

  it('treats every row of one payment as the same entry', () => {
    const older = interest('older');
    const at = clock + 60_000;
    // one payment split over two months plus the excess returned as principal
    const partA = interest('a', { entryId: 'pay', at });
    const partB = interest('b', { entryId: 'pay', at: at + 1 });
    const partC = row('c', { entryId: 'pay', transactionType: 'PRINCIPAL_RETURN', at: at + 2 });
    const all = [older, partA, partB, partC];

    expect(whyNotFixable(MONTHLY, all, partA)).toBeNull();
    expect(whyNotFixable(MONTHLY, all, partC)).toBeNull();
    expect(entryRowsOf(partA, all).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect([...fixableIds(MONTHLY, all)].sort()).toEqual(['a', 'b', 'c']);
  });

  it('a later pending entry or waiver also blocks an older entry', () => {
    const older = interest('older');
    const pending = interest('pending', { approvalStatus: 'PENDING' });
    expect(whyNotFixable(MONTHLY, [older, pending], older)).toMatch(/Only the latest entry/);

    const older2 = interest('older2');
    const waiver = row('waiver', { transactionType: 'INTEREST_WAIVER', entryId: null });
    expect(whyNotFixable(MONTHLY, [older2, waiver], older2)).toMatch(/Only the latest entry/);
  });

  it('later rows that no longer count do not block: rejected, corrected, or corrections', () => {
    const older = interest('older');
    const rejected = interest('rejected', { approvalStatus: 'REJECTED' });
    const removed = interest('removed');
    const undo = interest('undo', { correctedTransactionId: 'removed' });
    const all = [older, rejected, removed, undo];

    expect(whyNotFixable(MONTHLY, all, older)).toBeNull();
  });

  it('allows a single row recorded before entry ids existed', () => {
    const disbursement = row('disb', { transactionType: 'DISBURSEMENT', entryId: null });
    const legacy = row('legacy', { transactionType: 'PRINCIPAL_RETURN', entryId: null });
    expect(whyNotFixable(MONTHLY, [disbursement, legacy], legacy)).toBeNull();
  });

  it('refuses a pre-entry-id payment that was recorded in several parts', () => {
    const at = clock + 60_000;
    const partA = interest('a', { entryId: null, at });
    const partB = interest('b', { entryId: null, at: at + 1 });
    const all = [partA, partB];

    expect(whyNotFixable(MONTHLY, all, partB)).toMatch(/recorded in several parts/);
    expect(whyNotFixable(MONTHLY, all, partA)).toMatch(/recorded in several parts/);
    expect(fixableIds(MONTHLY, all).size).toBe(0);
  });

  it('does not mistake two separate pre-entry-id payments for parts of one', () => {
    const first = interest('first', { entryId: null });
    const second = interest('second', { entryId: null }); // a minute later
    expect(whyNotFixable(MONTHLY, [first, second], second)).toBeNull();
  });

  it('refuses when part of the payment is still pending approval', () => {
    const at = clock + 60_000;
    const approved = interest('approved', { entryId: 'pay', at });
    const pending = interest('pending', { entryId: 'pay', at: at + 1, approvalStatus: 'PENDING' });
    expect(whyNotFixable(MONTHLY, [approved, pending], approved)).toMatch(/waiting for approval/);
  });
});

describe('entryRowsOf', () => {
  it('leaves out parts that were rejected or already corrected', () => {
    const live = row('live', { entryId: 'pay' });
    const rejected = row('rejected', { entryId: 'pay', approvalStatus: 'REJECTED' });
    const corrected = row('corrected', { entryId: 'pay' });
    const undo = row('undo', { entryId: null, correctedTransactionId: 'corrected' });
    const all = [live, rejected, corrected, undo];

    expect(entryRowsOf(live, all).map((r) => r.id)).toEqual(['live']);
  });
});
