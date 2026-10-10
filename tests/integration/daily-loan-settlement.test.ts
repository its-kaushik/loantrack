import { jest } from '@jest/globals';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import app from '../../src/app.js';
import prisma from '../helpers/prisma';
import { today } from '../../src/utils/date.js';

jest.setTimeout(60_000);

const request = supertest(app);

let tenantId: string;
let tenantId2: string;
let adminAccessToken: string;
let tenant2AdminAccessToken: string;
let collectorAccessToken: string;
let adminUserId: string;
let borrowerId: string;

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('settle-test-tenant', 'settle-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('settle-test-tenant', 'settle-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "penalties" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('settle-test-tenant', 'settle-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('settle-test-tenant', 'settle-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('settle-test-tenant', 'settle-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "fund_entries" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('settle-test-tenant', 'settle-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('settle-test-tenant', 'settle-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '7300%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '7300%'`;
  await prisma.tenant.deleteMany({
    where: { slug: { in: ['settle-test-tenant', 'settle-test-tenant-2'] } },
  });
}

beforeAll(async () => {
  await cleanup();

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Settle Test Tenant',
      slug: 'settle-test-tenant',
      ownerName: 'Owner',
      ownerPhone: '7300000000',
    },
  });
  tenantId = tenant.id;

  const tenant2 = await prisma.tenant.create({
    data: {
      name: 'Settle Test Tenant 2',
      slug: 'settle-test-tenant-2',
      ownerName: 'Owner 2',
      ownerPhone: '7300000099',
    },
  });
  tenantId2 = tenant2.id;

  const admin = await prisma.user.create({
    data: {
      tenantId,
      name: 'Settle Test Admin',
      phone: '7300000001',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });
  adminUserId = admin.id;

  await prisma.user.create({
    data: {
      tenantId,
      name: 'Settle Test Collector',
      phone: '7300000002',
      passwordHash: await bcrypt.hash('Collector@123', 12),
      role: 'COLLECTOR',
    },
  });

  await prisma.user.create({
    data: {
      tenantId: tenantId2,
      name: 'Tenant2 Settle Admin',
      phone: '7300000003',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });

  const adminLogin = await request
    .post('/api/v1/auth/login')
    .send({ phone: '7300000001', password: 'Admin@123' });
  adminAccessToken = adminLogin.body.data.access_token;

  const collectorLogin = await request
    .post('/api/v1/auth/login')
    .send({ phone: '7300000002', password: 'Collector@123' });
  collectorAccessToken = collectorLogin.body.data.access_token;

  const tenant2AdminLogin = await request
    .post('/api/v1/auth/login')
    .send({ phone: '7300000003', password: 'Admin@123' });
  tenant2AdminAccessToken = tenant2AdminLogin.body.data.access_token;

  const borrower = await prisma.customer.create({
    data: { tenantId, fullName: 'Settle Borrower', phone: '7300100001', createdById: adminUserId },
  });
  borrowerId = borrower.id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// ─── Helpers ──────────────────────────────────────────────────────────────

async function createDailyLoan(overrides: Record<string, unknown> = {}) {
  const res = await request
    .post('/api/v1/loans')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'DAILY',
      borrower_id: borrowerId,
      principal_amount: 10000,
      interest_rate: 5,
      disbursement_date: '2026-09-01',
      term_days: 30,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; totalRepaymentAmount: number };
}

async function collect(loanId: string, amount: number, token = adminAccessToken) {
  const res = await request
    .post('/api/v1/transactions')
    .set('Authorization', `Bearer ${token}`)
    .send({
      loan_id: loanId,
      transaction_type: 'DAILY_COLLECTION',
      amount,
      transaction_date: '2026-10-01',
    });
  expect(res.status).toBe(201);
  return res.body.data[0] as { id: string; approvalStatus: string };
}

function settle(loanId: string, body: Record<string, unknown>, token = adminAccessToken) {
  return request
    .patch(`/api/v1/loans/${loanId}/settle`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

async function getLoan(loanId: string) {
  const res = await request
    .get(`/api/v1/loans/${loanId}`)
    .set('Authorization', `Bearer ${adminAccessToken}`);
  expect(res.status).toBe(200);
  return res.body.data;
}

async function getFundSummary() {
  const res = await request
    .get('/api/v1/fund/summary')
    .set('Authorization', `Bearer ${adminAccessToken}`);
  expect(res.status).toBe(200);
  return res.body.data;
}

// ─── Early repayment: Rs 50,000 for 120 days at 5%, repaid with one month's interest ───
// This block runs first, while its loan is the only one in the tenant, so the
// tenant-wide money figures below are exact.

describe('PATCH /api/v1/loans/:id/settle — early repayment', () => {
  let loanId: string;

  beforeAll(async () => {
    await request
      .post('/api/v1/fund/entries')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ entry_type: 'INJECTION', amount: 100000, entry_date: '2026-09-01' });

    const loan = await createDailyLoan({ principal_amount: 50000, term_days: 120 });
    loanId = loan.id;
    expect(loan.totalRepaymentAmount).toBe(60000);

    await collect(loanId, 52500);
  });

  it('before settling: the loan cannot be closed and Rs 7,500 is still shown as due', async () => {
    const closeRes = await request
      .patch(`/api/v1/loans/${loanId}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(closeRes.status).toBe(400);

    const loan = await getLoan(loanId);
    expect(loan.status).toBe('ACTIVE');
    expect(loan.totalRemaining).toBe(7500);
    expect(loan.isSettled).toBe(false);
    expect(loan.originalTotalRepaymentAmount).toBeNull();

    // Interest is recognised at the scheduled ratio until the loan is settled
    const summary = await getFundSummary();
    expect(summary.totalInterestEarned).toBe('8750.00');
    expect(summary.moneyDeployed).toBe('6250.00');
    expect(summary.cashInHand).toBe('102500.00');
  });

  it('settles at the amount collected and closes the loan → 200', async () => {
    const res = await settle(loanId, {
      settlement_amount: 52500,
      note: 'Repaid in one month, charged one month of interest',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CLOSED');
    expect(res.body.data.isSettled).toBe(true);
    expect(res.body.data.totalRepaymentAmount).toBe(52500);
    expect(res.body.data.originalTotalRepaymentAmount).toBe(60000);
    expect(res.body.data.settlementNote).toBe('Repaid in one month, charged one month of interest');
    expect(res.body.data.totalCollected).toBe(52500);
    expect(res.body.data.totalRemaining).toBe(0);
    expect(res.body.data.daysRemaining).toBe(0);
    expect(res.body.data.isBasePaid).toBe(true);
    expect(res.body.data.isOverdue).toBe(false);
    expect(res.body.data.closureDate).toBe(today());
    expect(res.body.data.closedById).toBe(adminUserId);
    // The schedule itself is left as it was
    expect(res.body.data.principalAmount).toBe(50000);
    expect(res.body.data.termDays).toBe(120);
    expect(res.body.data.dailyPaymentAmount).toBe(500);
  });

  it('GET /loans/:id returns the settled figures', async () => {
    const loan = await getLoan(loanId);
    expect(loan.status).toBe('CLOSED');
    expect(loan.isSettled).toBe(true);
    expect(loan.totalRepaymentAmount).toBe(52500);
    expect(loan.originalTotalRepaymentAmount).toBe(60000);
    expect(loan.totalRemaining).toBe(0);
  });

  it('records no money: transactions are exactly the disbursement and the real collection', async () => {
    const res = await request
      .get(`/api/v1/loans/${loanId}/transactions`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    const txns = res.body.data as Array<{ transactionType: string; amount: number }>;
    expect(txns).toHaveLength(2);
    expect(txns.map((t) => `${t.transactionType}:${t.amount}`).sort()).toEqual([
      'DAILY_COLLECTION:52500',
      'DISBURSEMENT:50000',
    ]);
  });

  it('fund summary shows only the interest actually received, and cash is unchanged', async () => {
    const summary = await getFundSummary();
    expect(summary.totalInterestEarned).toBe('2500.00');
    expect(summary.netProfit).toBe('2500.00');
    expect(summary.moneyDeployed).toBe('0.00');
    expect(summary.moneyLostToDefaults).toBe('0.00');
    expect(summary.revenueForgone).toBe('0.00');
    // 100,000 injected − 50,000 lent + 52,500 collected
    expect(summary.cashInHand).toBe('102500.00');
  });

  it('cash in hand still reconciles', async () => {
    const res = await request
      .get('/api/v1/fund/reconciliation')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.matches).toBe(true);
    expect(res.body.data.queryResult).toBe('102500.00');
  });

  it('profit & loss for the period shows Rs 2,500 interest on Rs 52,500 received', async () => {
    const res = await request
      .get('/api/v1/reports/profit-loss?from=2026-09-01&to=2026-10-31')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalInterestEarned).toBe('2500.00');
    expect(res.body.data.totalReceived).toBe('52500.00');
    expect(res.body.data.dailyDisbursed).toBe('50000.00');
    expect(res.body.data.netProfit).toBe('2500.00');
  });

  it('loan book shows nothing outstanding and Rs 2,500 interest earned', async () => {
    const res = await request
      .get('/api/v1/reports/loan-book')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    const row = res.body.data.find((l: { loanId: string }) => l.loanId === loanId);
    expect(row.status).toBe('CLOSED');
    expect(row.outstandingAmount).toBe('0.00');
    expect(row.interestEarned).toBe('2500.00');
  });

  it('a settled loan cannot be settled again → 400', async () => {
    const res = await settle(loanId, { settlement_amount: 52500 });
    expect(res.status).toBe(400);
  });

  it('a settled loan accepts no further collections → 400', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 500,
        transaction_date: '2026-10-02',
      });
    expect(res.status).toBe(400);
  });
});

// ─── Amount rules ─────────────────────────────────────────────────────────

describe('PATCH /api/v1/loans/:id/settle — amount rules', () => {
  it('rejects settling below principal → 400, loan untouched', async () => {
    const loan = await createDailyLoan();
    await collect(loan.id, 9000);

    const res = await settle(loan.id, { settlement_amount: 9000 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/less than the principal/);

    const after = await getLoan(loan.id);
    expect(after.status).toBe('ACTIVE');
    expect(after.totalRepaymentAmount).toBe(10500);
    expect(after.isSettled).toBe(false);
  });

  it('allows settling at exactly the principal, with zero interest → 200', async () => {
    const loan = await createDailyLoan();
    await collect(loan.id, 10000);

    const res = await settle(loan.id, { settlement_amount: 10000 });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CLOSED');
    expect(res.body.data.totalRepaymentAmount).toBe(10000);
    expect(res.body.data.originalTotalRepaymentAmount).toBe(10500);
    expect(res.body.data.settlementNote).toBeNull();
  });

  it('rejects a fully repaid loan → 400 (close it instead)', async () => {
    const loan = await createDailyLoan();
    await collect(loan.id, 10500);

    const res = await settle(loan.id, { settlement_amount: 10500 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/fully repaid/);

    const closeRes = await request
      .patch(`/api/v1/loans/${loan.id}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.isSettled).toBe(false);
    expect(closeRes.body.data.originalTotalRepaymentAmount).toBeNull();
  });

  it('rejects an amount that does not match what was collected → 409, loan untouched', async () => {
    const loan = await createDailyLoan();
    await collect(loan.id, 10200);

    const res = await settle(loan.id, { settlement_amount: 10300 });
    expect(res.status).toBe(409);

    const after = await getLoan(loan.id);
    expect(after.status).toBe('ACTIVE');
    expect(after.totalRepaymentAmount).toBe(10500);

    const retry = await settle(loan.id, { settlement_amount: 10200 });
    expect(retry.status).toBe(200);
    expect(retry.body.data.totalRepaymentAmount).toBe(10200);
  });

  it('handles paise correctly', async () => {
    const loan = await createDailyLoan();
    await collect(loan.id, 10000);
    await collect(loan.id, 123.45);

    const res = await settle(loan.id, { settlement_amount: 10123.45 });
    expect(res.status).toBe(200);
    expect(res.body.data.totalRepaymentAmount).toBe(10123.45);
    expect(res.body.data.totalRemaining).toBe(0);
  });

  it('requires settlement_amount → 400', async () => {
    const loan = await createDailyLoan();
    await collect(loan.id, 10200);

    const missing = await settle(loan.id, {});
    expect(missing.status).toBe(400);

    const negative = await settle(loan.id, { settlement_amount: -10200 });
    expect(negative.status).toBe(400);
  });
});

// ─── Things that must be resolved first ───────────────────────────────────

describe('PATCH /api/v1/loans/:id/settle — blockers', () => {
  it('rejects while a collector collection is pending; allowed once it is rejected', async () => {
    const loan = await createDailyLoan();
    await collect(loan.id, 10200);

    const pending = await collect(loan.id, 100, collectorAccessToken);
    expect(pending.approvalStatus).toBe('PENDING');

    const blocked = await settle(loan.id, { settlement_amount: 10200 });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toMatch(/pending transactions/);

    const rejectRes = await request
      .patch(`/api/v1/transactions/${pending.id}/reject`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ rejection_reason: 'Not received' });
    expect(rejectRes.status).toBe(200);

    const res = await settle(loan.id, { settlement_amount: 10200 });
    expect(res.status).toBe(200);
    expect(res.body.data.totalRepaymentAmount).toBe(10200);
  });

  it('counts an approved collector collection towards the settlement', async () => {
    const loan = await createDailyLoan();
    await collect(loan.id, 10000);
    const pending = await collect(loan.id, 300, collectorAccessToken);

    const approveRes = await request
      .patch(`/api/v1/transactions/${pending.id}/approve`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(approveRes.status).toBe(200);

    // The figure the admin saw before approval no longer matches
    const stale = await settle(loan.id, { settlement_amount: 10000 });
    expect(stale.status).toBe(409);

    const res = await settle(loan.id, { settlement_amount: 10300 });
    expect(res.status).toBe(200);
  });

  it('rejects while a penalty is unpaid; allowed once it is waived (late settlement)', async () => {
    // Disbursed long ago, so the loan is past its term and grace days
    const loan = await createDailyLoan({ disbursement_date: '2026-01-01' });
    await collect(loan.id, 10200);

    const penaltyRes = await request
      .post(`/api/v1/loans/${loan.id}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});
    expect(penaltyRes.status).toBe(201);
    const penalty = penaltyRes.body.data.penalty as { id: string; penaltyAmount: number };

    const blocked = await settle(loan.id, { settlement_amount: 10200 });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toMatch(/outstanding penalties/);

    const waiveRes = await request
      .patch(`/api/v1/penalties/${penalty.id}/waive`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ waive_amount: penalty.penaltyAmount });
    expect(waiveRes.status).toBe(200);

    const res = await settle(loan.id, { settlement_amount: 10200 });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CLOSED');
    expect(res.body.data.isOverdue).toBe(false);
  });
});

// ─── Which loans and who ──────────────────────────────────────────────────

describe('PATCH /api/v1/loans/:id/settle — loan type, status and access', () => {
  let activeLoanId: string;

  beforeAll(async () => {
    const loan = await createDailyLoan();
    await collect(loan.id, 10200);
    activeLoanId = loan.id;
  });

  it('rejects a MONTHLY loan → 400', async () => {
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrowerId,
        principal_amount: 10000,
        interest_rate: 2,
        disbursement_date: '2026-09-01',
      });
    expect(loanRes.status).toBe(201);

    const res = await settle(loanRes.body.data.id, { settlement_amount: 10000 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Only DAILY loans/);
  });

  it('rejects a DEFAULTED loan → 400', async () => {
    const loan = await createDailyLoan();
    await collect(loan.id, 10200);

    const defaultRes = await request
      .patch(`/api/v1/loans/${loan.id}/default`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(defaultRes.status).toBe(200);

    const res = await settle(loan.id, { settlement_amount: 10200 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Only ACTIVE loans/);
  });

  it('collector cannot settle → 403', async () => {
    const res = await settle(activeLoanId, { settlement_amount: 10200 }, collectorAccessToken);
    expect(res.status).toBe(403);
  });

  it('cross-tenant returns 404', async () => {
    const res = await settle(activeLoanId, { settlement_amount: 10200 }, tenant2AdminAccessToken);
    expect(res.status).toBe(404);
  });

  it('unknown loan returns 404', async () => {
    const res = await settle('00000000-0000-0000-0000-000000000000', { settlement_amount: 10200 });
    expect(res.status).toBe(404);
  });

  it('requires authentication → 401', async () => {
    const res = await request
      .patch(`/api/v1/loans/${activeLoanId}/settle`)
      .send({ settlement_amount: 10200 });
    expect(res.status).toBe(401);
  });

  it('the loan used for the access checks is still ACTIVE and unchanged', async () => {
    const loan = await getLoan(activeLoanId);
    expect(loan.status).toBe('ACTIVE');
    expect(loan.totalRepaymentAmount).toBe(10500);
    expect(loan.isSettled).toBe(false);
  });
});
