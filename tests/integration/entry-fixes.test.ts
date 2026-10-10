import { jest } from '@jest/globals';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import app from '../../src/app.js';
import prisma from '../helpers/prisma';
import appPrisma from '../../src/lib/prisma.js';
import { getBillingPrincipalForCycle } from '../../src/services/loans.service.js';
import { addDays, parseDate, today, toDateString } from '../../src/utils/date.js';

jest.setTimeout(120_000);

const request = supertest(app);

let tenantId: string;
let adminToken: string;
let tenant2AdminToken: string;
let collectorToken: string;
let collectorUserId: string;
let adminUserId: string;
let borrowerId: string;

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('fix-test-tenant', 'fix-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('fix-test-tenant', 'fix-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "penalties" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('fix-test-tenant', 'fix-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('fix-test-tenant', 'fix-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('fix-test-tenant', 'fix-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "fund_entries" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('fix-test-tenant', 'fix-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('fix-test-tenant', 'fix-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '7400%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '7400%'`;
  await prisma.tenant.deleteMany({
    where: { slug: { in: ['fix-test-tenant', 'fix-test-tenant-2'] } },
  });
}

beforeAll(async () => {
  await cleanup();

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Fix Test Tenant',
      slug: 'fix-test-tenant',
      ownerName: 'Owner',
      ownerPhone: '7400000000',
    },
  });
  tenantId = tenant.id;
  const tenant2 = await prisma.tenant.create({
    data: {
      name: 'Fix Test Tenant 2',
      slug: 'fix-test-tenant-2',
      ownerName: 'Owner 2',
      ownerPhone: '7400000099',
    },
  });

  const admin = await prisma.user.create({
    data: {
      tenantId,
      name: 'Fix Admin',
      phone: '7400000001',
      passwordHash: await bcrypt.hash('Admin@123', 4),
      role: 'ADMIN',
    },
  });
  adminUserId = admin.id;
  const collector = await prisma.user.create({
    data: {
      tenantId,
      name: 'Fix Collector',
      phone: '7400000002',
      passwordHash: await bcrypt.hash('Collector@123', 4),
      role: 'COLLECTOR',
    },
  });
  collectorUserId = collector.id;
  await prisma.user.create({
    data: {
      tenantId: tenant2.id,
      name: 'Fix Admin 2',
      phone: '7400000003',
      passwordHash: await bcrypt.hash('Admin@123', 4),
      role: 'ADMIN',
    },
  });

  const login = async (phone: string, password: string) =>
    (await request.post('/api/v1/auth/login').send({ phone, password })).body.data
      .access_token as string;
  adminToken = await login('7400000001', 'Admin@123');
  collectorToken = await login('7400000002', 'Collector@123');
  tenant2AdminToken = await login('7400000003', 'Admin@123');

  const borrower = await prisma.customer.create({
    data: { tenantId, fullName: 'Fix Borrower', phone: '7400100001', createdById: adminUserId },
  });
  borrowerId = borrower.id;

  await request
    .post('/api/v1/fund/entries')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ entry_type: 'INJECTION', amount: 5000000, entry_date: monthDate(-6) });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await appPrisma.$disconnect();
});

// ─── Helpers ──────────────────────────────────────────────────────────────

/** A date `offset` months from the server's current month. Day 5 exists in every month. */
function monthDate(offset: number, day = 5): string {
  const t = parseDate(today());
  return toDateString(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + offset, day)));
}

const TODAY = today();
/** The date a phone in India sends between midnight and 5:30 AM: one day ahead of the server. */
const PHONE_AHEAD = toDateString(addDays(parseDate(TODAY), 1));

type Row = {
  id: string;
  transactionType: string;
  amount: number;
  effectiveDate: string | null;
  approvalStatus: string;
  isCorrection: boolean;
  isCorrected: boolean;
  canFix?: boolean;
  correctedTransactionId: string | null;
};

function api(token = adminToken) {
  const auth = { Authorization: `Bearer ${token}` };
  return {
    get: (path: string) => request.get(`/api/v1${path}`).set(auth),
    post: (path: string, body: object = {}) => request.post(`/api/v1${path}`).set(auth).send(body),
    patch: (path: string, body: object = {}) =>
      request.patch(`/api/v1${path}`).set(auth).send(body),
  };
}

async function pay(loanId: string, type: string, amount: number, date: string, token = adminToken) {
  const res = await api(token).post('/transactions', {
    loan_id: loanId,
    transaction_type: type,
    amount,
    transaction_date: date,
  });
  expect(res.status).toBe(201);
  return res.body.data as Row[];
}

/** A Rs 1,00,000 loan at 2% a month, disbursed three months ago, with the two past months' interest paid. */
async function monthlyLoanWithHistory() {
  const res = await api().post('/loans', {
    loan_type: 'MONTHLY',
    borrower_id: borrowerId,
    principal_amount: 100000,
    interest_rate: 2,
    disbursement_date: monthDate(-3),
  });
  expect(res.status).toBe(201);
  const loanId = res.body.data.id as string;
  const history = await pay(loanId, 'INTEREST_PAYMENT', 4000, monthDate(-1, 6));
  expect(history).toHaveLength(2);
  return loanId;
}

async function dailyLoan() {
  const res = await api().post('/loans', {
    loan_type: 'DAILY',
    borrower_id: borrowerId,
    principal_amount: 10000,
    interest_rate: 5,
    disbursement_date: toDateString(addDays(parseDate(TODAY), -5)),
    term_days: 30,
  });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

const fix = (transactionId: string, body: object, token = adminToken) =>
  api(token).post(`/transactions/${transactionId}/fix`, body);
const remove = (transactionId: string, body: object = {}, token = adminToken) =>
  api(token).post(`/transactions/${transactionId}/remove`, body);

async function loanState(loanId: string) {
  const loan = (await api().get(`/loans/${loanId}`)).body.data;
  const status = (await api().get(`/loans/${loanId}/payment-status`)).body.data;
  const now = parseDate(TODAY);
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    remainingPrincipal: loan.remainingPrincipal,
    billingPrincipal: loan.billingPrincipal,
    monthlyInterestDue: loan.monthlyInterestDue,
    lastInterestPaidThrough: loan.lastInterestPaidThrough,
    nextDueDate: loan.nextDueDate,
    isOverdue: loan.isOverdue,
    totalInterestCollected: loan.totalInterestCollected,
    cycles: status.cycles,
    // what next month's interest will be charged on, which no endpoint reports yet
    nextMonthBilledOn: await getBillingPrincipalForCycle(
      appPrisma,
      tenantId,
      loanId,
      nextMonth.getUTCFullYear(),
      nextMonth.getUTCMonth() + 1,
    ),
  };
}

async function loanRows(loanId: string) {
  const res = await api().get(`/loans/${loanId}/transactions?limit=100`);
  expect(res.status).toBe(200);
  return res.body.data as Row[];
}

async function money() {
  const summary = (await api().get('/fund/summary')).body.data;
  const reconciliation = (await api().get('/fund/reconciliation')).body.data;
  expect(reconciliation.matches).toBe(true);
  return { cash: Number(summary.cashInHand), interest: Number(summary.totalInterestEarned) };
}

// ─── The reported case: interest entered as a principal return ────────────

describe.each([
  ['entered with the same date as the server', TODAY],
  ['entered from a phone whose date is a day ahead of the server', PHONE_AHEAD],
])('Monthly loan — Rs 2,000 interest entered as principal, then fixed (%s)', (_label, date) => {
  let controlId: string;
  let loanId: string;
  let wrong: Row;
  let before: { cash: number; interest: number };

  beforeAll(async () => {
    // The control loan is what "entered correctly the first time" looks like
    controlId = await monthlyLoanWithHistory();
    await pay(controlId, 'INTEREST_PAYMENT', 2000, date);

    loanId = await monthlyLoanWithHistory();
    before = await money();
    [wrong] = await pay(loanId, 'PRINCIPAL_RETURN', 2000, date);
  });

  it('the wrong entry reduces the principal and leaves the interest unpaid', async () => {
    const state = await loanState(loanId);
    expect(state.remainingPrincipal).toBe(98000);
    expect(state.monthlyInterestDue).toBe(1960);
    expect(state.cycles.at(-1).isSettled).toBe(false);
  });

  it('the entry is offered for fixing', async () => {
    const rows = await loanRows(loanId);
    expect(rows.find((r) => r.id === wrong.id)).toMatchObject({ canFix: true, isCorrected: false });

    const entry = await api().get(`/transactions/${wrong.id}/entry`);
    expect(entry.status).toBe(200);
    expect(entry.body.data).toMatchObject({
      loanId,
      loanType: 'MONTHLY',
      transactionType: 'PRINCIPAL_RETURN',
      amount: 2000,
      transactionDate: date,
      canFix: true,
      reason: null,
    });
  });

  it('fixing it undoes the principal return and records the interest → 200', async () => {
    const res = await fix(wrong.id, {
      loan_id: loanId,
      transaction_type: 'INTEREST_PAYMENT',
      amount: 2000,
      transaction_date: date,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.removed).toHaveLength(1);
    expect(res.body.data.removed[0]).toMatchObject({
      transactionType: 'PRINCIPAL_RETURN',
      amount: -2000,
      transactionDate: date,
      isCorrection: true,
      correctedTransactionId: wrong.id,
    });
    expect(res.body.data.recorded).toHaveLength(1);
    expect(res.body.data.recorded[0]).toMatchObject({
      transactionType: 'INTEREST_PAYMENT',
      amount: 2000,
      approvalStatus: 'APPROVED',
    });
  });

  it('the loan is exactly as if the interest had been entered correctly', async () => {
    expect(await loanState(loanId)).toEqual(await loanState(controlId));
  });

  it('next month will be charged on the full principal', async () => {
    const state = await loanState(loanId);
    expect(state.remainingPrincipal).toBe(100000);
    expect(state.nextMonthBilledOn).toBe(100000);
    expect(state.cycles.at(-1)).toMatchObject({
      billingPrincipalForCycle: 100000,
      interestDue: 2000,
      interestPaid: 2000,
      isSettled: true,
    });
  });

  it('the return and its reversal carry the same date, so they cancel for every month', async () => {
    const rows: Array<{ amount_returned: unknown; return_date: unknown }> = await prisma.$queryRaw`
      SELECT amount_returned, return_date FROM principal_returns WHERE loan_id = ${loanId}::uuid ORDER BY created_at`;
    expect(rows.map((r) => Number(r.amount_returned))).toEqual([2000, -2000]);
    expect(toDateString(rows[0]!.return_date as Date)).toBe(date);
    expect(toDateString(rows[1]!.return_date as Date)).toBe(date);
  });

  it('cash is up by the Rs 2,000 received and it is counted as interest', async () => {
    const after = await money();
    expect(after.cash - before.cash).toBeCloseTo(2000, 2);
    expect(after.interest - before.interest).toBeCloseTo(2000, 2);
  });

  it('the history keeps the wrong entry, marked corrected, and offers the new one for fixing', async () => {
    const rows = await loanRows(loanId);
    expect(rows.find((r) => r.id === wrong.id)).toMatchObject({ isCorrected: true, canFix: false });

    const correction = rows.find((r) => r.correctedTransactionId === wrong.id)!;
    expect(correction).toMatchObject({ isCorrection: true, canFix: false, amount: -2000 });

    const live = rows.filter((r) => r.canFix);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ transactionType: 'INTEREST_PAYMENT', amount: 2000 });
  });

  it('an entry cannot be fixed twice → 400', async () => {
    const res = await fix(wrong.id, {
      loan_id: loanId,
      transaction_type: 'INTEREST_PAYMENT',
      amount: 2000,
      transaction_date: date,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/already been corrected/);
  });
});

// ─── Other monthly corrections ────────────────────────────────────────────

describe('Monthly loan — other corrections', () => {
  it('wrong amount: Rs 2,500 entered for Rs 2,000 interest; the auto-split principal is undone too', async () => {
    const loanId = await monthlyLoanWithHistory();
    const entered = await pay(loanId, 'INTEREST_PAYMENT', 2500, TODAY);
    expect(entered.map((t) => `${t.transactionType}:${t.amount}`)).toEqual([
      'INTEREST_PAYMENT:2000',
      'PRINCIPAL_RETURN:500',
    ]);
    expect((await loanState(loanId)).remainingPrincipal).toBe(99500);

    const entry = (await api().get(`/transactions/${entered[1]!.id}/entry`)).body.data;
    expect(entry).toMatchObject({
      transactionType: 'INTEREST_PAYMENT',
      amount: 2500,
      canFix: true,
    });
    expect(entry.rows).toHaveLength(2);

    // fixing through either row acts on the whole payment
    const res = await fix(entered[1]!.id, {
      loan_id: loanId,
      transaction_type: 'INTEREST_PAYMENT',
      amount: 2000,
      transaction_date: TODAY,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.removed).toHaveLength(2);
    expect(res.body.data.recorded).toHaveLength(1);

    const state = await loanState(loanId);
    expect(state.remainingPrincipal).toBe(100000);
    expect(state.nextMonthBilledOn).toBe(100000);
    expect(state.cycles.at(-1)).toMatchObject({ interestPaid: 2000, isSettled: true });
  });

  it('several months paid at once, fixed to a smaller amount', async () => {
    const res = await api().post('/loans', {
      loan_type: 'MONTHLY',
      borrower_id: borrowerId,
      principal_amount: 100000,
      interest_rate: 2,
      disbursement_date: monthDate(-3),
    });
    const loanId = res.body.data.id as string;
    const entered = await pay(loanId, 'INTEREST_PAYMENT', 6000, TODAY);
    expect(entered).toHaveLength(3);

    const fixed = await fix(entered[0]!.id, {
      loan_id: loanId,
      transaction_type: 'INTEREST_PAYMENT',
      amount: 4000,
      transaction_date: TODAY,
    });
    expect(fixed.status).toBe(200);
    expect(fixed.body.data.removed).toHaveLength(3);
    expect(fixed.body.data.recorded).toHaveLength(2);

    const state = await loanState(loanId);
    expect(state.cycles.map((c: { isSettled: boolean }) => c.isSettled)).toEqual([
      true,
      true,
      false,
    ]);
    expect(state.totalInterestCollected).toBe(4000);
  });

  it('wrong type the other way: interest entered, should have been a principal return', async () => {
    const loanId = await monthlyLoanWithHistory();
    const [entered] = await pay(loanId, 'INTEREST_PAYMENT', 2000, TODAY);

    const res = await fix(entered!.id, {
      loan_id: loanId,
      transaction_type: 'PRINCIPAL_RETURN',
      amount: 2000,
      transaction_date: TODAY,
    });
    expect(res.status).toBe(200);

    const state = await loanState(loanId);
    expect(state.remainingPrincipal).toBe(98000);
    expect(state.cycles.at(-1)).toMatchObject({ interestPaid: 0, isSettled: false });
    expect(state.lastInterestPaidThrough).toBe(monthDate(-1));
  });

  it('wrong loan: interest entered on one loan is moved to another', async () => {
    const wrongLoan = await monthlyLoanWithHistory();
    const rightLoan = await monthlyLoanWithHistory();
    const [entered] = await pay(wrongLoan, 'INTEREST_PAYMENT', 2000, TODAY);
    const before = await money();

    const res = await fix(entered!.id, {
      loan_id: rightLoan,
      transaction_type: 'INTEREST_PAYMENT',
      amount: 2000,
      transaction_date: TODAY,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.recorded[0].loanId).toBe(rightLoan);

    expect((await loanState(wrongLoan)).cycles.at(-1)).toMatchObject({
      interestPaid: 0,
      isSettled: false,
    });
    expect((await loanState(rightLoan)).cycles.at(-1)).toMatchObject({
      interestPaid: 2000,
      isSettled: true,
    });

    const after = await money();
    expect(after.cash).toBeCloseTo(before.cash, 2);
    expect(after.interest).toBeCloseTo(before.interest, 2);
  });

  it('remove: an interest payment that should not exist; the month is unpaid again', async () => {
    const loanId = await monthlyLoanWithHistory();
    const untouched = await loanState(loanId);
    const before = await money();
    const [entered] = await pay(loanId, 'INTEREST_PAYMENT', 2000, TODAY);

    const res = await remove(entered!.id, { reason: 'Recorded twice' });
    expect(res.status).toBe(200);
    expect(res.body.data.removed).toHaveLength(1);
    expect(res.body.data.removed[0].notes).toBe('Removed, entered by mistake: Recorded twice');
    expect(res.body.data.recorded).toEqual([]);

    expect(await loanState(loanId)).toEqual(untouched);
    const after = await money();
    expect(after.cash).toBeCloseTo(before.cash, 2);
    expect(after.interest).toBeCloseTo(before.interest, 2);
  });

  it('only the latest entry can be changed; an older one becomes fixable once the later one is removed', async () => {
    const loanId = await monthlyLoanWithHistory();
    const [older] = await pay(loanId, 'INTEREST_PAYMENT', 2000, TODAY);
    const [latest] = await pay(loanId, 'PRINCIPAL_RETURN', 5000, TODAY);

    const blocked = await remove(older!.id);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toMatch(/Only the latest entry/);

    const entry = (await api().get(`/transactions/${older!.id}/entry`)).body.data;
    expect(entry.canFix).toBe(false);
    expect(entry.reason).toMatch(/Only the latest entry/);

    let rows = await loanRows(loanId);
    expect(rows.find((r) => r.id === older!.id)!.canFix).toBe(false);
    expect(rows.find((r) => r.id === latest!.id)!.canFix).toBe(true);
    // the two history rows from before are older still
    expect(rows.filter((r) => r.canFix)).toHaveLength(1);

    expect((await remove(latest!.id)).status).toBe(200);

    rows = await loanRows(loanId);
    expect(rows.find((r) => r.id === older!.id)!.canFix).toBe(true);
    expect((await remove(older!.id)).status).toBe(200);
  });

  it('a principal return entered before entry ids existed can be fixed (single part)', async () => {
    const controlId = await monthlyLoanWithHistory();
    await pay(controlId, 'INTEREST_PAYMENT', 2000, TODAY);

    const loanId = await monthlyLoanWithHistory();
    const [wrong] = await pay(loanId, 'PRINCIPAL_RETURN', 2000, TODAY);
    // what every row recorded before this change looks like: no entry id, and
    // (unlike in this test) the earlier payments were made long before this one
    await prisma.$executeRaw`UPDATE transactions SET entry_id = NULL WHERE loan_id = ${loanId}::uuid`;
    await prisma.$executeRaw`
      UPDATE transactions SET created_at = created_at - INTERVAL '1 day'
      WHERE loan_id = ${loanId}::uuid AND id <> ${wrong!.id}::uuid`;

    const res = await fix(wrong!.id, {
      loan_id: loanId,
      transaction_type: 'INTEREST_PAYMENT',
      amount: 2000,
      transaction_date: TODAY,
    });
    expect(res.status).toBe(200);
    expect(await loanState(loanId)).toEqual(await loanState(controlId));
  });

  it('a multi-part payment entered before entry ids existed is refused', async () => {
    const loanId = await monthlyLoanWithHistory();
    const entered = await pay(loanId, 'INTEREST_PAYMENT', 2500, TODAY);
    expect(entered).toHaveLength(2);
    await prisma.$executeRaw`UPDATE transactions SET entry_id = NULL WHERE loan_id = ${loanId}::uuid`;
    const before = await loanState(loanId);

    const entry = (await api().get(`/transactions/${entered[0]!.id}/entry`)).body.data;
    expect(entry.canFix).toBe(false);
    expect(entry.reason).toMatch(/recorded in several parts/);

    const res = await remove(entered[1]!.id);
    expect(res.status).toBe(400);
    expect(await loanState(loanId)).toEqual(before);
  });
});

// ─── The billing repair itself ────────────────────────────────────────────

describe('Monthly billing principal', () => {
  it('a principal return still lowers the interest of later months only', async () => {
    const loanId = await monthlyLoanWithHistory();
    // returned during last month: last month was billed on the full amount, this month is not
    await pay(loanId, 'PRINCIPAL_RETURN', 20000, monthDate(-1, 20));

    const state = await loanState(loanId);
    const [twoMonthsAgo, lastMonth, thisMonth] = state.cycles;
    expect(twoMonthsAgo.billingPrincipalForCycle).toBe(100000);
    expect(lastMonth.billingPrincipalForCycle).toBe(100000);
    expect(thisMonth).toMatchObject({ billingPrincipalForCycle: 80000, interestDue: 1600 });
    expect(state.nextMonthBilledOn).toBe(80000);
  });

  it('the older reversal endpoint, used a month later, no longer leaves this month billed on the reduced principal', async () => {
    const loanId = await monthlyLoanWithHistory();
    const [wrong] = await pay(loanId, 'PRINCIPAL_RETURN', 2000, monthDate(-1, 20));
    expect((await loanState(loanId)).cycles.at(-1).billingPrincipalForCycle).toBe(98000);

    const res = await api().post('/transactions', {
      loan_id: loanId,
      transaction_type: 'PRINCIPAL_RETURN',
      amount: -2000,
      transaction_date: TODAY,
      corrected_transaction_id: wrong!.id,
      notes: 'Entered by mistake',
    });
    expect(res.status).toBe(201);

    const state = await loanState(loanId);
    expect(state.remainingPrincipal).toBe(100000);
    expect(
      state.cycles.map((c: { billingPrincipalForCycle: number }) => c.billingPrincipalForCycle),
    ).toEqual([100000, 100000, 100000]);
    expect(state.nextMonthBilledOn).toBe(100000);
  });
});

// ─── Daily loans ──────────────────────────────────────────────────────────

describe('Daily loan corrections', () => {
  const total = async (loanId: string) =>
    (await api().get(`/loans/${loanId}`)).body.data.totalCollected;

  it('wrong amount on an older entry: Rs 5,000 entered for Rs 500', async () => {
    const loanId = await dailyLoan();
    const [wrong] = await pay(
      loanId,
      'DAILY_COLLECTION',
      5000,
      toDateString(addDays(parseDate(TODAY), -2)),
    );
    await pay(loanId, 'DAILY_COLLECTION', 350, toDateString(addDays(parseDate(TODAY), -1)));
    const before = await money();

    const res = await fix(wrong!.id, {
      loan_id: loanId,
      transaction_type: 'DAILY_COLLECTION',
      amount: 500,
      transaction_date: toDateString(addDays(parseDate(TODAY), -2)),
    });
    expect(res.status).toBe(200);
    expect(await total(loanId)).toBe(850);

    const after = await money();
    expect(after.cash - before.cash).toBeCloseTo(-4500, 2);

    const rows = await loanRows(loanId);
    expect(rows.find((r) => r.id === wrong!.id)).toMatchObject({
      isCorrected: true,
      canFix: false,
    });
    // both remaining collections can still be changed: daily loans are not latest-only
    expect(rows.filter((r) => r.canFix)).toHaveLength(2);
  });

  it('wrong loan: a collection is moved to the loan it belongs to', async () => {
    const wrongLoan = await dailyLoan();
    const rightLoan = await dailyLoan();
    const [entered] = await pay(wrongLoan, 'DAILY_COLLECTION', 350, TODAY);
    const before = await money();

    const res = await fix(entered!.id, {
      loan_id: rightLoan,
      transaction_type: 'DAILY_COLLECTION',
      amount: 350,
      transaction_date: TODAY,
    });
    expect(res.status).toBe(200);
    expect(await total(wrongLoan)).toBe(0);
    expect(await total(rightLoan)).toBe(350);
    expect((await money()).cash).toBeCloseTo(before.cash, 2);
  });

  it('remove: the loan shows as missed today again', async () => {
    const loanId = await dailyLoan();
    const missed = async () =>
      (
        (await api().get('/loans/missed-today')).body.data.missedToday as Array<{ loanId: string }>
      ).some((l) => l.loanId === loanId);
    expect(await missed()).toBe(true);

    const [entered] = await pay(loanId, 'DAILY_COLLECTION', 350, TODAY);
    expect(await missed()).toBe(false);

    expect((await remove(entered!.id)).status).toBe(200);
    expect(await total(loanId)).toBe(0);
    expect(await missed()).toBe(true);

    const dashboard = (await api().get('/dashboard/today')).body.data;
    expect(dashboard.missedToday.some((l: { loanId: string }) => l.loanId === loanId)).toBe(true);
  });

  it("a collector's collection fixed by the admin stays credited to the collector, at the corrected amount", async () => {
    const loanId = await dailyLoan();
    const summary = async () => {
      const res = await api().get(`/reports/collector-summary?from=${TODAY}&to=${TODAY}`);
      const mine = res.body.data.find((c: { userId: string }) => c.userId === collectorUserId);
      return { amount: Number(mine.totalAmount), count: mine.totalTransactions as number };
    };
    const before = await summary();

    const [pending] = await pay(loanId, 'DAILY_COLLECTION', 700, TODAY, collectorToken);
    expect(pending!.approvalStatus).toBe('PENDING');

    const tooEarly = await fix(pending!.id, {
      loan_id: loanId,
      transaction_type: 'DAILY_COLLECTION',
      amount: 500,
      transaction_date: TODAY,
    });
    expect(tooEarly.status).toBe(400);
    expect(tooEarly.body.error.message).toMatch(/waiting for approval/);

    expect((await api().patch(`/transactions/${pending!.id}/approve`)).status).toBe(200);

    const res = await fix(pending!.id, {
      loan_id: loanId,
      transaction_type: 'DAILY_COLLECTION',
      amount: 500,
      transaction_date: TODAY,
    });
    expect(res.status).toBe(200);
    expect(await total(loanId)).toBe(500);

    const list = (await api().get(`/transactions?loan_id=${loanId}&limit=100`)).body.data as Array<{
      id: string;
      amount: number;
      collectedById: string;
      approvedById: string;
      isCorrected: boolean;
    }>;
    const replacement = list.find((t) => t.id === res.body.data.recorded[0].id)!;
    expect(replacement).toMatchObject({
      amount: 500,
      collectedById: collectorUserId,
      approvedById: adminUserId,
    });
    expect(list.find((t) => t.id === pending!.id)!.isCorrected).toBe(true);

    const after = await summary();
    expect(after.amount - before.amount).toBeCloseTo(500, 2);
    expect(after.count - before.count).toBe(1);
  });

  it('nothing changes when the replacement is refused', async () => {
    const loanId = await dailyLoan();
    const [entered] = await pay(loanId, 'DAILY_COLLECTION', 350, TODAY);
    const before = await money();

    // an interest payment cannot be recorded on a daily loan
    const res = await fix(entered!.id, {
      loan_id: loanId,
      transaction_type: 'INTEREST_PAYMENT',
      amount: 350,
      transaction_date: TODAY,
    });
    expect(res.status).toBe(400);

    expect(await total(loanId)).toBe(350);
    const rows = await loanRows(loanId);
    expect(rows.some((r) => r.isCorrection)).toBe(false);
    expect(rows.find((r) => r.id === entered!.id)).toMatchObject({
      isCorrected: false,
      canFix: true,
    });
    expect((await money()).cash).toBeCloseTo(before.cash, 2);
  });

  it('entries on a closed loan cannot be changed → 400', async () => {
    const loanId = await dailyLoan();
    const [entered] = await pay(loanId, 'DAILY_COLLECTION', 10500, TODAY);
    expect((await api().patch(`/loans/${loanId}/close`)).status).toBe(200);

    const res = await remove(entered!.id);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/closed loan cannot be changed/);
    expect((await loanRows(loanId)).every((r) => r.canFix === false)).toBe(true);
  });

  it('the disbursement is not a payment and cannot be changed → 400', async () => {
    const loanId = await dailyLoan();
    const disbursement = (await loanRows(loanId)).find(
      (r) => r.transactionType === 'DISBURSEMENT',
    )!;
    expect(disbursement.canFix).toBe(false);
    expect((await remove(disbursement.id)).status).toBe(400);
  });
});

// ─── Access and validation ────────────────────────────────────────────────

describe('Fix and remove — access and validation', () => {
  let loanId: string;
  let entered: Row;

  beforeAll(async () => {
    loanId = await dailyLoan();
    [entered] = (await pay(loanId, 'DAILY_COLLECTION', 350, TODAY)) as [Row];
  });

  const replacement = () => ({
    loan_id: loanId,
    transaction_type: 'DAILY_COLLECTION',
    amount: 300,
    transaction_date: TODAY,
  });

  it('collector cannot fix, remove or look up an entry → 403', async () => {
    expect((await fix(entered.id, replacement(), collectorToken)).status).toBe(403);
    expect((await remove(entered.id, {}, collectorToken)).status).toBe(403);
    expect((await api(collectorToken).get(`/transactions/${entered.id}/entry`)).status).toBe(403);
  });

  it('another tenant gets 404', async () => {
    expect((await fix(entered.id, replacement(), tenant2AdminToken)).status).toBe(404);
    expect((await remove(entered.id, {}, tenant2AdminToken)).status).toBe(404);
    expect((await api(tenant2AdminToken).get(`/transactions/${entered.id}/entry`)).status).toBe(
      404,
    );
  });

  it('unknown transaction → 404', async () => {
    const id = '00000000-0000-0000-0000-000000000000';
    expect((await fix(id, replacement())).status).toBe(404);
    expect((await remove(id)).status).toBe(404);
  });

  it('the replacement must be valid → 400', async () => {
    expect((await fix(entered.id, { ...replacement(), amount: -300 })).status).toBe(400);
    expect((await fix(entered.id, { ...replacement(), amount: 0 })).status).toBe(400);
    expect(
      (await fix(entered.id, { ...replacement(), transaction_date: '11-10-2026' })).status,
    ).toBe(400);
    expect(
      (await fix(entered.id, { transaction_type: 'DAILY_COLLECTION', amount: 300 })).status,
    ).toBe(400);
  });

  it('the replacement cannot go to a loan in another tenant → 404, nothing undone', async () => {
    const res = await fix(entered.id, {
      ...replacement(),
      loan_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(res.status).toBe(404);
    expect((await api().get(`/loans/${loanId}`)).body.data.totalCollected).toBe(350);
  });

  it('requires authentication → 401', async () => {
    expect((await request.post(`/api/v1/transactions/${entered.id}/remove`).send({})).status).toBe(
      401,
    );
  });

  it('after all the refusals the entry is untouched and still fixable', async () => {
    const row = (await loanRows(loanId)).find((r) => r.id === entered.id)!;
    expect(row).toMatchObject({ amount: 350, isCorrected: false, canFix: true });
  });
});
