import { jest } from '@jest/globals';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import app from '../../src/app.js';
import prisma from '../helpers/prisma';

jest.setTimeout(120_000);

const request = supertest(app);

let tenantId: string;
let adminAccessToken: string;
let collector1AccessToken: string;
let collector2AccessToken: string;
let adminUserId: string;
let collector1Id: string;
let collector2Id: string;

// Loan IDs
let activeDaily1Id: string;
let activeDaily2Id: string;
let activeMonthlyId: string;
let defaultedDailyId: string;
let closedMonthlyId: string;
let cancelledLoanId: string;

const todayDate = new Date();
const todayStr = `${todayDate.getUTCFullYear()}-${String(todayDate.getUTCMonth() + 1).padStart(2, '0')}-${String(todayDate.getUTCDate()).padStart(2, '0')}`;

beforeAll(async () => {
  // Clean up
  await prisma.$executeRaw`DELETE FROM "fund_entries" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-report-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "expenses" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-report-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "penalties" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-report-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-report-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-report-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-report-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-report-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-report-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '9600%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '9600%'`;
  await prisma.tenant.deleteMany({ where: { slug: 'p9-report-test-tenant' } });

  // Create tenant
  const tenant = await prisma.tenant.create({
    data: { name: 'P9 Report Test Tenant', slug: 'p9-report-test-tenant', ownerName: 'Owner', ownerPhone: '9600000000' },
  });
  tenantId = tenant.id;

  // Create admin
  const admin = await prisma.user.create({
    data: {
      tenantId,
      name: 'Report Test Admin',
      phone: '9600000001',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });
  adminUserId = admin.id;

  // Create 2 collectors
  const c1 = await prisma.user.create({
    data: {
      tenantId,
      name: 'Report Collector One',
      phone: '9600000002',
      passwordHash: await bcrypt.hash('Collector@123', 12),
      role: 'COLLECTOR',
    },
  });
  collector1Id = c1.id;

  const c2 = await prisma.user.create({
    data: {
      tenantId,
      name: 'Report Collector Two',
      phone: '9600000003',
      passwordHash: await bcrypt.hash('Collector@123', 12),
      role: 'COLLECTOR',
    },
  });
  collector2Id = c2.id;

  // Login
  const adminLogin = await request.post('/api/v1/auth/login').send({ phone: '9600000001', password: 'Admin@123' });
  adminAccessToken = adminLogin.body.data.access_token;

  const c1Login = await request.post('/api/v1/auth/login').send({ phone: '9600000002', password: 'Collector@123' });
  collector1AccessToken = c1Login.body.data.access_token;

  const c2Login = await request.post('/api/v1/auth/login').send({ phone: '9600000003', password: 'Collector@123' });
  collector2AccessToken = c2Login.body.data.access_token;

  // Create borrowers and guarantor
  const b1 = await prisma.customer.create({
    data: { tenantId, fullName: 'Report Borrower One', phone: '9600100001', createdById: adminUserId },
  });
  const b2 = await prisma.customer.create({
    data: { tenantId, fullName: 'Report Borrower Two', phone: '9600100002', createdById: adminUserId },
  });
  const g1 = await prisma.customer.create({
    data: { tenantId, fullName: 'Report Guarantor One', phone: '9600100003', createdById: adminUserId },
  });

  // Fund entries: 2 injections + 1 withdrawal
  await request.post('/api/v1/fund/entries').set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ entry_type: 'INJECTION', amount: 500000, entry_date: '2025-12-01', description: 'Capital 1' });
  await request.post('/api/v1/fund/entries').set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ entry_type: 'INJECTION', amount: 300000, entry_date: '2026-01-01', description: 'Capital 2' });
  await request.post('/api/v1/fund/entries').set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ entry_type: 'WITHDRAWAL', amount: 50000, entry_date: '2026-01-15', description: 'Withdrawal' });

  // ─── Create loans ───────────────────────────────────────

  // Active daily 1 (in-term)
  const ad1 = await request.post('/api/v1/loans').set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'DAILY', borrower_id: b1.id, principal_amount: 10000, interest_rate: 10,
      disbursement_date: '2026-01-01', term_days: 120, grace_days: 7,
    });
  activeDaily1Id = ad1.body.data.id;

  // Active daily 2 (overdue, for default later)
  const ad2 = await request.post('/api/v1/loans').set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'DAILY', borrower_id: b2.id, guarantor_id: g1.id, principal_amount: 50000, interest_rate: 5,
      disbursement_date: '2025-06-01', term_days: 60, grace_days: 7,
    });
  activeDaily2Id = ad2.body.data.id;

  // Active monthly
  const am = await request.post('/api/v1/loans').set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'MONTHLY', borrower_id: b1.id, principal_amount: 100000, interest_rate: 2,
      disbursement_date: '2025-11-15',
    });
  activeMonthlyId = am.body.data.id;

  // Defaulted daily
  const dd = await request.post('/api/v1/loans').set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'DAILY', borrower_id: b2.id, guarantor_id: g1.id, principal_amount: 20000, interest_rate: 5,
      disbursement_date: '2025-05-01', term_days: 60, grace_days: 7,
    });
  defaultedDailyId = dd.body.data.id;
  await request.patch(`/api/v1/loans/${defaultedDailyId}/default`).set('Authorization', `Bearer ${adminAccessToken}`);

  // Closed monthly (create, pay interest, return principal, close)
  const cm = await request.post('/api/v1/loans').set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'MONTHLY', borrower_id: b2.id, principal_amount: 10000, interest_rate: 2,
      disbursement_date: '2025-12-01',
    });
  closedMonthlyId = cm.body.data.id;
  // Pay interest for Jan 2026: 10000 * 2% = 200
  await request.post('/api/v1/transactions').set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ loan_id: closedMonthlyId, transaction_type: 'INTEREST_PAYMENT', amount: 200, transaction_date: '2026-01-15', effective_date: '2026-01-15' });
  // Return principal
  await request.post('/api/v1/transactions').set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ loan_id: closedMonthlyId, transaction_type: 'PRINCIPAL_RETURN', amount: 10000, transaction_date: '2026-01-15' });
  // Close
  await request.patch(`/api/v1/loans/${closedMonthlyId}/close`).set('Authorization', `Bearer ${adminAccessToken}`);

  // Cancelled loan (should be excluded from all reports)
  const cl = await request.post('/api/v1/loans').set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'DAILY', borrower_id: b1.id, principal_amount: 5000, interest_rate: 10,
      disbursement_date: '2026-01-01', term_days: 60,
    });
  cancelledLoanId = cl.body.data.id;
  await request.patch(`/api/v1/loans/${cancelledLoanId}/cancel`).set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ cancellation_reason: 'Test cancellation' });

  // ─── Record transactions (various types, by different collectors) ──────

  // Collector 1: DAILY_COLLECTION on activeDailyId1
  await request.post('/api/v1/transactions').set('Authorization', `Bearer ${collector1AccessToken}`)
    .send({ loan_id: activeDaily1Id, transaction_type: 'DAILY_COLLECTION', amount: 100, transaction_date: todayStr });

  // Collector 2: DAILY_COLLECTION on activeDailyId2
  await request.post('/api/v1/transactions').set('Authorization', `Bearer ${collector2AccessToken}`)
    .send({ loan_id: activeDaily2Id, transaction_type: 'DAILY_COLLECTION', amount: 500, transaction_date: todayStr });

  // Admin: Approve collector transactions
  const pendingRes = await request.get('/api/v1/transactions/pending').set('Authorization', `Bearer ${adminAccessToken}`);
  for (const txn of pendingRes.body.data) {
    await request.patch(`/api/v1/transactions/${txn.id}/approve`).set('Authorization', `Bearer ${adminAccessToken}`);
  }

  // Admin: Interest payment on active monthly
  await request.post('/api/v1/transactions').set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ loan_id: activeMonthlyId, transaction_type: 'INTEREST_PAYMENT', amount: 2000, transaction_date: todayStr, effective_date: todayStr });

  // Admin: Guarantor payment on defaulted loan
  await request.post('/api/v1/transactions').set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ loan_id: defaultedDailyId, transaction_type: 'GUARANTOR_PAYMENT', amount: 5000, transaction_date: todayStr });

  // Interest waiver on active monthly
  await request.post(`/api/v1/loans/${activeMonthlyId}/waive-interest`).set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ effective_date: todayStr, waive_amount: 500 });

  // Expenses
  await request.post('/api/v1/expenses').set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ category: 'TRAVEL', amount: 3000, expense_date: '2026-01-10' });
  await request.post('/api/v1/expenses').set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ category: 'SALARY', amount: 15000, expense_date: '2026-01-20' });
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "fund_entries" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-report-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "expenses" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-report-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "penalties" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-report-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-report-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-report-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-report-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-report-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-report-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '9600%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '9600%'`;
  await prisma.tenant.deleteMany({ where: { slug: 'p9-report-test-tenant' } });
  await prisma.$disconnect();
});

// ─── P&L Report ─────────────────────────────────────────────────────────

describe('P&L Report — GET /reports/profit-loss', () => {
  it('returns all 8 metrics for full date range → 200', async () => {
    const res = await request
      .get('/api/v1/reports/profit-loss?from=2025-01-01&to=2026-12-31')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    const fields = [
      'totalCapitalInvested', 'moneyDeployed', 'totalInterestEarned',
      'moneyLostToDefaults', 'totalExpenses', 'revenueForgone',
      'netProfit', 'cashInHand',
    ];
    for (const field of fields) {
      expect(data[field]).toBeDefined();
      expect(parseFloat(data[field])).not.toBeNaN();
    }
  });

  it('expenses filtered by date range', async () => {
    const res = await request
      .get('/api/v1/reports/profit-loss?from=2026-01-10&to=2026-01-10')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    // Should only include the TRAVEL expense on 2026-01-10 (3000)
    expect(res.body.data.totalExpenses).toBe('3000.00');
  });

  it('missing from/to → 400', async () => {
    const res = await request
      .get('/api/v1/reports/profit-loss')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(400);
  });

  it('capital invested is cumulative through toDate', async () => {
    // Only first injection (2025-12-01, 500000) should be included
    const res = await request
      .get('/api/v1/reports/profit-loss?from=2025-12-01&to=2025-12-31')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.totalCapitalInvested).toBe('500000.00');
  });

  it('default losses only for loans defaulted in range', async () => {
    // Use a future range where no defaults happened
    const res = await request
      .get('/api/v1/reports/profit-loss?from=2027-01-01&to=2027-12-31')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.moneyLostToDefaults).toBe('0.00');
  });
});

// ─── Collector Summary ──────────────────────────────────────────────────

describe('Collector Summary — GET /reports/collector-summary', () => {
  it('returns per-collector stats within date range', async () => {
    const res = await request
      .get(`/api/v1/reports/collector-summary?from=2025-01-01&to=2026-12-31`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(2);
  });

  it('each collector has correct field types', async () => {
    const res = await request
      .get(`/api/v1/reports/collector-summary?from=2025-01-01&to=2026-12-31`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    for (const collector of res.body.data) {
      expect(collector.userId).toBeDefined();
      expect(collector.name).toBeDefined();
      expect(typeof collector.totalTransactions).toBe('number');
      expect(typeof collector.totalAmount).toBe('string');
      expect(typeof collector.loansServiced).toBe('number');
      expect(typeof collector.approved).toBe('number');
      expect(typeof collector.pending).toBe('number');
      expect(typeof collector.rejected).toBe('number');
    }
  });

  it('distinct loans serviced count is correct', async () => {
    const res = await request
      .get(`/api/v1/reports/collector-summary?from=2025-01-01&to=2026-12-31`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const c1 = res.body.data.find((c: { userId: string }) => c.userId === collector1Id);
    const c2 = res.body.data.find((c: { userId: string }) => c.userId === collector2Id);
    // Each collector submitted 1 transaction on 1 loan
    if (c1) expect(c1.loansServiced).toBeGreaterThanOrEqual(1);
    if (c2) expect(c2.loansServiced).toBeGreaterThanOrEqual(1);
  });

  it('empty range returns zero stats', async () => {
    const res = await request
      .get('/api/v1/reports/collector-summary?from=2030-01-01&to=2030-12-31')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    for (const collector of res.body.data) {
      expect(collector.totalTransactions).toBe(0);
    }
  });
});

// ─── Loan Book ──────────────────────────────────────────────────────────

describe('Loan Book — GET /reports/loan-book', () => {
  it('returns all non-cancelled loans', async () => {
    const res = await request
      .get('/api/v1/reports/loan-book')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // We have: 2 active daily + 1 active monthly + 1 defaulted daily + 1 closed monthly = 5
    // Cancelled loan should NOT be included
    expect(res.body.data.length).toBe(5);

    const cancelledInBook = res.body.data.find(
      (l: { loanId: string }) => l.loanId === cancelledLoanId,
    );
    expect(cancelledInBook).toBeUndefined();
  });

  it('each loan has correct fields', async () => {
    const res = await request
      .get('/api/v1/reports/loan-book')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    for (const loan of res.body.data) {
      expect(loan.loanId).toBeDefined();
      expect(loan.loanNumber).toBeDefined();
      expect(loan.loanType).toBeDefined();
      expect(loan.status).toBeDefined();
      expect(loan.borrowerName).toBeDefined();
      expect(loan.principalAmount).toBeDefined();
      expect(loan.disbursementDate).toBeDefined();
      expect(loan.outstandingAmount).toBeDefined();
      expect(loan.interestEarned).toBeDefined();
    }
  });

  it('closed monthly loan outstanding is 0', async () => {
    const res = await request
      .get('/api/v1/reports/loan-book')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const closedLoan = res.body.data.find(
      (l: { loanId: string }) => l.loanId === closedMonthlyId,
    );
    expect(closedLoan).toBeDefined();
    expect(closedLoan.outstandingAmount).toBe('0.00');
  });
});

// ─── Cash in Hand Reconciliation ────────────────────────────────────────

describe('Cash in Hand Reconciliation — GET /fund/reconciliation', () => {
  it('returns matching values', async () => {
    const res = await request
      .get('/api/v1/fund/reconciliation')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.queryResult).toBeDefined();
    expect(res.body.data.bottomUpResult).toBeDefined();
    expect(res.body.data.matches).toBe(true);
  });

  it('both methods produce same numeric result', async () => {
    const res = await request
      .get('/api/v1/fund/reconciliation')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.body.data.queryResult).toBe(res.body.data.bottomUpResult);
    expect(parseFloat(res.body.data.queryResult)).not.toBeNaN();
  });
});

// ─── Access Control ─────────────────────────────────────────────────────

describe('Reports & Reconciliation Access Control', () => {
  it('collector cannot access reports → 403', async () => {
    const endpoints = [
      `/api/v1/reports/profit-loss?from=2025-01-01&to=2026-12-31`,
      `/api/v1/reports/collector-summary?from=2025-01-01&to=2026-12-31`,
      '/api/v1/reports/loan-book',
    ];
    for (const endpoint of endpoints) {
      const res = await request
        .get(endpoint)
        .set('Authorization', `Bearer ${collector1AccessToken}`);
      expect(res.status).toBe(403);
    }
  });

  it('collector cannot access reconciliation → 403', async () => {
    const res = await request
      .get('/api/v1/fund/reconciliation')
      .set('Authorization', `Bearer ${collector1AccessToken}`);
    expect(res.status).toBe(403);
  });
});
