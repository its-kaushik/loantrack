import { jest } from '@jest/globals';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import app from '../../src/app.js';
import prisma from '../helpers/prisma';

jest.setTimeout(60_000);

const request = supertest(app);

let tenantId: string;
let tenantId2: string;
let adminAccessToken: string;
let tenant2AdminAccessToken: string;
let collectorAccessToken: string;
let adminUserId: string;
let borrower1Id: string;
let borrower2Id: string;
let guarantorId: string;
let firstDailyLoanId: string;
let firstDailyLoanNumber: string;

beforeAll(async () => {
  // Clean up any leftover test data
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('dl-test-tenant', 'dl-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('dl-test-tenant', 'dl-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('dl-test-tenant', 'dl-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('dl-test-tenant', 'dl-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('dl-test-tenant', 'dl-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '7100%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '7100%'`;
  await prisma.tenant.deleteMany({ where: { slug: { in: ['dl-test-tenant', 'dl-test-tenant-2'] } } });

  // Create tenants
  const tenant = await prisma.tenant.create({
    data: { name: 'DL Test Tenant', slug: 'dl-test-tenant', ownerName: 'Owner', ownerPhone: '7100000000' },
  });
  tenantId = tenant.id;

  const tenant2 = await prisma.tenant.create({
    data: { name: 'DL Test Tenant 2', slug: 'dl-test-tenant-2', ownerName: 'Owner 2', ownerPhone: '7100000099' },
  });
  tenantId2 = tenant2.id;

  // Create admin in tenant 1
  const admin = await prisma.user.create({
    data: {
      tenantId,
      name: 'DL Test Admin',
      phone: '7100000001',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });
  adminUserId = admin.id;

  // Create collector in tenant 1
  await prisma.user.create({
    data: {
      tenantId,
      name: 'DL Test Collector',
      phone: '7100000002',
      passwordHash: await bcrypt.hash('Collector@123', 12),
      role: 'COLLECTOR',
    },
  });

  // Create admin in tenant 2
  await prisma.user.create({
    data: {
      tenantId: tenantId2,
      name: 'Tenant2 DL Admin',
      phone: '7100000003',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });

  // Login all users
  const adminLogin = await request.post('/api/v1/auth/login').send({ phone: '7100000001', password: 'Admin@123' });
  adminAccessToken = adminLogin.body.data.access_token;

  const collectorLogin = await request.post('/api/v1/auth/login').send({ phone: '7100000002', password: 'Collector@123' });
  collectorAccessToken = collectorLogin.body.data.access_token;

  const tenant2AdminLogin = await request.post('/api/v1/auth/login').send({ phone: '7100000003', password: 'Admin@123' });
  tenant2AdminAccessToken = tenant2AdminLogin.body.data.access_token;

  // Create borrower customers
  const b1 = await prisma.customer.create({
    data: { tenantId, fullName: 'DL Borrower One', phone: '7100100001', createdById: adminUserId },
  });
  borrower1Id = b1.id;

  const b2 = await prisma.customer.create({
    data: { tenantId, fullName: 'DL Borrower Two', phone: '7100100002', createdById: adminUserId },
  });
  borrower2Id = b2.id;

  // Create guarantor customer
  const g = await prisma.customer.create({
    data: { tenantId, fullName: 'DL Guarantor', phone: '7100100003', createdById: adminUserId },
  });
  guarantorId = g.id;
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('dl-test-tenant', 'dl-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('dl-test-tenant', 'dl-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('dl-test-tenant', 'dl-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('dl-test-tenant', 'dl-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('dl-test-tenant', 'dl-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '7100%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '7100%'`;
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, tenantId2] } } });
  await prisma.$disconnect();
});

// ─── POST /loans — Daily Disbursement ────────────────────────────────────

describe('POST /api/v1/loans — Daily Disbursement', () => {
  it('creates daily loan with correct fields (201)', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 100000,
        interest_rate: 5,
        disbursement_date: '2026-01-10',
        term_days: 120,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.loanType).toBe('DAILY');
    expect(res.body.data.borrowerId).toBe(borrower1Id);
    expect(res.body.data.borrowerName).toBe('DL Borrower One');
    expect(res.body.data.principalAmount).toBe(100000);
    expect(res.body.data.interestRate).toBe(5);
    expect(res.body.data.disbursementDate).toBe('2026-01-10');
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.termDays).toBe(120);
    expect(res.body.data.loanNumber).toMatch(/^DL-2026-\d{4}$/);

    firstDailyLoanId = res.body.data.id;
    firstDailyLoanNumber = res.body.data.loanNumber;
  });

  it('calculates totalRepaymentAmount correctly: principal * (1 + rate/100 * termDays/30)', async () => {
    // 100000 * (1 + 5/100 * 120/30) = 100000 * (1 + 0.2) = 120000
    const res = await request
      .get(`/api/v1/loans/${firstDailyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.body.data.totalRepaymentAmount).toBe(120000);
  });

  it('calculates dailyPaymentAmount = totalRepayment / termDays', async () => {
    const res = await request
      .get(`/api/v1/loans/${firstDailyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    // 120000 / 120 = 1000
    expect(res.body.data.dailyPaymentAmount).toBe(1000);
  });

  it('termEndDate = disbursementDate + termDays', async () => {
    const res = await request
      .get(`/api/v1/loans/${firstDailyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    // 2026-01-10 + 120 days = 2026-05-10
    expect(res.body.data.termEndDate).toBe('2026-05-10');
  });

  it('creates only DISBURSEMENT transaction (no ADVANCE_INTEREST)', async () => {
    const res = await request
      .get(`/api/v1/loans/${firstDailyLoanId}/transactions`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    const types = res.body.data.map((t: { transactionType: string }) => t.transactionType);
    expect(types).toContain('DISBURSEMENT');
    expect(types).not.toContain('ADVANCE_INTEREST');
    expect(res.body.data.length).toBe(1);

    const disbursement = res.body.data.find((t: { transactionType: string }) => t.transactionType === 'DISBURSEMENT');
    expect(disbursement.amount).toBe(100000);
  });

  it('generates sequential DL- loan numbers', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower2Id,
        principal_amount: 50000,
        interest_rate: 3,
        disbursement_date: '2026-01-15',
        term_days: 60,
      });

    expect(res.status).toBe(201);
    const firstSeq = parseInt(firstDailyLoanNumber.split('-')[2]!);
    const secondSeq = parseInt(res.body.data.loanNumber.split('-')[2]!);
    expect(secondSeq).toBe(firstSeq + 1);
  });

  it('validates borrower exists (404)', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: '00000000-0000-0000-0000-000000000000',
        principal_amount: 100000,
        interest_rate: 5,
        disbursement_date: '2026-01-10',
        term_days: 120,
      });

    expect(res.status).toBe(404);
  });

  it('validates guarantor exists (404)', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 100000,
        interest_rate: 5,
        disbursement_date: '2026-01-10',
        term_days: 120,
        guarantor_id: '00000000-0000-0000-0000-000000000000',
      });

    expect(res.status).toBe(404);
  });

  it('rejects borrower same as guarantor (400)', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 100000,
        interest_rate: 5,
        disbursement_date: '2026-01-10',
        term_days: 120,
        guarantor_id: borrower1Id,
      });

    expect(res.status).toBe(400);
  });

  it('rejects invalid date format (400)', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 100000,
        interest_rate: 5,
        disbursement_date: '01-10-2026',
        term_days: 120,
      });

    expect(res.status).toBe(400);
  });

  it('collector cannot create (403)', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 100000,
        interest_rate: 5,
        disbursement_date: '2026-01-10',
        term_days: 120,
      });

    expect(res.status).toBe(403);
  });

  it('enforces tenant isolation on borrower lookup', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${tenant2AdminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 100000,
        interest_rate: 5,
        disbursement_date: '2026-01-10',
        term_days: 120,
      });

    expect(res.status).toBe(404);
  });

  it('accepts custom grace_days, defaults to 7 when omitted', async () => {
    // Default grace_days
    const res1 = await request
      .get(`/api/v1/loans/${firstDailyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res1.body.data.graceDays).toBe(7);

    // Custom grace_days
    const res2 = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 50000,
        interest_rate: 4,
        disbursement_date: '2026-01-10',
        term_days: 90,
        grace_days: 14,
      });

    expect(res2.status).toBe(201);
    expect(res2.body.data.graceDays).toBe(14);
  });

  it('accepts optional fields (guarantor, collateral, notes)', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 75000,
        interest_rate: 4,
        disbursement_date: '2026-01-10',
        term_days: 90,
        guarantor_id: guarantorId,
        collateral_description: 'Silver bracelet',
        collateral_estimated_value: 25000,
        notes: 'Daily loan with all optional fields',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.guarantorId).toBe(guarantorId);
    expect(res.body.data.guarantorName).toBe('DL Guarantor');
    expect(res.body.data.collateralDescription).toBe('Silver bracelet');
    expect(res.body.data.collateralEstimatedValue).toBe(25000);
    expect(res.body.data.notes).toBe('Daily loan with all optional fields');
  });
});

// ─── POST /loans — Discriminated Union ──────────────────────────────────

describe('POST /api/v1/loans — Discriminated Union', () => {
  it('rejects DAILY with missing term_days (400)', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 100000,
        interest_rate: 5,
        disbursement_date: '2026-01-10',
        // term_days missing
      });

    expect(res.status).toBe(400);
  });

  it('rejects unknown loan_type (400)', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'WEEKLY',
        borrower_id: borrower1Id,
        principal_amount: 100000,
        interest_rate: 5,
        disbursement_date: '2026-01-10',
        term_days: 120,
      });

    expect(res.status).toBe(400);
  });
});

// ─── GET /loans — List with Daily ───────────────────────────────────────

describe('GET /api/v1/loans — List with Daily', () => {
  it('lists daily loans with type=DAILY filter', async () => {
    const res = await request
      .get('/api/v1/loans?type=DAILY')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const loan of res.body.data) {
      expect(loan.loanType).toBe('DAILY');
    }
  });

  it('enforces tenant isolation', async () => {
    const res = await request
      .get('/api/v1/loans?type=DAILY')
      .set('Authorization', `Bearer ${tenant2AdminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });

  it('collector can list', async () => {
    const res = await request
      .get('/api/v1/loans?type=DAILY')
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(200);
  });
});

// ─── GET /loans/:id — Daily Detail with Computed Fields ─────────────────

describe('GET /api/v1/loans/:id — Daily Detail', () => {
  it('returns all stored + computed fields', async () => {
    const res = await request
      .get(`/api/v1/loans/${firstDailyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(firstDailyLoanId);
    expect(res.body.data.loanType).toBe('DAILY');
    // Stored fields
    expect(res.body.data.termDays).toBe(120);
    expect(typeof res.body.data.totalRepaymentAmount).toBe('number');
    expect(typeof res.body.data.dailyPaymentAmount).toBe('number');
    expect(typeof res.body.data.termEndDate).toBe('string');
    expect(typeof res.body.data.graceDays).toBe('number');
    expect(typeof res.body.data.totalCollected).toBe('number');
    // Computed fields
    expect(typeof res.body.data.totalRemaining).toBe('number');
    expect(typeof res.body.data.daysPaid).toBe('number');
    expect(typeof res.body.data.daysRemaining).toBe('number');
    expect(typeof res.body.data.daysElapsed).toBe('number');
    expect(typeof res.body.data.isOverdue).toBe('boolean');
    expect(typeof res.body.data.daysOverdue).toBe('number');
    expect(typeof res.body.data.isBasePaid).toBe('boolean');
  });

  it('totalRemaining = totalRepaymentAmount - totalCollected', async () => {
    const res = await request
      .get(`/api/v1/loans/${firstDailyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.body.data.totalRemaining).toBe(res.body.data.totalRepaymentAmount - res.body.data.totalCollected);
  });

  it('daysPaid updates after collections', async () => {
    // Create a fresh loan for this test
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower2Id,
        principal_amount: 30000,
        interest_rate: 5,
        disbursement_date: '2026-01-10',
        term_days: 60,
      });
    const loanId = loanRes.body.data.id;
    const dailyPayment = loanRes.body.data.dailyPaymentAmount;

    // Collect 3 days worth
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: dailyPayment * 3,
        transaction_date: '2026-01-13',
      });

    const detail = await request
      .get(`/api/v1/loans/${loanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(detail.body.data.daysPaid).toBe(3);
    expect(detail.body.data.daysRemaining).toBe(60 - 3);
  });

  it('returns 404 for non-existent loan', async () => {
    const res = await request
      .get('/api/v1/loans/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for cross-tenant access', async () => {
    const res = await request
      .get(`/api/v1/loans/${firstDailyLoanId}`)
      .set('Authorization', `Bearer ${tenant2AdminAccessToken}`);

    expect(res.status).toBe(404);
  });
});

// ─── POST /transactions — Daily Collection ──────────────────────────────

describe('POST /api/v1/transactions — Daily Collection', () => {
  let collectionLoanId: string;

  beforeAll(async () => {
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 60000,
        interest_rate: 5,
        disbursement_date: '2026-01-10',
        term_days: 90,
      });
    collectionLoanId = loanRes.body.data.id;
  });

  it('records DAILY_COLLECTION and increments totalCollected (201)', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: collectionLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 1000,
        transaction_date: '2026-01-11',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].transactionType).toBe('DAILY_COLLECTION');
    expect(res.body.data[0].amount).toBe(1000);

    const detail = await request
      .get(`/api/v1/loans/${collectionLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(detail.body.data.totalCollected).toBe(1000);
  });

  it('multiple collections accumulate', async () => {
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: collectionLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 2000,
        transaction_date: '2026-01-12',
      });

    const detail = await request
      .get(`/api/v1/loans/${collectionLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(detail.body.data.totalCollected).toBe(3000);
  });

  it('partial collection (less than dailyPayment) accepted', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: collectionLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 100,
        transaction_date: '2026-01-13',
      });

    expect(res.status).toBe(201);
  });

  it('catch-up collection (more than dailyPayment) accepted', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: collectionLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 5000,
        transaction_date: '2026-01-14',
      });

    expect(res.status).toBe(201);
  });

  it('rejects DAILY_COLLECTION on MONTHLY loan (400)', async () => {
    // Create a monthly loan
    const monthlyRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower1Id,
        principal_amount: 50000,
        interest_rate: 2.5,
        disbursement_date: '2026-01-10',
      });
    const monthlyLoanId = monthlyRes.body.data.id;

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: monthlyLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 1000,
        transaction_date: '2026-01-15',
      });

    expect(res.status).toBe(400);
  });

  it('rejects INTEREST_PAYMENT on DAILY loan (400)', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: collectionLoanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 1000,
        transaction_date: '2026-01-15',
        effective_date: '2026-01-15',
      });

    expect(res.status).toBe(400);
  });

  it('DAILY_COLLECTION does NOT require effective_date', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: collectionLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 500,
        transaction_date: '2026-01-15',
        // no effective_date
      });

    expect(res.status).toBe(201);
  });
});

// ─── GET /loans/:id/payment-status — Daily ─────────────────────────────

describe('GET /api/v1/loans/:id/payment-status — Daily', () => {
  let statusLoanId: string;

  beforeAll(async () => {
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower2Id,
        principal_amount: 30000,
        interest_rate: 5,
        disbursement_date: '2026-01-20',
        term_days: 30,
      });
    statusLoanId = loanRes.body.data.id;

    // Make a collection on day 1
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: statusLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: loanRes.body.data.dailyPaymentAmount,
        transaction_date: '2026-01-21',
      });
  });

  it('returns day-by-day view with correct structure', async () => {
    const res = await request
      .get(`/api/v1/loans/${statusLoanId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.loanId).toBe(statusLoanId);
    expect(res.body.data.loanNumber).toMatch(/^DL-/);
    expect(typeof res.body.data.totalRepaymentAmount).toBe('number');
    expect(typeof res.body.data.dailyPaymentAmount).toBe('number');
    expect(typeof res.body.data.totalCollected).toBe('number');
    expect(Array.isArray(res.body.data.days)).toBe(true);
    expect(res.body.data.days.length).toBeGreaterThanOrEqual(1);

    const day = res.body.data.days[0];
    expect(day.dayNumber).toBe(1);
    expect(typeof day.date).toBe('string');
    expect(typeof day.dailyPaymentAmount).toBe('number');
    expect(typeof day.amountCollected).toBe('number');
    expect(typeof day.cumulativeCollected).toBe('number');
    expect(typeof day.isCovered).toBe('boolean');
  });

  it('isCovered tracks cumulative coverage correctly', async () => {
    const res = await request
      .get(`/api/v1/loans/${statusLoanId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    // Day 1 should be covered (we paid exactly dailyPaymentAmount)
    const day1 = res.body.data.days.find((d: { dayNumber: number }) => d.dayNumber === 1);
    expect(day1.isCovered).toBe(true);

    // Day 2 (if present) should not be covered (no additional payment)
    if (res.body.data.days.length >= 2) {
      const day2 = res.body.data.days.find((d: { dayNumber: number }) => d.dayNumber === 2);
      expect(day2.isCovered).toBe(false);
    }
  });

  it('days enumerate from disbursement+1 through min(today, termEndDate)', async () => {
    const res = await request
      .get(`/api/v1/loans/${statusLoanId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    // First day should be disbursement+1 = 2026-01-21
    expect(res.body.data.days[0].date).toBe('2026-01-21');
    expect(res.body.data.days[0].dayNumber).toBe(1);

    // Last day should be <= today and <= termEndDate
    const lastDay = res.body.data.days[res.body.data.days.length - 1];
    expect(lastDay.date <= '2026-02-19').toBe(true); // termEndDate
  });

  it('returns 404 for non-existent loan', async () => {
    const res = await request
      .get('/api/v1/loans/00000000-0000-0000-0000-000000000000/payment-status')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(404);
  });
});

// ─── PATCH /loans/:id/close — Daily ────────────────────────────────────

describe('PATCH /api/v1/loans/:id/close — Daily', () => {
  let closeLoanId: string;

  beforeAll(async () => {
    // Create a loan with small amount for easy full repayment
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 3000,
        interest_rate: 5,
        disbursement_date: '2026-01-10',
        term_days: 30,
      });
    closeLoanId = loanRes.body.data.id;
    const totalRepayment = loanRes.body.data.totalRepaymentAmount;

    // Pay full amount
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: closeLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: totalRepayment,
        transaction_date: '2026-01-15',
      });
  });

  it('full lifecycle: disburse → collect full amount → close', async () => {
    const res = await request
      .patch(`/api/v1/loans/${closeLoanId}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CLOSED');
    expect(res.body.data.closureDate).toBeDefined();
    expect(res.body.data.loanType).toBe('DAILY');
  });

  it('rejects when totalCollected < totalRepaymentAmount (400)', async () => {
    // Create an under-collected loan
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower2Id,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2026-01-10',
        term_days: 30,
      });
    const loanId = loanRes.body.data.id;

    // Only partial collection
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 100,
        transaction_date: '2026-01-11',
      });

    const res = await request
      .patch(`/api/v1/loans/${loanId}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(400);
  });

  it('collector cannot close (403)', async () => {
    const res = await request
      .patch(`/api/v1/loans/${firstDailyLoanId}/close`)
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(403);
  });

  it('cross-tenant returns 404', async () => {
    const res = await request
      .patch(`/api/v1/loans/${firstDailyLoanId}/close`)
      .set('Authorization', `Bearer ${tenant2AdminAccessToken}`);

    expect(res.status).toBe(404);
  });

  it('already closed loan rejected (400)', async () => {
    // closeLoanId was already closed above
    const res = await request
      .patch(`/api/v1/loans/${closeLoanId}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(400);
  });
});

// ─── Overdue Detection ──────────────────────────────────────────────────

describe('Overdue Detection — Daily', () => {
  let overdueLoanId: string;
  let nonOverdueLoanId: string;

  beforeAll(async () => {
    // Overdue loan: disbursed 2025-09-01, term 120, grace 7
    // termEndDate = 2025-12-30, overdue threshold = 2026-01-06
    // Today is 2026-01-31 → overdue
    const overdueRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 100000,
        interest_rate: 5,
        disbursement_date: '2025-09-01',
        term_days: 120,
        grace_days: 7,
      });
    overdueLoanId = overdueRes.body.data.id;

    // Non-overdue loan: disbursed 2026-01-10, term 120
    // termEndDate = 2026-05-10, well within term
    nonOverdueLoanId = firstDailyLoanId; // Already created above
  });

  it('isOverdue=false within term + grace period', async () => {
    const res = await request
      .get(`/api/v1/loans/${nonOverdueLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.body.data.isOverdue).toBe(false);
    expect(res.body.data.daysOverdue).toBe(0);
  });

  it('isOverdue=true after term + grace period with incomplete payment', async () => {
    const res = await request
      .get(`/api/v1/loans/${overdueLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.body.data.isOverdue).toBe(true);
    expect(res.body.data.daysOverdue).toBeGreaterThan(0);
  });

  it('daysOverdue computed correctly', async () => {
    const res = await request
      .get(`/api/v1/loans/${overdueLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    // Overdue threshold = 2025-12-30 + 7 = 2026-01-06
    // Today = 2026-01-31 → daysOverdue = 25
    expect(res.body.data.daysOverdue).toBe(25);
  });
});

// ─── Cross-type Validation ──────────────────────────────────────────────

describe('Cross-type Validation', () => {
  it('PRINCIPAL_RETURN rejected on DAILY loan (400)', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: firstDailyLoanId,
        transaction_type: 'PRINCIPAL_RETURN',
        amount: 1000,
        transaction_date: '2026-01-15',
      });

    expect(res.status).toBe(400);
  });

  it('monthly loan creation still works (regression)', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower2Id,
        principal_amount: 50000,
        interest_rate: 2,
        disbursement_date: '2026-01-10',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.loanType).toBe('MONTHLY');
    expect(res.body.data.loanNumber).toMatch(/^ML-/);
    expect(res.body.data.remainingPrincipal).toBe(50000);
    expect(res.body.data.advanceInterestAmount).toBe(1000);
  });
});
