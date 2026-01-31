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
let firstLoanId: string;
let firstLoanNumber: string;

beforeAll(async () => {
  // Clean up any leftover test data
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('ml-test-tenant', 'ml-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('ml-test-tenant', 'ml-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('ml-test-tenant', 'ml-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('ml-test-tenant', 'ml-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('ml-test-tenant', 'ml-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '5000%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '5000%'`;
  await prisma.tenant.deleteMany({ where: { slug: { in: ['ml-test-tenant', 'ml-test-tenant-2'] } } });

  // Create tenants
  const tenant = await prisma.tenant.create({
    data: { name: 'ML Test Tenant', slug: 'ml-test-tenant', ownerName: 'Owner', ownerPhone: '5000000000' },
  });
  tenantId = tenant.id;

  const tenant2 = await prisma.tenant.create({
    data: { name: 'ML Test Tenant 2', slug: 'ml-test-tenant-2', ownerName: 'Owner 2', ownerPhone: '5000000099' },
  });
  tenantId2 = tenant2.id;

  // Create admin in tenant 1
  const admin = await prisma.user.create({
    data: {
      tenantId,
      name: 'ML Test Admin',
      phone: '5000000001',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });
  adminUserId = admin.id;

  // Create collector in tenant 1
  await prisma.user.create({
    data: {
      tenantId,
      name: 'ML Test Collector',
      phone: '5000000002',
      passwordHash: await bcrypt.hash('Collector@123', 12),
      role: 'COLLECTOR',
    },
  });

  // Create admin in tenant 2
  await prisma.user.create({
    data: {
      tenantId: tenantId2,
      name: 'Tenant2 ML Admin',
      phone: '5000000003',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });

  // Login all users
  const adminLogin = await request.post('/api/v1/auth/login').send({ phone: '5000000001', password: 'Admin@123' });
  adminAccessToken = adminLogin.body.data.access_token;

  const collectorLogin = await request.post('/api/v1/auth/login').send({ phone: '5000000002', password: 'Collector@123' });
  collectorAccessToken = collectorLogin.body.data.access_token;

  const tenant2AdminLogin = await request.post('/api/v1/auth/login').send({ phone: '5000000003', password: 'Admin@123' });
  tenant2AdminAccessToken = tenant2AdminLogin.body.data.access_token;

  // Create borrower customers
  const b1 = await prisma.customer.create({
    data: { tenantId, fullName: 'ML Borrower One', phone: '5000100001', createdById: adminUserId },
  });
  borrower1Id = b1.id;

  const b2 = await prisma.customer.create({
    data: { tenantId, fullName: 'ML Borrower Two', phone: '5000100002', createdById: adminUserId },
  });
  borrower2Id = b2.id;

  // Create guarantor customer
  const g = await prisma.customer.create({
    data: { tenantId, fullName: 'ML Guarantor', phone: '5000100003', createdById: adminUserId },
  });
  guarantorId = g.id;
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('ml-test-tenant', 'ml-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('ml-test-tenant', 'ml-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('ml-test-tenant', 'ml-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('ml-test-tenant', 'ml-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('ml-test-tenant', 'ml-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '5000%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '5000%'`;
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, tenantId2] } } });
  await prisma.$disconnect();
});

// ─── POST /loans — Disbursement ───────────────────────────────────────────

describe('POST /api/v1/loans', () => {
  // Primary loan: disbursed Dec 15, 2025 so Jan 2026 cycle exists at test time (Jan 31 2026)
  it('creates a monthly loan with correct fields (201)', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower1Id,
        principal_amount: 100000,
        interest_rate: 2.5,
        disbursement_date: '2025-12-15',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.loanType).toBe('MONTHLY');
    expect(res.body.data.borrowerId).toBe(borrower1Id);
    expect(res.body.data.borrowerName).toBe('ML Borrower One');
    expect(res.body.data.principalAmount).toBe(100000);
    expect(res.body.data.interestRate).toBe(2.5);
    expect(res.body.data.disbursementDate).toBe('2025-12-15');
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.remainingPrincipal).toBe(100000);
    expect(res.body.data.billingPrincipal).toBe(100000);
    expect(res.body.data.advanceInterestAmount).toBe(2500);
    expect(res.body.data.monthlyDueDay).toBe(15);
    expect(res.body.data.loanNumber).toMatch(/^ML-2025-\d{4}$/);

    firstLoanId = res.body.data.id;
    firstLoanNumber = res.body.data.loanNumber;
  });

  it('creates DISBURSEMENT + ADVANCE_INTEREST transactions atomically', async () => {
    const res = await request
      .get(`/api/v1/loans/${firstLoanId}/transactions`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    const types = res.body.data.map((t: { transactionType: string }) => t.transactionType);
    expect(types).toContain('DISBURSEMENT');
    expect(types).toContain('ADVANCE_INTEREST');

    const disbursement = res.body.data.find((t: { transactionType: string }) => t.transactionType === 'DISBURSEMENT');
    expect(disbursement.amount).toBe(100000);

    const advanceInterest = res.body.data.find((t: { transactionType: string }) => t.transactionType === 'ADVANCE_INTEREST');
    expect(advanceInterest.amount).toBe(2500);
  });

  it('generates sequential loan numbers', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower2Id,
        principal_amount: 50000,
        interest_rate: 3,
        disbursement_date: '2025-12-10',
      });

    expect(res.status).toBe(201);
    // Both in same year (2025) → sequential
    const firstSeq = parseInt(firstLoanNumber.split('-')[2]!);
    const secondSeq = parseInt(res.body.data.loanNumber.split('-')[2]!);
    expect(secondSeq).toBe(firstSeq + 1);
  });

  it('validates borrower exists (404)', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: '00000000-0000-0000-0000-000000000000',
        principal_amount: 100000,
        interest_rate: 2.5,
        disbursement_date: '2025-12-15',
      });

    expect(res.status).toBe(404);
  });

  it('validates guarantor exists (404)', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower1Id,
        principal_amount: 100000,
        interest_rate: 2.5,
        disbursement_date: '2025-12-15',
        guarantor_id: '00000000-0000-0000-0000-000000000000',
      });

    expect(res.status).toBe(404);
  });

  it('rejects borrower same as guarantor (400)', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower1Id,
        principal_amount: 100000,
        interest_rate: 2.5,
        disbursement_date: '2025-12-15',
        guarantor_id: borrower1Id,
      });

    expect(res.status).toBe(400);
  });

  it('rejects invalid date format (400)', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower1Id,
        principal_amount: 100000,
        interest_rate: 2.5,
        disbursement_date: '01-15-2025',
      });

    expect(res.status).toBe(400);
  });

  it('collector cannot create (403)', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower1Id,
        principal_amount: 100000,
        interest_rate: 2.5,
        disbursement_date: '2025-12-15',
      });

    expect(res.status).toBe(403);
  });

  it('enforces tenant isolation on borrower lookup', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${tenant2AdminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower1Id,
        principal_amount: 100000,
        interest_rate: 2.5,
        disbursement_date: '2025-12-15',
      });

    expect(res.status).toBe(404);
  });

  it('accepts optional fields (expected_months, collateral, guarantor, notes)', async () => {
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower1Id,
        principal_amount: 200000,
        interest_rate: 2,
        disbursement_date: '2025-11-20',
        expected_months: 12,
        guarantor_id: guarantorId,
        collateral_description: 'Gold necklace',
        collateral_estimated_value: 50000,
        notes: 'Test loan with all fields',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.expectedMonths).toBe(12);
    expect(res.body.data.guarantorId).toBe(guarantorId);
    expect(res.body.data.guarantorName).toBe('ML Guarantor');
    expect(res.body.data.collateralDescription).toBe('Gold necklace');
    expect(res.body.data.collateralEstimatedValue).toBe(50000);
    expect(res.body.data.notes).toBe('Test loan with all fields');
  });
});

// ─── GET /loans — List ────────────────────────────────────────────────────

describe('GET /api/v1/loans', () => {
  it('lists loans with pagination', async () => {
    const res = await request
      .get('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
  });

  it('filters by type', async () => {
    const res = await request
      .get('/api/v1/loans?type=MONTHLY')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    for (const loan of res.body.data) {
      expect(loan.loanType).toBe('MONTHLY');
    }
  });

  it('filters by status', async () => {
    const res = await request
      .get('/api/v1/loans?status=ACTIVE')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    for (const loan of res.body.data) {
      expect(loan.status).toBe('ACTIVE');
    }
  });

  it('filters by borrower_id', async () => {
    const res = await request
      .get(`/api/v1/loans?borrower_id=${borrower1Id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    for (const loan of res.body.data) {
      expect(loan.borrowerId).toBe(borrower1Id);
    }
  });

  it('searches by loan number', async () => {
    const res = await request
      .get(`/api/v1/loans?search=${firstLoanNumber}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].loanNumber).toBe(firstLoanNumber);
  });

  it('collector can list', async () => {
    const res = await request
      .get('/api/v1/loans')
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(200);
  });

  it('enforces tenant isolation', async () => {
    const res = await request
      .get('/api/v1/loans')
      .set('Authorization', `Bearer ${tenant2AdminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });

  it('rejects unauthenticated request (401)', async () => {
    const res = await request.get('/api/v1/loans');
    expect(res.status).toBe(401);
  });
});

// ─── GET /loans/:id — Detail with computed fields ─────────────────────────

describe('GET /api/v1/loans/:id', () => {
  it('returns all stored + computed fields', async () => {
    const res = await request
      .get(`/api/v1/loans/${firstLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(firstLoanId);
    expect(res.body.data.loanNumber).toBe(firstLoanNumber);
    // Stored fields
    expect(res.body.data.principalAmount).toBe(100000);
    expect(res.body.data.interestRate).toBe(2.5);
    expect(res.body.data.remainingPrincipal).toBe(100000);
    expect(res.body.data.billingPrincipal).toBe(100000);
    // Computed fields
    expect(typeof res.body.data.monthlyInterestDue).toBe('number');
    expect(typeof res.body.data.nextDueDate).toBe('string');
    expect(typeof res.body.data.isOverdue).toBe('boolean');
    expect(typeof res.body.data.totalInterestCollected).toBe('number');
    expect(typeof res.body.data.monthsActive).toBe('number');
  });

  it('monthlyInterestDue = billingPrincipal * rate / 100', async () => {
    const res = await request
      .get(`/api/v1/loans/${firstLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    // 100000 * 2.5 / 100 = 2500
    expect(res.body.data.monthlyInterestDue).toBe(2500);
  });

  it('returns 404 for non-existent loan', async () => {
    const res = await request
      .get('/api/v1/loans/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for cross-tenant access', async () => {
    const res = await request
      .get(`/api/v1/loans/${firstLoanId}`)
      .set('Authorization', `Bearer ${tenant2AdminAccessToken}`);

    expect(res.status).toBe(404);
  });

  it('collector can view loan detail', async () => {
    const res = await request
      .get(`/api/v1/loans/${firstLoanId}`)
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(200);
  });
});

// ─── POST /transactions — Interest Payment ────────────────────────────────

describe('POST /api/v1/transactions — Interest Payment', () => {
  it('exact interest payment creates single INTEREST_PAYMENT', async () => {
    // Pay Jan 2026 cycle for firstLoan (disbursed Dec 15, 2025)
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: firstLoanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 2500,
        transaction_date: '2026-01-15',
        effective_date: '2026-01-15',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].transactionType).toBe('INTEREST_PAYMENT');
    expect(res.body.data[0].amount).toBe(2500);
  });

  it('underpayment: full amount as INTEREST_PAYMENT, cycle unsettled', async () => {
    // Create a new loan disbursed Nov 10, 2025 so Dec 2025 + Jan 2026 cycles exist
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower2Id,
        principal_amount: 80000,
        interest_rate: 2,
        disbursement_date: '2025-11-10',
      });
    const loanId = loanRes.body.data.id;

    // Underpay Dec cycle (interest due = 80000 * 2 / 100 = 1600)
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 1000,
        transaction_date: '2025-12-10',
        effective_date: '2025-12-10',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].transactionType).toBe('INTEREST_PAYMENT');
    expect(res.body.data[0].amount).toBe(1000);

    // Check payment status — Dec cycle should be unsettled
    const statusRes = await request
      .get(`/api/v1/loans/${loanId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const decCycle = statusRes.body.data.cycles.find(
      (c: { cycleYear: number; cycleMonth: number }) => c.cycleYear === 2025 && c.cycleMonth === 12,
    );
    expect(decCycle).toBeDefined();
    expect(decCycle.isSettled).toBe(false);
    expect(decCycle.interestPaid).toBe(1000);
  });

  it('overpayment auto-splits into INTEREST_PAYMENT + PRINCIPAL_RETURN', async () => {
    // Loan disbursed Nov 5, 2025 → Dec cycle exists
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower1Id,
        principal_amount: 50000,
        interest_rate: 2,
        disbursement_date: '2025-11-05',
      });
    const loanId = loanRes.body.data.id;
    // Interest due = 50000 * 2 / 100 = 1000

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 6000,
        transaction_date: '2025-12-05',
        effective_date: '2025-12-05',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.length).toBe(2);

    const interestTxn = res.body.data.find(
      (t: { transactionType: string }) => t.transactionType === 'INTEREST_PAYMENT',
    );
    expect(interestTxn.amount).toBe(1000);

    const principalTxn = res.body.data.find(
      (t: { transactionType: string }) => t.transactionType === 'PRINCIPAL_RETURN',
    );
    expect(principalTxn.amount).toBe(5000);

    // Verify remaining principal decremented
    const loanDetail = await request
      .get(`/api/v1/loans/${loanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(loanDetail.body.data.remainingPrincipal).toBe(45000);
  });

  it('auto-split Decimal precision (no rounding loss)', async () => {
    // Loan disbursed Nov 1, 2025 → Dec cycle exists
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower2Id,
        principal_amount: 33333,
        interest_rate: 3,
        disbursement_date: '2025-11-01',
      });
    const loanId = loanRes.body.data.id;
    // Interest due = 33333 * 3 / 100 = 999.99

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 1500,
        transaction_date: '2025-12-01',
        effective_date: '2025-12-01',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.length).toBe(2);

    const interestTxn = res.body.data.find(
      (t: { transactionType: string }) => t.transactionType === 'INTEREST_PAYMENT',
    );
    expect(interestTxn.amount).toBe(999.99);

    const principalTxn = res.body.data.find(
      (t: { transactionType: string }) => t.transactionType === 'PRINCIPAL_RETURN',
    );
    expect(principalTxn.amount).toBe(500.01);

    // Verify: 999.99 + 500.01 = 1500 exactly
    expect(interestTxn.amount + principalTxn.amount).toBe(1500);
  });

  it('overpayment exceeding remaining principal rejected (400)', async () => {
    // Loan disbursed Nov 1, 2025 with small principal
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower1Id,
        principal_amount: 1000,
        interest_rate: 5,
        disbursement_date: '2025-11-01',
      });
    const loanId = loanRes.body.data.id;
    // Interest due = 1000 * 5 / 100 = 50
    // Overpayment of 2000 → principal portion = 1950, but only 1000 remaining

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 2000,
        transaction_date: '2025-12-01',
        effective_date: '2025-12-01',
      });

    expect(res.status).toBe(400);
  });

  it('effective_date required for INTEREST_PAYMENT (400)', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: firstLoanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 2500,
        transaction_date: '2026-01-15',
      });

    expect(res.status).toBe(400);
  });

  it('loan must be ACTIVE (404 for non-existent)', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: '00000000-0000-0000-0000-000000000000',
        transaction_type: 'INTEREST_PAYMENT',
        amount: 2500,
        transaction_date: '2026-01-15',
        effective_date: '2026-01-15',
      });

    expect(res.status).toBe(404);
  });
});

// ─── POST /transactions — Principal Return ────────────────────────────────

describe('POST /api/v1/transactions — Principal Return', () => {
  let prLoanId: string;

  beforeAll(async () => {
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower1Id,
        principal_amount: 20000,
        interest_rate: 2,
        disbursement_date: '2025-12-10',
      });
    prLoanId = loanRes.body.data.id;
  });

  it('records principal return and decrements remaining_principal', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: prLoanId,
        transaction_type: 'PRINCIPAL_RETURN',
        amount: 5000,
        transaction_date: '2026-01-10',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].transactionType).toBe('PRINCIPAL_RETURN');
    expect(res.body.data[0].amount).toBe(5000);

    // Verify remaining principal
    const loanDetail = await request
      .get(`/api/v1/loans/${prLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(loanDetail.body.data.remainingPrincipal).toBe(15000);
  });

  it('billing_principal unchanged after principal return', async () => {
    const loanDetail = await request
      .get(`/api/v1/loans/${prLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    // billingPrincipal should still be 20000 (original)
    expect(loanDetail.body.data.billingPrincipal).toBe(20000);
  });

  it('amount > remaining_principal rejected (400)', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: prLoanId,
        transaction_type: 'PRINCIPAL_RETURN',
        amount: 20000, // only 15000 remaining
        transaction_date: '2026-01-10',
      });

    expect(res.status).toBe(400);
  });

  it('principal_returns record created with snapshot', async () => {
    const returns = await prisma.principalReturn.findMany({
      where: { loanId: prLoanId, tenantId },
      orderBy: { createdAt: 'asc' },
    });

    expect(returns.length).toBeGreaterThanOrEqual(1);
    expect(Number(returns[0]!.amountReturned)).toBe(5000);
    expect(Number(returns[0]!.remainingPrincipalAfter)).toBe(15000);
  });
});

// ─── Billing Principal Lifecycle ──────────────────────────────────────────

describe('Billing Principal Lifecycle', () => {
  let bpLoanId: string;

  beforeAll(async () => {
    // Disburse Oct 15 2025, principal 100000, rate 2%
    // This gives us Nov, Dec 2025 and Jan 2026 cycles
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower2Id,
        principal_amount: 100000,
        interest_rate: 2,
        disbursement_date: '2025-10-15',
      });
    bpLoanId = loanRes.body.data.id;
  });

  it('billing_principal syncs at cycle boundary', async () => {
    // Return 30000 principal on Oct 20 (before Nov 1 → affects Nov cycle and beyond)
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: bpLoanId,
        transaction_type: 'PRINCIPAL_RETURN',
        amount: 30000,
        transaction_date: '2025-10-20',
      });

    // Nov cycle billing principal should be 70000 (100000 - 30000, return before Nov 1)
    // Interest for Nov = 70000 * 2 / 100 = 1400
    const novPayRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: bpLoanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 1400,
        transaction_date: '2025-11-15',
        effective_date: '2025-11-15',
      });

    expect(novPayRes.status).toBe(201);
    expect(novPayRes.body.data[0].amount).toBe(1400);

    // Check payment status for Nov cycle
    const statusRes = await request
      .get(`/api/v1/loans/${bpLoanId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const novCycle = statusRes.body.data.cycles.find(
      (c: { cycleYear: number; cycleMonth: number }) => c.cycleYear === 2025 && c.cycleMonth === 11,
    );
    expect(novCycle).toBeDefined();
    expect(novCycle.billingPrincipalForCycle).toBe(70000);
    expect(novCycle.interestDue).toBe(1400);
    expect(novCycle.isSettled).toBe(true);
  });

  it('mid-cycle principal return does not affect current cycle interest', async () => {
    // Return another 10000 on Dec 10 (mid December cycle)
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: bpLoanId,
        transaction_type: 'PRINCIPAL_RETURN',
        amount: 10000,
        transaction_date: '2025-12-10',
      });

    // Dec cycle billing principal should still be 70000 (last return before Dec 1 was Oct 20 → 70000)
    // The Dec 10 return happens after Dec 1, so it doesn't affect Dec billing
    const statusRes = await request
      .get(`/api/v1/loans/${bpLoanId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const decCycle = statusRes.body.data.cycles.find(
      (c: { cycleYear: number; cycleMonth: number }) => c.cycleYear === 2025 && c.cycleMonth === 12,
    );
    expect(decCycle).toBeDefined();
    expect(decCycle.billingPrincipalForCycle).toBe(70000);
    expect(decCycle.interestDue).toBe(1400);
  });
});

// ─── GET /loans/:id/payment-status ────────────────────────────────────────

describe('GET /api/v1/loans/:id/payment-status', () => {
  it('returns month-by-month cycles array', async () => {
    // firstLoan was disbursed Dec 15, 2025 → Jan 2026 cycle exists
    const res = await request
      .get(`/api/v1/loans/${firstLoanId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.loanId).toBe(firstLoanId);
    expect(res.body.data.loanNumber).toBe(firstLoanNumber);
    expect(Array.isArray(res.body.data.cycles)).toBe(true);
    expect(res.body.data.cycles.length).toBeGreaterThanOrEqual(1);

    const cycle = res.body.data.cycles[0];
    expect(cycle.cycleYear).toBeDefined();
    expect(cycle.cycleMonth).toBeDefined();
    expect(cycle.dueDate).toBeDefined();
    expect(typeof cycle.interestDue).toBe('number');
    expect(typeof cycle.interestPaid).toBe('number');
    expect(typeof cycle.interestWaived).toBe('number');
    expect(typeof cycle.isSettled).toBe('boolean');
    expect(typeof cycle.billingPrincipalForCycle).toBe('number');
  });

  it('settled cycle has isSettled=true', async () => {
    // We already paid 2500 for the first loan's Jan 2026 cycle
    const res = await request
      .get(`/api/v1/loans/${firstLoanId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const janCycle = res.body.data.cycles.find(
      (c: { cycleYear: number; cycleMonth: number }) => c.cycleYear === 2026 && c.cycleMonth === 1,
    );
    expect(janCycle).toBeDefined();
    expect(janCycle.isSettled).toBe(true);
    expect(janCycle.interestPaid).toBe(2500);
  });

  it('returns 404 for non-existent loan', async () => {
    const res = await request
      .get('/api/v1/loans/00000000-0000-0000-0000-000000000000/payment-status')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(404);
  });
});

// ─── PATCH /loans/:id/close ───────────────────────────────────────────────

describe('PATCH /api/v1/loans/:id/close', () => {
  let closeLoanId: string;

  beforeAll(async () => {
    // Create a loan disbursed Nov 15, 2025 with small principal
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower1Id,
        principal_amount: 10000,
        interest_rate: 2,
        disbursement_date: '2025-11-15',
      });
    closeLoanId = loanRes.body.data.id;

    // Return all principal on Nov 20 (before Dec 1)
    // This means all subsequent cycles have billingPrincipal = 0 → interest = 0 → auto-settled
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: closeLoanId,
        transaction_type: 'PRINCIPAL_RETURN',
        amount: 10000,
        transaction_date: '2025-11-20',
      });
  });

  it('full lifecycle: close after all principal returned and cycles settled', async () => {
    const res = await request
      .patch(`/api/v1/loans/${closeLoanId}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CLOSED');
    expect(res.body.data.closureDate).toBeDefined();
  });

  it('rejects when remaining_principal > 0 (400)', async () => {
    // firstLoanId still has 100000 remaining
    const res = await request
      .patch(`/api/v1/loans/${firstLoanId}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(400);
  });

  it('rejects when unsettled cycles exist (400)', async () => {
    // Create loan disbursed Oct 15, return principal after Nov 1 so Nov cycle has interest due
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower2Id,
        principal_amount: 5000,
        interest_rate: 2,
        disbursement_date: '2025-10-15',
      });
    const loanId = loanRes.body.data.id;

    // Return all principal on Nov 10 (after Nov 1, so Nov cycle billingPrincipal = 5000)
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanId,
        transaction_type: 'PRINCIPAL_RETURN',
        amount: 5000,
        transaction_date: '2025-11-10',
      });

    // Nov cycle: billingPrincipal = 5000 (no returns before Nov 1), interest = 100
    // We haven't paid interest, so Nov cycle is unsettled
    const closeRes = await request
      .patch(`/api/v1/loans/${loanId}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(closeRes.status).toBe(400);
  });

  it('collector cannot close (403)', async () => {
    const res = await request
      .patch(`/api/v1/loans/${firstLoanId}/close`)
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(403);
  });

  it('cross-tenant returns 404', async () => {
    const res = await request
      .patch(`/api/v1/loans/${firstLoanId}/close`)
      .set('Authorization', `Bearer ${tenant2AdminAccessToken}`);

    expect(res.status).toBe(404);
  });
});

// ─── Due Date Computation ─────────────────────────────────────────────────

describe('Due Date Computation', () => {
  it('nextDueDate handles short months (day 31 → Feb 28)', async () => {
    // Create loan with disbursement on day 31, in Oct 2025 so we get Nov, Dec, Jan cycles
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower1Id,
        principal_amount: 10000,
        interest_rate: 1,
        disbursement_date: '2025-10-31',
      });

    expect(loanRes.status).toBe(201);
    expect(loanRes.body.data.monthlyDueDay).toBe(31);

    const loanId = loanRes.body.data.id;

    // Check payment status — Nov 2025 should be Nov 30 (30 days in Nov)
    const statusRes = await request
      .get(`/api/v1/loans/${loanId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const novCycle = statusRes.body.data.cycles.find(
      (c: { cycleYear: number; cycleMonth: number }) => c.cycleYear === 2025 && c.cycleMonth === 11,
    );
    expect(novCycle).toBeDefined();
    expect(novCycle.dueDate).toBe('2025-11-30');

    const decCycle = statusRes.body.data.cycles.find(
      (c: { cycleYear: number; cycleMonth: number }) => c.cycleYear === 2025 && c.cycleMonth === 12,
    );
    expect(decCycle).toBeDefined();
    expect(decCycle.dueDate).toBe('2025-12-31');

    const janCycle = statusRes.body.data.cycles.find(
      (c: { cycleYear: number; cycleMonth: number }) => c.cycleYear === 2026 && c.cycleMonth === 1,
    );
    expect(janCycle).toBeDefined();
    expect(janCycle.dueDate).toBe('2026-01-31');
  });

  it('bounces back after short month (Feb 28 → Mar 31)', async () => {
    // Disbursement Dec 31 2024 so we get Jan, Feb, Mar ... cycles in 2025
    // and they're all in the past by Jan 31 2026
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower2Id,
        principal_amount: 10000,
        interest_rate: 1,
        disbursement_date: '2024-12-31',
      });

    const loanId = loanRes.body.data.id;

    const statusRes = await request
      .get(`/api/v1/loans/${loanId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const janCycle = statusRes.body.data.cycles.find(
      (c: { cycleYear: number; cycleMonth: number }) => c.cycleYear === 2025 && c.cycleMonth === 1,
    );
    expect(janCycle).toBeDefined();
    expect(janCycle.dueDate).toBe('2025-01-31');

    const febCycle = statusRes.body.data.cycles.find(
      (c: { cycleYear: number; cycleMonth: number }) => c.cycleYear === 2025 && c.cycleMonth === 2,
    );
    expect(febCycle).toBeDefined();
    expect(febCycle.dueDate).toBe('2025-02-28');

    const marCycle = statusRes.body.data.cycles.find(
      (c: { cycleYear: number; cycleMonth: number }) => c.cycleYear === 2025 && c.cycleMonth === 3,
    );
    expect(marCycle).toBeDefined();
    // Mar should bounce back to 31
    expect(marCycle.dueDate).toBe('2025-03-31');
  });
});
