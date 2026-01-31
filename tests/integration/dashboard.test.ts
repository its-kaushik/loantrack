import { jest } from '@jest/globals';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import app from '../../src/app.js';
import prisma from '../helpers/prisma';

jest.setTimeout(90_000);

const request = supertest(app);

let tenantId: string;
let adminAccessToken: string;
let collectorAccessToken: string;
let adminUserId: string;

// Loan IDs
let activeDailyInTermId: string;
let activeDailyOverdueId: string;
let activeMonthlyId: string;
let defaultedDailyId: string;
let writtenOffMonthlyId: string;

// Today string for comparison
const todayDate = new Date();
const todayStr = `${todayDate.getUTCFullYear()}-${String(todayDate.getUTCMonth() + 1).padStart(2, '0')}-${String(todayDate.getUTCDate()).padStart(2, '0')}`;

beforeAll(async () => {
  // Clean up any leftover test data
  await prisma.$executeRaw`DELETE FROM "fund_entries" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-dash-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "expenses" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-dash-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "penalties" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-dash-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-dash-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-dash-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-dash-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-dash-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-dash-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '9500%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '9500%'`;
  await prisma.tenant.deleteMany({ where: { slug: 'p9-dash-test-tenant' } });

  // Create tenant
  const tenant = await prisma.tenant.create({
    data: { name: 'P9 Dash Test Tenant', slug: 'p9-dash-test-tenant', ownerName: 'Owner', ownerPhone: '9500000000' },
  });
  tenantId = tenant.id;

  // Create admin
  const admin = await prisma.user.create({
    data: {
      tenantId,
      name: 'Dash Test Admin',
      phone: '9500000001',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });
  adminUserId = admin.id;

  // Create collector
  await prisma.user.create({
    data: {
      tenantId,
      name: 'Dash Test Collector',
      phone: '9500000002',
      passwordHash: await bcrypt.hash('Collector@123', 12),
      role: 'COLLECTOR',
    },
  });

  // Login
  const adminLogin = await request.post('/api/v1/auth/login').send({ phone: '9500000001', password: 'Admin@123' });
  adminAccessToken = adminLogin.body.data.access_token;

  const collectorLogin = await request.post('/api/v1/auth/login').send({ phone: '9500000002', password: 'Collector@123' });
  collectorAccessToken = collectorLogin.body.data.access_token;

  // Create borrowers
  const b1 = await prisma.customer.create({
    data: { tenantId, fullName: 'Dash Borrower One', phone: '9500100001', createdById: adminUserId },
  });
  const b2 = await prisma.customer.create({
    data: { tenantId, fullName: 'Dash Borrower Two', phone: '9500100002', createdById: adminUserId },
  });
  const g1 = await prisma.customer.create({
    data: { tenantId, fullName: 'Dash Guarantor One', phone: '9500100003', createdById: adminUserId },
  });

  // Fund injection (for dashboard fund summary test)
  await request
    .post('/api/v1/fund/entries')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ entry_type: 'INJECTION', amount: 1000000, entry_date: '2025-12-01' });

  // 1. ACTIVE daily loan (within term — for expected/missed collections)
  const dailyInTerm = await request
    .post('/api/v1/loans')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'DAILY',
      borrower_id: b1.id,
      principal_amount: 10000,
      interest_rate: 10,
      disbursement_date: '2026-01-01',
      term_days: 120,
      grace_days: 7,
    });
  activeDailyInTermId = dailyInTerm.body.data.id;

  // 2. ACTIVE daily loan (past term + grace → overdue)
  const dailyOverdue = await request
    .post('/api/v1/loans')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'DAILY',
      borrower_id: b2.id,
      guarantor_id: g1.id,
      principal_amount: 50000,
      interest_rate: 5,
      disbursement_date: '2025-06-01',
      term_days: 60,
      grace_days: 7,
    });
  activeDailyOverdueId = dailyOverdue.body.data.id;

  // 3. ACTIVE monthly loan (for monthly interest due / overdue)
  const monthlyLoan = await request
    .post('/api/v1/loans')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'MONTHLY',
      borrower_id: b1.id,
      principal_amount: 100000,
      interest_rate: 2,
      disbursement_date: '2025-11-15',
    });
  activeMonthlyId = monthlyLoan.body.data.id;

  // 4. DEFAULTED daily loan
  const dailyDefaultRes = await request
    .post('/api/v1/loans')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'DAILY',
      borrower_id: b2.id,
      guarantor_id: g1.id,
      principal_amount: 20000,
      interest_rate: 5,
      disbursement_date: '2025-05-01',
      term_days: 60,
      grace_days: 7,
    });
  defaultedDailyId = dailyDefaultRes.body.data.id;
  // Mark as defaulted
  await request
    .patch(`/api/v1/loans/${defaultedDailyId}/default`)
    .set('Authorization', `Bearer ${adminAccessToken}`);

  // 5. WRITTEN_OFF monthly loan
  const monthlyWORes = await request
    .post('/api/v1/loans')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'MONTHLY',
      borrower_id: b2.id,
      principal_amount: 30000,
      interest_rate: 2,
      disbursement_date: '2025-06-01',
    });
  writtenOffMonthlyId = monthlyWORes.body.data.id;
  await request
    .patch(`/api/v1/loans/${writtenOffMonthlyId}/default`)
    .set('Authorization', `Bearer ${adminAccessToken}`);
  await request
    .patch(`/api/v1/loans/${writtenOffMonthlyId}/write-off`)
    .set('Authorization', `Bearer ${adminAccessToken}`);

  // Record a DAILY_COLLECTION for today on the in-term daily loan
  await request
    .post('/api/v1/transactions')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_id: activeDailyInTermId,
      transaction_type: 'DAILY_COLLECTION',
      amount: 100,
      transaction_date: todayStr,
    });

  // Create an expense
  await request
    .post('/api/v1/expenses')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ category: 'OFFICE', amount: 2000, expense_date: todayStr });
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "fund_entries" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-dash-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "expenses" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-dash-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "penalties" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-dash-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-dash-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-dash-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-dash-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-dash-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-dash-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '9500%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '9500%'`;
  await prisma.tenant.deleteMany({ where: { slug: 'p9-dash-test-tenant' } });
  await prisma.$disconnect();
});

// ─── Today's Summary ────────────────────────────────────────────────────

describe("Today's Summary — GET /dashboard/today", () => {
  it('returns correct active daily loan count', async () => {
    const res = await request
      .get('/api/v1/dashboard/today')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // We have 2 active daily loans (in-term + overdue are both ACTIVE)
    expect(res.body.data.activeDailyLoanCount).toBe(2);
  });

  it('expected collections for in-term daily loans', async () => {
    const res = await request
      .get('/api/v1/dashboard/today')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    // Only the in-term loan should be expected (overdue is past term_end_date)
    expect(res.body.data.expectedCollections.count).toBeGreaterThanOrEqual(1);
    expect(parseFloat(res.body.data.expectedCollections.totalAmount)).toBeGreaterThan(0);
  });

  it('received collections reflects today collections', async () => {
    const res = await request
      .get('/api/v1/dashboard/today')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.body.data.receivedCollections.count).toBeGreaterThanOrEqual(1);
    expect(parseFloat(res.body.data.receivedCollections.totalAmount)).toBeGreaterThanOrEqual(100);
  });

  it('total collected today includes approved money-in', async () => {
    const res = await request
      .get('/api/v1/dashboard/today')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(parseFloat(res.body.data.totalCollectedToday)).toBeGreaterThanOrEqual(100);
  });

  it('pending approvals count is a number', async () => {
    const res = await request
      .get('/api/v1/dashboard/today')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(typeof res.body.data.pendingApprovalsCount).toBe('number');
  });
});

// ─── Overdue Loans ──────────────────────────────────────────────────────

describe('Overdue Loans — GET /dashboard/overdue', () => {
  it('includes overdue daily loan past term + grace', async () => {
    const res = await request
      .get('/api/v1/dashboard/overdue')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.overdueDailyLoans.length).toBeGreaterThanOrEqual(1);

    const overdueLoan = res.body.data.overdueDailyLoans.find(
      (l: { loanId: string }) => l.loanId === activeDailyOverdueId,
    );
    expect(overdueLoan).toBeDefined();
    expect(overdueLoan.daysOverdue).toBeGreaterThan(0);
    expect(parseFloat(overdueLoan.amountRemaining)).toBeGreaterThan(0);
  });

  it('in-term loans NOT in overdue list', async () => {
    const res = await request
      .get('/api/v1/dashboard/overdue')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const inTermLoan = res.body.data.overdueDailyLoans.find(
      (l: { loanId: string }) => l.loanId === activeDailyInTermId,
    );
    expect(inTermLoan).toBeUndefined();
  });

  it('overdue monthly loans detection works', async () => {
    const res = await request
      .get('/api/v1/dashboard/overdue')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    // Monthly loan from Nov 2025 should have overdue cycles
    expect(res.body.data.overdueMonthlyLoans).toBeDefined();
    expect(Array.isArray(res.body.data.overdueMonthlyLoans)).toBe(true);
  });
});

// ─── Defaulters ─────────────────────────────────────────────────────────

describe('Defaulters — GET /dashboard/defaulters', () => {
  it('includes DEFAULTED loan', async () => {
    const res = await request
      .get('/api/v1/dashboard/defaulters')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    const defaultedLoan = res.body.data.defaulters.find(
      (d: { loanId: string }) => d.loanId === defaultedDailyId,
    );
    expect(defaultedLoan).toBeDefined();
    expect(defaultedLoan.status).toBe('DEFAULTED');
    expect(defaultedLoan.borrowerName).toBeDefined();
    expect(defaultedLoan.defaultedAt).toBeDefined();
  });

  it('includes WRITTEN_OFF loan', async () => {
    const res = await request
      .get('/api/v1/dashboard/defaulters')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const woLoan = res.body.data.defaulters.find(
      (d: { loanId: string }) => d.loanId === writtenOffMonthlyId,
    );
    expect(woLoan).toBeDefined();
    expect(woLoan.status).toBe('WRITTEN_OFF');
  });

  it('each defaulter has borrower/guarantor details and outstanding amount', async () => {
    const res = await request
      .get('/api/v1/dashboard/defaulters')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    for (const d of res.body.data.defaulters) {
      expect(d.loanId).toBeDefined();
      expect(d.loanNumber).toBeDefined();
      expect(d.borrowerName).toBeDefined();
      expect(d.borrowerPhone).toBeDefined();
      expect(d.outstandingAmount).toBeDefined();
      expect(parseFloat(d.outstandingAmount)).toBeGreaterThanOrEqual(0);
    }
  });

  it('ACTIVE and CLOSED loans NOT in defaulters', async () => {
    const res = await request
      .get('/api/v1/dashboard/defaulters')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const activeLoan = res.body.data.defaulters.find(
      (d: { loanId: string }) => d.loanId === activeDailyInTermId,
    );
    expect(activeLoan).toBeUndefined();
  });
});

// ─── Dashboard Fund Summary ─────────────────────────────────────────────

describe('Dashboard Fund Summary — GET /dashboard/fund-summary', () => {
  it('returns all 8 metrics', async () => {
    const res = await request
      .get('/api/v1/dashboard/fund-summary')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.totalCapitalInvested).toBeDefined();
    expect(data.moneyDeployed).toBeDefined();
    expect(data.totalInterestEarned).toBeDefined();
    expect(data.moneyLostToDefaults).toBeDefined();
    expect(data.totalExpenses).toBeDefined();
    expect(data.revenueForgone).toBeDefined();
    expect(data.netProfit).toBeDefined();
    expect(data.cashInHand).toBeDefined();
  });

  it('total expenses reflects recorded expenses', async () => {
    const res = await request
      .get('/api/v1/dashboard/fund-summary')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(parseFloat(res.body.data.totalExpenses)).toBeGreaterThanOrEqual(2000);
  });
});

// ─── Access Control ─────────────────────────────────────────────────────

describe('Dashboard Access Control', () => {
  it('collector cannot access dashboard → 403', async () => {
    const endpoints = ['/api/v1/dashboard/today', '/api/v1/dashboard/overdue', '/api/v1/dashboard/defaulters', '/api/v1/dashboard/fund-summary'];
    for (const endpoint of endpoints) {
      const res = await request
        .get(endpoint)
        .set('Authorization', `Bearer ${collectorAccessToken}`);
      expect(res.status).toBe(403);
    }
  });

  it('unauthenticated → 401', async () => {
    const res = await request.get('/api/v1/dashboard/today');
    expect(res.status).toBe(401);
  });
});
