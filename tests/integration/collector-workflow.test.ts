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
let collectorAccessToken: string;
let tenant2AdminAccessToken: string;
let adminUserId: string;
let collectorUserId: string;
let borrower1Id: string;
let borrower2Id: string;
let guarantorId: string;
let monthlyLoanId: string;
let dailyLoanId: string;
let dailyLoan2Id: string;

beforeAll(async () => {
  // Clean up any leftover test data
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('cw-test-tenant', 'cw-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('cw-test-tenant', 'cw-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('cw-test-tenant', 'cw-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('cw-test-tenant', 'cw-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('cw-test-tenant', 'cw-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "idempotency_keys" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('cw-test-tenant', 'cw-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '8100%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '8100%'`;
  await prisma.tenant.deleteMany({ where: { slug: { in: ['cw-test-tenant', 'cw-test-tenant-2'] } } });

  // Create tenants
  const tenant = await prisma.tenant.create({
    data: { name: 'CW Test Tenant', slug: 'cw-test-tenant', ownerName: 'Owner', ownerPhone: '8100000000' },
  });
  tenantId = tenant.id;

  const tenant2 = await prisma.tenant.create({
    data: { name: 'CW Test Tenant 2', slug: 'cw-test-tenant-2', ownerName: 'Owner 2', ownerPhone: '8100000099' },
  });
  tenantId2 = tenant2.id;

  // Create admin in tenant 1
  const admin = await prisma.user.create({
    data: {
      tenantId,
      name: 'CW Test Admin',
      phone: '8100000001',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });
  adminUserId = admin.id;

  // Create collector in tenant 1
  const collector = await prisma.user.create({
    data: {
      tenantId,
      name: 'CW Test Collector',
      phone: '8100000002',
      passwordHash: await bcrypt.hash('Collector@123', 12),
      role: 'COLLECTOR',
    },
  });
  collectorUserId = collector.id;

  // Create admin in tenant 2
  await prisma.user.create({
    data: {
      tenantId: tenantId2,
      name: 'Tenant2 CW Admin',
      phone: '8100000003',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });

  // Login all users
  const adminLogin = await request.post('/api/v1/auth/login').send({ phone: '8100000001', password: 'Admin@123' });
  adminAccessToken = adminLogin.body.data.access_token;

  const collectorLogin = await request.post('/api/v1/auth/login').send({ phone: '8100000002', password: 'Collector@123' });
  collectorAccessToken = collectorLogin.body.data.access_token;

  const tenant2AdminLogin = await request.post('/api/v1/auth/login').send({ phone: '8100000003', password: 'Admin@123' });
  tenant2AdminAccessToken = tenant2AdminLogin.body.data.access_token;

  // Create borrower customers
  const b1 = await prisma.customer.create({
    data: { tenantId, fullName: 'CW Borrower One', phone: '8100100001', createdById: adminUserId },
  });
  borrower1Id = b1.id;

  const b2 = await prisma.customer.create({
    data: { tenantId, fullName: 'CW Borrower Two', phone: '8100100002', createdById: adminUserId },
  });
  borrower2Id = b2.id;

  // Create guarantor customer
  const g = await prisma.customer.create({
    data: { tenantId, fullName: 'CW Guarantor', phone: '8100100003', createdById: adminUserId },
  });
  guarantorId = g.id;

  // Create an active MONTHLY loan (principal=100000, rate=2%)
  const monthlyRes = await request
    .post('/api/v1/loans')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'MONTHLY',
      borrower_id: borrower1Id,
      principal_amount: 100000,
      interest_rate: 2,
      disbursement_date: '2026-01-01',
      guarantor_id: guarantorId,
    });
  monthlyLoanId = monthlyRes.body.data.id;

  // Create an active DAILY loan (principal=10000, rate=10%, term=100 days)
  const dailyRes = await request
    .post('/api/v1/loans')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'DAILY',
      borrower_id: borrower2Id,
      principal_amount: 10000,
      interest_rate: 10,
      disbursement_date: '2026-01-01',
      term_days: 100,
    });
  dailyLoanId = dailyRes.body.data.id;

  // Create a second DAILY loan for bulk testing
  const dailyRes2 = await request
    .post('/api/v1/loans')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'DAILY',
      borrower_id: borrower1Id,
      principal_amount: 5000,
      interest_rate: 10,
      disbursement_date: '2026-01-01',
      term_days: 100,
    });
  dailyLoan2Id = dailyRes2.body.data.id;
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('cw-test-tenant', 'cw-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('cw-test-tenant', 'cw-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('cw-test-tenant', 'cw-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('cw-test-tenant', 'cw-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('cw-test-tenant', 'cw-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "idempotency_keys" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('cw-test-tenant', 'cw-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '8100%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '8100%'`;
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, tenantId2] } } });
  await prisma.$disconnect();
});

// ─── Collector Transaction Submission — POST /transactions ─────────────────

describe('Collector Transaction Submission — POST /transactions', () => {
  let pendingDailyTxnId: string;
  let pendingInterestTxnId: string;
  let pendingPrincipalTxnId: string;

  it('Collector creates DAILY_COLLECTION on active DAILY loan → 201, PENDING', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: dailyLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 500,
        transaction_date: '2026-01-02',
        notes: 'Collector daily',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].approvalStatus).toBe('PENDING');
    expect(res.body.data[0].transactionType).toBe('DAILY_COLLECTION');
    pendingDailyTxnId = res.body.data[0].id;
  });

  it('Collector creates INTEREST_PAYMENT on active MONTHLY loan → 201, PENDING', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: monthlyLoanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 2000,
        transaction_date: '2026-02-01',
        effective_date: '2026-02-01',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].approvalStatus).toBe('PENDING');
    expect(res.body.data[0].transactionType).toBe('INTEREST_PAYMENT');
    pendingInterestTxnId = res.body.data[0].id;
  });

  it('Collector creates PRINCIPAL_RETURN on active MONTHLY loan → 201, PENDING', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: monthlyLoanId,
        transaction_type: 'PRINCIPAL_RETURN',
        amount: 5000,
        transaction_date: '2026-02-01',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].approvalStatus).toBe('PENDING');
    expect(res.body.data[0].transactionType).toBe('PRINCIPAL_RETURN');
    pendingPrincipalTxnId = res.body.data[0].id;
  });

  it('PENDING transaction does NOT change totalCollected', async () => {
    const loanRes = await request
      .get(`/api/v1/loans/${dailyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(loanRes.body.data.totalCollected).toBe(0);
  });

  it('PENDING transaction does NOT change remainingPrincipal', async () => {
    const loanRes = await request
      .get(`/api/v1/loans/${monthlyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(loanRes.body.data.remainingPrincipal).toBe(100000);
  });

  it('collectedById set from collector JWT', async () => {
    const txn = await prisma.transaction.findUnique({
      where: { id: pendingDailyTxnId },
      select: { collectedById: true },
    });
    expect(txn!.collectedById).toBe(collectorUserId);
  });

  it('Collector creates on CLOSED loan → 400', async () => {
    // Create a loan and close it
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 1000,
        interest_rate: 10,
        disbursement_date: '2026-01-01',
        term_days: 10,
      });
    const closableLoanId = loanRes.body.data.id;
    const totalRepayment = loanRes.body.data.totalRepaymentAmount;

    // Pay it off
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: closableLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: totalRepayment,
        transaction_date: '2026-01-02',
      });

    // Close it
    await request
      .patch(`/api/v1/loans/${closableLoanId}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    // Collector tries to record on closed loan
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: closableLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 100,
        transaction_date: '2026-01-03',
      });

    expect(res.status).toBe(400);
  });

  it('Collector creates on CANCELLED loan → 400', async () => {
    // Create a loan and cancel it
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 1000,
        interest_rate: 10,
        disbursement_date: '2026-01-01',
        term_days: 10,
      });
    const cancelLoanId = loanRes.body.data.id;

    // Cancel it directly via prisma
    await prisma.loan.update({
      where: { id: cancelLoanId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: 'test' },
    });

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: cancelLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 100,
        transaction_date: '2026-01-03',
      });

    expect(res.status).toBe(400);
  });

  it('Collector creates on DEFAULTED loan → 201, PENDING (recovery payments valid)', async () => {
    // Create a loan and mark it DEFAULTED
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 1000,
        interest_rate: 10,
        disbursement_date: '2026-01-01',
        term_days: 10,
      });
    const defaultedLoanId = loanRes.body.data.id;

    // Mark as DEFAULTED directly via prisma
    await prisma.loan.update({
      where: { id: defaultedLoanId },
      data: { status: 'DEFAULTED', defaultedAt: new Date() },
    });

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: defaultedLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 100,
        transaction_date: '2026-01-03',
      });

    expect(res.status).toBe(201);
    expect(res.body.data[0].approvalStatus).toBe('PENDING');
  });

  it('DAILY_COLLECTION on MONTHLY loan → 400', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: monthlyLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 500,
        transaction_date: '2026-02-01',
      });

    expect(res.status).toBe(400);
  });

  it('INTEREST_PAYMENT on DAILY loan → 400', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: dailyLoanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 500,
        transaction_date: '2026-02-01',
        effective_date: '2026-02-01',
      });

    expect(res.status).toBe(400);
  });

  it('INTEREST_PAYMENT without effective_date → 400', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: monthlyLoanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 2000,
        transaction_date: '2026-02-01',
      });

    expect(res.status).toBe(400);
  });

  it('Non-existent loan → 404', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: '00000000-0000-0000-0000-000000000000',
        transaction_type: 'DAILY_COLLECTION',
        amount: 500,
        transaction_date: '2026-01-02',
      });

    expect(res.status).toBe(404);
  });
});

// ─── Admin Direct Recording — POST /transactions ──────────────────────────

describe('Admin Direct Recording — POST /transactions', () => {
  it('Admin creates DAILY_COLLECTION → 201, APPROVED, totalCollected incremented', async () => {
    const loanBefore = await request
      .get(`/api/v1/loans/${dailyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    const collectedBefore = loanBefore.body.data.totalCollected;

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: dailyLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 500,
        transaction_date: '2026-01-03',
      });

    expect(res.status).toBe(201);
    expect(res.body.data[0].approvalStatus).toBe('APPROVED');

    const loanAfter = await request
      .get(`/api/v1/loans/${dailyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(loanAfter.body.data.totalCollected).toBe(collectedBefore + 500);
  });

  it('Admin creates PRINCIPAL_RETURN → 201, APPROVED, remainingPrincipal decremented', async () => {
    const loanBefore = await request
      .get(`/api/v1/loans/${monthlyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    const rpBefore = loanBefore.body.data.remainingPrincipal;

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: monthlyLoanId,
        transaction_type: 'PRINCIPAL_RETURN',
        amount: 1000,
        transaction_date: '2026-02-01',
      });

    expect(res.status).toBe(201);
    expect(res.body.data[0].approvalStatus).toBe('APPROVED');

    const loanAfter = await request
      .get(`/api/v1/loans/${monthlyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(loanAfter.body.data.remainingPrincipal).toBe(rpBefore - 1000);
  });

  it('Admin creates INTEREST_PAYMENT → 201, APPROVED', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: monthlyLoanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 1000,
        transaction_date: '2026-02-01',
        effective_date: '2026-02-01',
      });

    expect(res.status).toBe(201);
    expect(res.body.data[0].approvalStatus).toBe('APPROVED');
  });

  it('Admin overpayment auto-split still works → 201, 2 transactions', async () => {
    // Get current remaining principal
    const loanBefore = await request
      .get(`/api/v1/loans/${monthlyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    // Interest due = billingPrincipal * rate / 100
    const interestDue = loanBefore.body.data.billingPrincipal * 0.02;
    const overpayAmount = interestDue + 500;

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: monthlyLoanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: overpayAmount,
        transaction_date: '2026-02-15',
        effective_date: '2026-02-01',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].transactionType).toBe('INTEREST_PAYMENT');
    expect(res.body.data[1].transactionType).toBe('PRINCIPAL_RETURN');
    expect(res.body.data[0].approvalStatus).toBe('APPROVED');
    expect(res.body.data[1].approvalStatus).toBe('APPROVED');
  });
});

// ─── Admin Approval — PATCH /transactions/:id/approve ─────────────────────

describe('Admin Approval — PATCH /transactions/:id/approve', () => {
  let approveDailyTxnId: string;
  let approvePrincipalTxnId: string;
  let approveInterestTxnId: string;

  // Create fresh PENDING transactions for approval tests
  beforeAll(async () => {
    const dailyRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: dailyLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 200,
        transaction_date: '2026-01-05',
      });
    approveDailyTxnId = dailyRes.body.data[0].id;

    const principalRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: monthlyLoanId,
        transaction_type: 'PRINCIPAL_RETURN',
        amount: 1000,
        transaction_date: '2026-02-05',
      });
    approvePrincipalTxnId = principalRes.body.data[0].id;

    const interestRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: monthlyLoanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 500,
        transaction_date: '2026-02-05',
        effective_date: '2026-02-01',
      });
    approveInterestTxnId = interestRes.body.data[0].id;
  });

  it('Approve PENDING DAILY_COLLECTION → 200, totalCollected updated', async () => {
    const loanBefore = await request
      .get(`/api/v1/loans/${dailyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    const collectedBefore = loanBefore.body.data.totalCollected;

    const res = await request
      .patch(`/api/v1/transactions/${approveDailyTxnId}/approve`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.approvalStatus).toBe('APPROVED');

    const loanAfter = await request
      .get(`/api/v1/loans/${dailyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(loanAfter.body.data.totalCollected).toBe(collectedBefore + 200);
  });

  it('Approve PENDING PRINCIPAL_RETURN → 200, remainingPrincipal updated, principalReturn record created', async () => {
    const loanBefore = await request
      .get(`/api/v1/loans/${monthlyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    const rpBefore = loanBefore.body.data.remainingPrincipal;

    const res = await request
      .patch(`/api/v1/transactions/${approvePrincipalTxnId}/approve`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.approvalStatus).toBe('APPROVED');

    const loanAfter = await request
      .get(`/api/v1/loans/${monthlyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(loanAfter.body.data.remainingPrincipal).toBe(rpBefore - 1000);

    // Verify principalReturn record exists
    const pr = await prisma.principalReturn.findFirst({
      where: { transactionId: approvePrincipalTxnId },
    });
    expect(pr).not.toBeNull();
    expect(Number(pr!.amountReturned)).toBe(1000);
  });

  it('Approve PENDING INTEREST_PAYMENT → 200, no loan-level change', async () => {
    const loanBefore = await request
      .get(`/api/v1/loans/${monthlyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const res = await request
      .patch(`/api/v1/transactions/${approveInterestTxnId}/approve`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.approvalStatus).toBe('APPROVED');

    const loanAfter = await request
      .get(`/api/v1/loans/${monthlyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(loanAfter.body.data.remainingPrincipal).toBe(loanBefore.body.data.remainingPrincipal);
  });

  it('approvedById and approvedAt set correctly', async () => {
    const txn = await prisma.transaction.findUnique({
      where: { id: approveDailyTxnId },
      select: { approvedById: true, approvedAt: true },
    });
    expect(txn!.approvedById).toBe(adminUserId);
    expect(txn!.approvedAt).not.toBeNull();
  });

  it('Double-approve → 409', async () => {
    const res = await request
      .patch(`/api/v1/transactions/${approveDailyTxnId}/approve`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(409);
  });

  it('Approve non-existent transaction → 404', async () => {
    const res = await request
      .patch('/api/v1/transactions/00000000-0000-0000-0000-000000000000/approve')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(404);
  });

  it('Approve cross-tenant transaction → 404', async () => {
    // Create a PENDING transaction in tenant 1
    const txnRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: dailyLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 100,
        transaction_date: '2026-01-06',
      });
    const txnId = txnRes.body.data[0].id;

    // Tenant 2 admin tries to approve it
    const res = await request
      .patch(`/api/v1/transactions/${txnId}/approve`)
      .set('Authorization', `Bearer ${tenant2AdminAccessToken}`);

    expect(res.status).toBe(404);
  });

  it('Approve already-rejected transaction → 409', async () => {
    // Create and reject a transaction
    const txnRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: dailyLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 100,
        transaction_date: '2026-01-07',
      });
    const txnId = txnRes.body.data[0].id;

    await request
      .patch(`/api/v1/transactions/${txnId}/reject`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ rejection_reason: 'Wrong amount' });

    const res = await request
      .patch(`/api/v1/transactions/${txnId}/approve`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(409);
  });

  it('Collector cannot approve → 403', async () => {
    const txnRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: dailyLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 100,
        transaction_date: '2026-01-08',
      });
    const txnId = txnRes.body.data[0].id;

    const res = await request
      .patch(`/api/v1/transactions/${txnId}/approve`)
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(403);
  });
});

// ─── Admin Rejection — PATCH /transactions/:id/reject ─────────────────────

describe('Admin Rejection — PATCH /transactions/:id/reject', () => {
  let rejectTxnId: string;

  beforeAll(async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: dailyLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 300,
        transaction_date: '2026-01-10',
      });
    rejectTxnId = res.body.data[0].id;
  });

  it('Reject PENDING transaction with reason → 200, REJECTED, rejectionReason stored', async () => {
    const res = await request
      .patch(`/api/v1/transactions/${rejectTxnId}/reject`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ rejection_reason: 'Amount is incorrect' });

    expect(res.status).toBe(200);
    expect(res.body.data.approvalStatus).toBe('REJECTED');
    expect(res.body.data.rejectionReason).toBe('Amount is incorrect');
  });

  it('No side effects on rejection (totalCollected unchanged)', async () => {
    // Get current totalCollected
    const loanRes = await request
      .get(`/api/v1/loans/${dailyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    // Create and reject a new transaction
    const txnRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: dailyLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 1000,
        transaction_date: '2026-01-11',
      });

    await request
      .patch(`/api/v1/transactions/${txnRes.body.data[0].id}/reject`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ rejection_reason: 'Wrong' });

    const loanAfter = await request
      .get(`/api/v1/loans/${dailyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(loanAfter.body.data.totalCollected).toBe(loanRes.body.data.totalCollected);
  });

  it('Double-reject → 409', async () => {
    const res = await request
      .patch(`/api/v1/transactions/${rejectTxnId}/reject`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ rejection_reason: 'Again' });

    expect(res.status).toBe(409);
  });

  it('Reject already-approved → 409', async () => {
    // Create and approve a transaction
    const txnRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: dailyLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 100,
        transaction_date: '2026-01-12',
      });
    const txnId = txnRes.body.data[0].id;

    await request
      .patch(`/api/v1/transactions/${txnId}/approve`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const res = await request
      .patch(`/api/v1/transactions/${txnId}/reject`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ rejection_reason: 'Too late' });

    expect(res.status).toBe(409);
  });

  it('rejection_reason required → 400', async () => {
    const txnRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: dailyLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 100,
        transaction_date: '2026-01-13',
      });
    const txnId = txnRes.body.data[0].id;

    const res = await request
      .patch(`/api/v1/transactions/${txnId}/reject`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('Collector cannot reject → 403', async () => {
    const txnRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: dailyLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 100,
        transaction_date: '2026-01-14',
      });
    const txnId = txnRes.body.data[0].id;

    const res = await request
      .patch(`/api/v1/transactions/${txnId}/reject`)
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({ rejection_reason: 'Try' });

    expect(res.status).toBe(403);
  });

  it('Reject non-existent → 404', async () => {
    const res = await request
      .patch('/api/v1/transactions/00000000-0000-0000-0000-000000000000/reject')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ rejection_reason: 'Missing' });

    expect(res.status).toBe(404);
  });
});

// ─── List Pending — GET /transactions/pending ─────────────────────────────

describe('List Pending — GET /transactions/pending', () => {
  it('Returns only PENDING transactions', async () => {
    const res = await request
      .get('/api/v1/transactions/pending')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const txn of res.body.data) {
      expect(txn.approvalStatus).toBe('PENDING');
    }
  });

  it('Includes loanNumber, borrowerName, collectorName', async () => {
    const res = await request
      .get('/api/v1/transactions/pending')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    const txn = res.body.data[0];
    expect(txn).toHaveProperty('loanNumber');
    expect(txn).toHaveProperty('borrowerName');
    expect(txn).toHaveProperty('collectorName');
    expect(txn.loanNumber).toBeTruthy();
    expect(txn.borrowerName).toBeTruthy();
    expect(txn.collectorName).toBe('CW Test Collector');
  });

  it('Pagination works', async () => {
    const res = await request
      .get('/api/v1/transactions/pending?page=1&limit=2')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.pagination).toHaveProperty('page', 1);
    expect(res.body.pagination).toHaveProperty('limit', 2);
    expect(res.body.pagination).toHaveProperty('total');
    expect(res.body.pagination).toHaveProperty('totalPages');
  });

  it('Tenant isolation', async () => {
    const res = await request
      .get('/api/v1/transactions/pending')
      .set('Authorization', `Bearer ${tenant2AdminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('Collector cannot access → 403', async () => {
    const res = await request
      .get('/api/v1/transactions/pending')
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(403);
  });
});

// ─── List Transactions — GET /transactions ────────────────────────────────

describe('List Transactions — GET /transactions', () => {
  it('Filter by approval_status', async () => {
    const res = await request
      .get('/api/v1/transactions?approval_status=APPROVED')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    for (const txn of res.body.data) {
      expect(txn.approvalStatus).toBe('APPROVED');
    }
  });

  it('Filter by transaction_type', async () => {
    const res = await request
      .get('/api/v1/transactions?transaction_type=DAILY_COLLECTION')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    for (const txn of res.body.data) {
      expect(txn.transactionType).toBe('DAILY_COLLECTION');
    }
  });

  it('Filter by loan_id', async () => {
    const res = await request
      .get(`/api/v1/transactions?loan_id=${dailyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    for (const txn of res.body.data) {
      expect(txn.loanId).toBe(dailyLoanId);
    }
  });

  it('Filter by collected_by', async () => {
    const res = await request
      .get(`/api/v1/transactions?collected_by=${collectorUserId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    for (const txn of res.body.data) {
      expect(txn.collectedById).toBe(collectorUserId);
    }
  });

  it('Collector cannot access → 403', async () => {
    const res = await request
      .get('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(403);
  });
});

// ─── Bulk Collection — POST /transactions/bulk ────────────────────────────

describe('Bulk Collection — POST /transactions/bulk', () => {
  it('Bulk with 3 valid items → 201, created=3, failed=0, all PENDING', async () => {
    const res = await request
      .post('/api/v1/transactions/bulk')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .set('Idempotency-Key', `bulk-test-${Date.now()}-1`)
      .send({
        collections: [
          { loan_id: dailyLoanId, amount: 100, transaction_date: '2026-01-15' },
          { loan_id: dailyLoanId, amount: 200, transaction_date: '2026-01-16' },
          { loan_id: dailyLoan2Id, amount: 150, transaction_date: '2026-01-15' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(3);
    expect(res.body.data.failed).toBe(0);
    expect(res.body.data.results).toHaveLength(3);
    for (const r of res.body.data.results) {
      expect(r.success).toBe(true);
      expect(r.transaction.approvalStatus).toBe('PENDING');
    }
  });

  it('Partial failure (1 invalid loan_id) → 201, created=2, failed=1', async () => {
    const res = await request
      .post('/api/v1/transactions/bulk')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .set('Idempotency-Key', `bulk-test-${Date.now()}-2`)
      .send({
        collections: [
          { loan_id: dailyLoanId, amount: 100, transaction_date: '2026-01-17' },
          { loan_id: '00000000-0000-0000-0000-000000000000', amount: 100, transaction_date: '2026-01-17' },
          { loan_id: dailyLoan2Id, amount: 100, transaction_date: '2026-01-17' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(2);
    expect(res.body.data.failed).toBe(1);
    expect(res.body.data.results[0].success).toBe(true);
    expect(res.body.data.results[1].success).toBe(false);
    expect(res.body.data.results[1].error).toBeTruthy();
    expect(res.body.data.results[2].success).toBe(true);
  });

  it('Missing Idempotency-Key header → 400', async () => {
    const res = await request
      .post('/api/v1/transactions/bulk')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        collections: [
          { loan_id: dailyLoanId, amount: 100, transaction_date: '2026-01-18' },
        ],
      });

    expect(res.status).toBe(400);
  });

  it('Replay same Idempotency-Key → cached response returned', async () => {
    const key = `bulk-replay-${Date.now()}`;

    const first = await request
      .post('/api/v1/transactions/bulk')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .set('Idempotency-Key', key)
      .send({
        collections: [
          { loan_id: dailyLoanId, amount: 100, transaction_date: '2026-01-19' },
        ],
      });

    expect(first.status).toBe(201);
    expect(first.body.data.created).toBe(1);

    // Replay
    const second = await request
      .post('/api/v1/transactions/bulk')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .set('Idempotency-Key', key)
      .send({
        collections: [
          { loan_id: dailyLoanId, amount: 999, transaction_date: '2026-01-19' },
        ],
      });

    expect(second.status).toBe(201);
    // Should return cached response from first call
    expect(second.body.data.created).toBe(1);
  });

  it('Different user with same key → 409', async () => {
    const key = `bulk-cross-user-${Date.now()}`;

    // First call from collector
    await request
      .post('/api/v1/transactions/bulk')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .set('Idempotency-Key', key)
      .send({
        collections: [
          { loan_id: dailyLoanId, amount: 100, transaction_date: '2026-01-20' },
        ],
      });

    // Create a second collector in tenant 1
    const collector2 = await prisma.user.create({
      data: {
        tenantId,
        name: 'CW Test Collector 2',
        phone: '8100000004',
        passwordHash: await bcrypt.hash('Collector@123', 12),
        role: 'COLLECTOR',
      },
    });
    const collector2Login = await request.post('/api/v1/auth/login').send({ phone: '8100000004', password: 'Collector@123' });
    const collector2Token = collector2Login.body.data.access_token;

    // Second call with different user
    const res = await request
      .post('/api/v1/transactions/bulk')
      .set('Authorization', `Bearer ${collector2Token}`)
      .set('Idempotency-Key', key)
      .send({
        collections: [
          { loan_id: dailyLoanId, amount: 100, transaction_date: '2026-01-20' },
        ],
      });

    expect(res.status).toBe(409);

    // Cleanup
    await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" = ${collector2.id}::uuid`;
    await prisma.user.delete({ where: { id: collector2.id } });
  });

  it('Admin cannot use bulk endpoint → 403', async () => {
    const res = await request
      .post('/api/v1/transactions/bulk')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .set('Idempotency-Key', `bulk-admin-${Date.now()}`)
      .send({
        collections: [
          { loan_id: dailyLoanId, amount: 100, transaction_date: '2026-01-21' },
        ],
      });

    expect(res.status).toBe(403);
  });

  it('Empty collections array → 400', async () => {
    const res = await request
      .post('/api/v1/transactions/bulk')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .set('Idempotency-Key', `bulk-empty-${Date.now()}`)
      .send({
        collections: [],
      });

    expect(res.status).toBe(400);
  });
});

// ─── Collector Visibility — GET /loans ────────────────────────────────────

describe('Collector Visibility — GET /loans', () => {
  let closedLoanId: string;

  beforeAll(async () => {
    // Create and close a daily loan to have a CLOSED loan in the system
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower2Id,
        principal_amount: 1000,
        interest_rate: 10,
        disbursement_date: '2026-01-01',
        term_days: 10,
      });
    closedLoanId = loanRes.body.data.id;
    const totalRepayment = loanRes.body.data.totalRepaymentAmount;

    // Pay it off and close
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: closedLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: totalRepayment,
        transaction_date: '2026-01-02',
      });

    await request
      .patch(`/api/v1/loans/${closedLoanId}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
  });

  it('Collector sees only ACTIVE loans (CLOSED loan not visible)', async () => {
    const res = await request
      .get('/api/v1/loans')
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(200);
    for (const loan of res.body.data) {
      expect(loan.status).toBe('ACTIVE');
    }
    // Should not include our closed loan
    const closedFound = res.body.data.find((l: { id: string }) => l.id === closedLoanId);
    expect(closedFound).toBeUndefined();
  });

  it('Admin sees all statuses', async () => {
    const res = await request
      .get('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    // Admin should see both active and closed
    const statuses = new Set(res.body.data.map((l: { status: string }) => l.status));
    expect(statuses.has('CLOSED')).toBe(true);
    expect(statuses.has('ACTIVE')).toBe(true);
  });

  it('Collector status query param ignored (always ACTIVE)', async () => {
    const res = await request
      .get('/api/v1/loans?status=CLOSED')
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(200);
    for (const loan of res.body.data) {
      expect(loan.status).toBe('ACTIVE');
    }
  });
});

// ─── Full Lifecycle ───────────────────────────────────────────────────────

describe('Full Lifecycle', () => {
  it('Collector submits → admin approves → verify loan updated → close works', async () => {
    // Create a new daily loan
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 1000,
        interest_rate: 10,
        disbursement_date: '2026-01-01',
        term_days: 10,
      });
    const lifecycleLoanId = loanRes.body.data.id;
    const totalRepayment = loanRes.body.data.totalRepaymentAmount;

    // Collector submits PENDING transaction for full amount
    const txnRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: lifecycleLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: totalRepayment,
        transaction_date: '2026-01-02',
      });
    expect(txnRes.body.data[0].approvalStatus).toBe('PENDING');

    // Verify loan NOT updated yet
    const loanMid = await request
      .get(`/api/v1/loans/${lifecycleLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(loanMid.body.data.totalCollected).toBe(0);

    // Admin approves
    const approveRes = await request
      .patch(`/api/v1/transactions/${txnRes.body.data[0].id}/approve`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(approveRes.status).toBe(200);

    // Verify loan updated (compare with DB precision — Decimal(12,2))
    const loanAfter = await request
      .get(`/api/v1/loans/${lifecycleLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(loanAfter.body.data.totalCollected).toBeCloseTo(totalRepayment, 2);

    // Close loan works
    const closeRes = await request
      .patch(`/api/v1/loans/${lifecycleLoanId}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.status).toBe('CLOSED');
  });

  it('Collector submits → admin rejects → verify loan unchanged', async () => {
    // Create a new daily loan
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower2Id,
        principal_amount: 1000,
        interest_rate: 10,
        disbursement_date: '2026-01-01',
        term_days: 10,
      });
    const rejectLoanId = loanRes.body.data.id;

    // Get initial state
    const loanBefore = await request
      .get(`/api/v1/loans/${rejectLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    // Collector submits
    const txnRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: rejectLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 500,
        transaction_date: '2026-01-02',
      });

    // Admin rejects
    const rejectRes = await request
      .patch(`/api/v1/transactions/${txnRes.body.data[0].id}/reject`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ rejection_reason: 'Incorrect amount' });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.data.approvalStatus).toBe('REJECTED');

    // Verify loan unchanged
    const loanAfter = await request
      .get(`/api/v1/loans/${rejectLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(loanAfter.body.data.totalCollected).toBe(loanBefore.body.data.totalCollected);
  });
});
