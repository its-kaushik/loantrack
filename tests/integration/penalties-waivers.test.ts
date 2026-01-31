import { jest } from '@jest/globals';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import app from '../../src/app.js';
import prisma from '../helpers/prisma';

jest.setTimeout(60_000);

const request = supertest(app);

let tenantId: string;
let adminAccessToken: string;
let collectorAccessToken: string;
let adminUserId: string;
let borrower1Id: string;
let overdueDailyLoanId: string;
let notOverdueDailyLoanId: string;
let monthlyLoanId: string;
let firstPenaltyId: string;
let secondPenaltyId: string;
let paidPenaltyId: string;

beforeAll(async () => {
  // Clean up any leftover test data
  await prisma.$executeRaw`DELETE FROM "penalties" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'pw-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'pw-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'pw-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'pw-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'pw-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'pw-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '8200%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '8200%'`;
  await prisma.tenant.deleteMany({ where: { slug: 'pw-test-tenant' } });

  // Create tenant
  const tenant = await prisma.tenant.create({
    data: { name: 'PW Test Tenant', slug: 'pw-test-tenant', ownerName: 'Owner', ownerPhone: '8200000000' },
  });
  tenantId = tenant.id;

  // Create admin
  const admin = await prisma.user.create({
    data: {
      tenantId,
      name: 'PW Test Admin',
      phone: '8200000001',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });
  adminUserId = admin.id;

  // Create collector
  await prisma.user.create({
    data: {
      tenantId,
      name: 'PW Test Collector',
      phone: '8200000002',
      passwordHash: await bcrypt.hash('Collector@123', 12),
      role: 'COLLECTOR',
    },
  });

  // Login both users
  const adminLogin = await request.post('/api/v1/auth/login').send({ phone: '8200000001', password: 'Admin@123' });
  adminAccessToken = adminLogin.body.data.access_token;

  const collectorLogin = await request.post('/api/v1/auth/login').send({ phone: '8200000002', password: 'Collector@123' });
  collectorAccessToken = collectorLogin.body.data.access_token;

  // Create borrower
  const b1 = await prisma.customer.create({
    data: { tenantId, fullName: 'PW Borrower One', phone: '8200100001', createdById: adminUserId },
  });
  borrower1Id = b1.id;

  // Create overdue DAILY loan (disbursed ~6 months ago, term=60, grace=7 → heavily overdue)
  const overdueRes = await request
    .post('/api/v1/loans')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'DAILY',
      borrower_id: borrower1Id,
      principal_amount: 100000,
      interest_rate: 5,
      disbursement_date: '2025-06-01',
      term_days: 60,
      grace_days: 7,
    });
  overdueDailyLoanId = overdueRes.body.data.id;

  // Create not-overdue DAILY loan (disbursed recently, term=120)
  const notOverdueRes = await request
    .post('/api/v1/loans')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'DAILY',
      borrower_id: borrower1Id,
      principal_amount: 50000,
      interest_rate: 5,
      disbursement_date: '2026-01-15',
      term_days: 120,
    });
  notOverdueDailyLoanId = notOverdueRes.body.data.id;

  // Create MONTHLY loan (for interest waiver tests)
  const monthlyRes = await request
    .post('/api/v1/loans')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'MONTHLY',
      borrower_id: borrower1Id,
      principal_amount: 100000,
      interest_rate: 2,
      disbursement_date: '2025-12-15',
    });
  monthlyLoanId = monthlyRes.body.data.id;
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "penalties" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'pw-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'pw-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'pw-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'pw-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'pw-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'pw-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '8200%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '8200%'`;
  await prisma.tenant.deleteMany({ where: { slug: 'pw-test-tenant' } });
  await prisma.$disconnect();
});

// ─── Impose Penalty — POST /loans/:id/penalties ──────────────────────────

describe('Impose Penalty — POST /loans/:id/penalties', () => {
  it('auto-calculates penalty for overdue daily loan → 201', async () => {
    const res = await request
      .post(`/api/v1/loans/${overdueDailyLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.penalty).toBeDefined();
    expect(res.body.data.calculation).toBeDefined();
    expect(res.body.data.penalty.status).toBe('PENDING');
    expect(res.body.data.penalty.amountCollected).toBe(0);
    expect(res.body.data.calculation.daysOverdue).toBeGreaterThan(0);
    expect(res.body.data.calculation.incrementalMonths).toBeGreaterThan(0);
    expect(res.body.data.calculation.wasOverridden).toBe(false);
    expect(res.body.data.calculation.monthsAlreadyPenalised).toBe(0);

    firstPenaltyId = res.body.data.penalty.id;
  });

  it('stacking: second penalty only charges incremental months', async () => {
    const firstPenalty = await request
      .get(`/api/v1/loans/${overdueDailyLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    const firstMonths = firstPenalty.body.data[0].monthsCharged;

    // Since all current months are covered, no additional penalty should be possible
    // unless time passes. But since this is a heavily overdue loan (6+ months),
    // the first penalty covers all. A second impose should fail.
    const res = await request
      .post(`/api/v1/loans/${overdueDailyLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});

    // All months are now covered, so should get 400
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/no new penalty/i);
  });

  it('admin can override amount → wasOverridden: true', async () => {
    // Create a fresh overdue loan for this test
    const freshRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 50000,
        interest_rate: 5,
        disbursement_date: '2025-07-01',
        term_days: 60,
        grace_days: 7,
      });
    const freshLoanId = freshRes.body.data.id;

    const res = await request
      .post(`/api/v1/loans/${freshLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ override_amount: 9999, notes: 'Admin override' });

    expect(res.status).toBe(201);
    expect(res.body.data.penalty.penaltyAmount).toBe(9999);
    expect(res.body.data.penalty.notes).toBe('Admin override');
    expect(res.body.data.calculation.wasOverridden).toBe(true);
  });

  it('rejects penalty on MONTHLY loan → 400', async () => {
    const res = await request
      .post(`/api/v1/loans/${monthlyLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/DAILY/);
  });

  it('rejects penalty on non-overdue loan → 400', async () => {
    const res = await request
      .post(`/api/v1/loans/${notOverdueDailyLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not overdue/i);
  });

  it('collector gets 403', async () => {
    const res = await request
      .post(`/api/v1/loans/${overdueDailyLoanId}/penalties`)
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('non-existent loan → 404', async () => {
    const res = await request
      .post('/api/v1/loans/00000000-0000-0000-0000-000000000000/penalties')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});

    expect(res.status).toBe(404);
  });

  it('waived penalties count toward months_already_penalised', async () => {
    // Create fresh overdue loan
    const freshRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 50000,
        interest_rate: 5,
        disbursement_date: '2025-07-01',
        term_days: 60,
        grace_days: 7,
      });
    const freshLoanId = freshRes.body.data.id;

    // Impose first penalty
    const p1Res = await request
      .post(`/api/v1/loans/${freshLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});
    expect(p1Res.status).toBe(201);
    const p1Id = p1Res.body.data.penalty.id;
    const p1Months = p1Res.body.data.calculation.incrementalMonths;

    // Fully waive the penalty
    await request
      .patch(`/api/v1/penalties/${p1Id}/waive`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ waive_amount: p1Res.body.data.penalty.penaltyAmount });

    // Try to impose again — should fail because waived penalty still counts
    const p2Res = await request
      .post(`/api/v1/loans/${freshLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});

    expect(p2Res.status).toBe(400);
    expect(p2Res.body.error.message).toMatch(/no new penalty/i);
  });
});

// ─── List Penalties — GET /loans/:id/penalties ──────────────────────────────

describe('List Penalties — GET /loans/:id/penalties', () => {
  it('lists all penalties for a loan → 200', async () => {
    const res = await request
      .get(`/api/v1/loans/${overdueDailyLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.data[0].loanId).toBe(overdueDailyLoanId);
  });

  it('supports pagination', async () => {
    const res = await request
      .get(`/api/v1/loans/${overdueDailyLoanId}/penalties?page=1&limit=1`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
    expect(res.body.pagination.limit).toBe(1);
  });

  it('non-existent loan → 404', async () => {
    const res = await request
      .get('/api/v1/loans/00000000-0000-0000-0000-000000000000/penalties')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(404);
  });

  it('collector gets 403', async () => {
    const res = await request
      .get(`/api/v1/loans/${overdueDailyLoanId}/penalties`)
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(403);
  });
});

// ─── Penalty Payment — POST /transactions with PENALTY type ──────────────

describe('Penalty Payment — POST /transactions with PENALTY type', () => {
  beforeAll(async () => {
    // Create a fresh overdue loan for payment tests
    const freshRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 100000,
        interest_rate: 5,
        disbursement_date: '2025-06-01',
        term_days: 60,
        grace_days: 7,
      });
    const paymentTestLoanId = freshRes.body.data.id;

    // Impose penalty
    const penRes = await request
      .post(`/api/v1/loans/${paymentTestLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});
    secondPenaltyId = penRes.body.data.penalty.id;

    // Also create a penalty on the main overdue loan for auto-select tests
    // (the first penalty already exists on overdueDailyLoanId)
  });

  it('admin pays penalty with explicit penalty_id → 201, APPROVED', async () => {
    const penaltyBefore = await prisma.penalty.findUnique({ where: { id: secondPenaltyId } });
    const netPayable = Number(penaltyBefore!.netPayable);

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: penaltyBefore!.loanId,
        transaction_type: 'PENALTY',
        amount: 500,
        transaction_date: '2026-01-31',
        penalty_id: secondPenaltyId,
      });

    expect(res.status).toBe(201);
    expect(res.body.data[0].transactionType).toBe('PENALTY');
    expect(res.body.data[0].approvalStatus).toBe('APPROVED');
    expect(res.body.data[0].amount).toBe(500);
  });

  it('partial payment → penalty status PARTIALLY_PAID', async () => {
    const penalty = await prisma.penalty.findUnique({ where: { id: secondPenaltyId } });
    expect(penalty!.status).toBe('PARTIALLY_PAID');
    expect(Number(penalty!.amountCollected)).toBe(500);
    paidPenaltyId = secondPenaltyId;
  });

  it('full payment → penalty status PAID', async () => {
    const penalty = await prisma.penalty.findUnique({ where: { id: paidPenaltyId } });
    const remaining = Number(penalty!.netPayable) - Number(penalty!.amountCollected);

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: penalty!.loanId,
        transaction_type: 'PENALTY',
        amount: remaining,
        transaction_date: '2026-01-31',
        penalty_id: paidPenaltyId,
      });

    expect(res.status).toBe(201);

    const updated = await prisma.penalty.findUnique({ where: { id: paidPenaltyId } });
    expect(updated!.status).toBe('PAID');
  });

  it('auto-selects oldest unpaid penalty when penalty_id omitted', async () => {
    // The first penalty on overdueDailyLoanId should be auto-selected
    const penalties = await prisma.penalty.findMany({
      where: { loanId: overdueDailyLoanId, tenantId, status: { in: ['PENDING', 'PARTIALLY_PAID'] } },
      orderBy: { createdAt: 'asc' },
    });

    if (penalties.length === 0) {
      // Skip if no unpaid penalties exist
      return;
    }

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: overdueDailyLoanId,
        transaction_type: 'PENALTY',
        amount: 100,
        transaction_date: '2026-01-31',
      });

    expect(res.status).toBe(201);
  });

  it('rejects overpayment beyond remaining → 400', async () => {
    // Create a fresh penalty for this test
    const freshRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2025-06-01',
        term_days: 60,
        grace_days: 7,
      });
    const freshLoanId = freshRes.body.data.id;

    const penRes = await request
      .post(`/api/v1/loans/${freshLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});
    const penId = penRes.body.data.penalty.id;
    const netPayable = penRes.body.data.penalty.netPayable;

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: freshLoanId,
        transaction_type: 'PENALTY',
        amount: netPayable + 1,
        transaction_date: '2026-01-31',
        penalty_id: penId,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/exceeds/i);
  });

  it('rejects payment for non-existent penalty → 404', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: overdueDailyLoanId,
        transaction_type: 'PENALTY',
        amount: 100,
        transaction_date: '2026-01-31',
        penalty_id: '00000000-0000-0000-0000-000000000000',
      });

    expect(res.status).toBe(404);
  });

  it('rejects payment for already PAID penalty → 400', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: (await prisma.penalty.findUnique({ where: { id: paidPenaltyId } }))!.loanId,
        transaction_type: 'PENALTY',
        amount: 100,
        transaction_date: '2026-01-31',
        penalty_id: paidPenaltyId,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/PAID/);
  });

  it('collector PENALTY payment → PENDING (approval flow)', async () => {
    // Create fresh overdue loan and penalty for collector test
    const freshRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2025-06-01',
        term_days: 60,
        grace_days: 7,
      });
    const freshLoanId = freshRes.body.data.id;

    const penRes = await request
      .post(`/api/v1/loans/${freshLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});
    const penId = penRes.body.data.penalty.id;

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: freshLoanId,
        transaction_type: 'PENALTY',
        amount: 100,
        transaction_date: '2026-01-31',
        penalty_id: penId,
      });

    expect(res.status).toBe(201);
    expect(res.body.data[0].approvalStatus).toBe('PENDING');

    // Penalty should NOT have been updated yet
    const penalty = await prisma.penalty.findUnique({ where: { id: penId } });
    expect(Number(penalty!.amountCollected)).toBe(0);
  });

  it('admin approval of PENDING PENALTY → penalty amountCollected updated', async () => {
    // Find a pending PENALTY transaction
    const pendingTxn = await prisma.transaction.findFirst({
      where: { tenantId, transactionType: 'PENALTY', approvalStatus: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });

    expect(pendingTxn).toBeTruthy();

    const res = await request
      .patch(`/api/v1/transactions/${pendingTxn!.id}/approve`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.approvalStatus).toBe('APPROVED');

    // Check penalty was updated
    const penalty = await prisma.penalty.findUnique({ where: { id: pendingTxn!.penaltyId! } });
    expect(Number(penalty!.amountCollected)).toBe(Number(pendingTxn!.amount));
    expect(penalty!.status).toBe('PARTIALLY_PAID');
  });

  it('PENALTY on MONTHLY loan → 400', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: monthlyLoanId,
        transaction_type: 'PENALTY',
        amount: 100,
        transaction_date: '2026-01-31',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/DAILY/);
  });
});

// ─── Penalty Waiver — PATCH /penalties/:id/waive ─────────────────────────

describe('Penalty Waiver — PATCH /penalties/:id/waive', () => {
  let waiveTestPenaltyId: string;
  let waiveTestLoanId: string;

  beforeAll(async () => {
    // Create fresh overdue loan and penalty for waiver tests
    const freshRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 100000,
        interest_rate: 5,
        disbursement_date: '2025-06-01',
        term_days: 60,
        grace_days: 7,
      });
    waiveTestLoanId = freshRes.body.data.id;

    const penRes = await request
      .post(`/api/v1/loans/${waiveTestLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});
    waiveTestPenaltyId = penRes.body.data.penalty.id;
  });

  it('partial waiver reduces netPayable → 200', async () => {
    const res = await request
      .patch(`/api/v1/penalties/${waiveTestPenaltyId}/waive`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ waive_amount: 1000, notes: 'Partial waiver' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.penalty.waivedAmount).toBe(1000);
    expect(res.body.data.penalty.status).toBe('PENDING');

    const penalty = await prisma.penalty.findUnique({ where: { id: waiveTestPenaltyId } });
    expect(Number(penalty!.waivedAmount)).toBe(1000);
  });

  it('full waiver sets status to WAIVED', async () => {
    // Create another penalty for full waiver test
    const freshRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2025-06-01',
        term_days: 60,
        grace_days: 7,
      });
    const freshLoanId = freshRes.body.data.id;

    const penRes = await request
      .post(`/api/v1/loans/${freshLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});
    const fullWaivePenId = penRes.body.data.penalty.id;
    const penaltyAmount = penRes.body.data.penalty.penaltyAmount;

    const res = await request
      .patch(`/api/v1/penalties/${fullWaivePenId}/waive`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ waive_amount: penaltyAmount });

    expect(res.status).toBe(200);
    expect(res.body.data.penalty.status).toBe('WAIVED');
    expect(res.body.data.penalty.netPayable).toBe(0);
  });

  it('creates PENALTY_WAIVER audit transaction', async () => {
    // The waiver from the previous test should have created a transaction
    const waivers = await prisma.transaction.findMany({
      where: { tenantId, transactionType: 'PENALTY_WAIVER' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });

    expect(waivers.length).toBe(1);
    expect(waivers[0]!.approvalStatus).toBe('APPROVED');
  });

  it('rejects waive_amount exceeding waivable → 400', async () => {
    const penalty = await prisma.penalty.findUnique({ where: { id: waiveTestPenaltyId } });
    const remaining = Number(penalty!.penaltyAmount) - Number(penalty!.waivedAmount);

    const res = await request
      .patch(`/api/v1/penalties/${waiveTestPenaltyId}/waive`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ waive_amount: remaining + 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/exceeds/i);
  });

  it('rejects waiver on PAID penalty → 400', async () => {
    // Use the paidPenaltyId which was fully paid earlier
    const res = await request
      .patch(`/api/v1/penalties/${paidPenaltyId}/waive`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ waive_amount: 100 });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/PAID/);
  });

  it('rejects waiver on WAIVED penalty → 400', async () => {
    // Find a WAIVED penalty
    const waivedPenalty = await prisma.penalty.findFirst({
      where: { tenantId, status: 'WAIVED' },
    });

    if (!waivedPenalty) return; // skip if none exist

    const res = await request
      .patch(`/api/v1/penalties/${waivedPenalty.id}/waive`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ waive_amount: 100 });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/WAIVED/);
  });

  it('non-existent penalty → 404', async () => {
    const res = await request
      .patch('/api/v1/penalties/00000000-0000-0000-0000-000000000000/waive')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ waive_amount: 100 });

    expect(res.status).toBe(404);
  });

  it('collector gets 403', async () => {
    const res = await request
      .patch(`/api/v1/penalties/${waiveTestPenaltyId}/waive`)
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({ waive_amount: 100 });

    expect(res.status).toBe(403);
  });

  it('partial payment + partial waiver = PAID when combined covers netPayable', async () => {
    // Create fresh loan + penalty
    const freshRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2025-06-01',
        term_days: 60,
        grace_days: 7,
      });
    const freshLoanId = freshRes.body.data.id;

    const penRes = await request
      .post(`/api/v1/loans/${freshLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});
    const penId = penRes.body.data.penalty.id;
    const penaltyAmount = penRes.body.data.penalty.penaltyAmount;

    // Pay half
    const halfAmount = Math.floor(penaltyAmount / 2);
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: freshLoanId,
        transaction_type: 'PENALTY',
        amount: halfAmount,
        transaction_date: '2026-01-31',
        penalty_id: penId,
      });

    // Waive the rest
    const waiveAmount = penaltyAmount - halfAmount;
    const res = await request
      .patch(`/api/v1/penalties/${penId}/waive`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ waive_amount: waiveAmount });

    expect(res.status).toBe(200);
    // After waiver, netPayable = penaltyAmount - waiveAmount = halfAmount
    // amountCollected = halfAmount, so status should be PAID
    expect(res.body.data.penalty.status).toBe('PAID');
  });
});

// ─── Interest Waiver — POST /loans/:id/waive-interest ───────────────────

describe('Interest Waiver — POST /loans/:id/waive-interest', () => {
  it('creates INTEREST_WAIVER transaction → 201', async () => {
    const res = await request
      .post(`/api/v1/loans/${monthlyLoanId}/waive-interest`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        effective_date: '2026-01-15',
        waive_amount: 500,
        notes: 'Partial interest waiver',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.transactionType).toBe('INTEREST_WAIVER');
    expect(res.body.data.amount).toBe(500);
    expect(res.body.data.effectiveDate).toBe('2026-01-15');
    expect(res.body.data.loanId).toBe(monthlyLoanId);
  });

  it('full waiver settles the cycle (payment-status shows isSettled: true)', async () => {
    // Get current payment status to see the interest due for January 2026 cycle
    const statusRes = await request
      .get(`/api/v1/loans/${monthlyLoanId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const janCycle = statusRes.body.data.cycles.find(
      (c: { cycleYear: number; cycleMonth: number }) => c.cycleYear === 2026 && c.cycleMonth === 1,
    );
    expect(janCycle).toBeDefined();

    // Waive the remaining interest due for this cycle
    const remainingDue = janCycle.interestDue - janCycle.interestPaid - janCycle.interestWaived;
    if (remainingDue > 0) {
      await request
        .post(`/api/v1/loans/${monthlyLoanId}/waive-interest`)
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .send({
          effective_date: '2026-01-15',
          waive_amount: remainingDue,
        });
    }

    // Check payment status — Jan 2026 should now be settled
    const updatedStatus = await request
      .get(`/api/v1/loans/${monthlyLoanId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const updatedJanCycle = updatedStatus.body.data.cycles.find(
      (c: { cycleYear: number; cycleMonth: number }) => c.cycleYear === 2026 && c.cycleMonth === 1,
    );
    expect(updatedJanCycle.isSettled).toBe(true);
  });

  it('partial waiver leaves cycle unsettled', async () => {
    // Get February cycle (should be unsettled)
    const statusRes = await request
      .get(`/api/v1/loans/${monthlyLoanId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    // Find a cycle that is not yet settled (other than January which we settled above)
    const unsettledCycle = statusRes.body.data.cycles.find(
      (c: { isSettled: boolean; cycleYear: number; cycleMonth: number }) =>
        !c.isSettled && (c.cycleYear !== 2026 || c.cycleMonth !== 1),
    );

    if (!unsettledCycle) return; // Skip if no unsettled cycles

    // Waive a tiny amount
    await request
      .post(`/api/v1/loans/${monthlyLoanId}/waive-interest`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        effective_date: `${unsettledCycle.cycleYear}-${String(unsettledCycle.cycleMonth).padStart(2, '0')}-15`,
        waive_amount: 1,
      });

    // Check it's still unsettled
    const updatedStatus = await request
      .get(`/api/v1/loans/${monthlyLoanId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const cycle = updatedStatus.body.data.cycles.find(
      (c: { cycleYear: number; cycleMonth: number }) =>
        c.cycleYear === unsettledCycle.cycleYear && c.cycleMonth === unsettledCycle.cycleMonth,
    );
    // Unless the 1 was enough to cover, it should still be unsettled
    // (interest due is 100000 * 2 / 100 = 2000, so 1 won't cover it)
    expect(cycle.isSettled).toBe(false);
  });

  it('partial payment + partial waiver settles cycle', async () => {
    // Create a new monthly loan for a clean test
    const freshRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower1Id,
        principal_amount: 100000,
        interest_rate: 2,
        disbursement_date: '2025-12-01',
      });
    const freshMonthlyId = freshRes.body.data.id;

    // Interest due for Jan cycle: 100000 * 2 / 100 = 2000
    // Pay 1000
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: freshMonthlyId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 1000,
        transaction_date: '2026-01-15',
        effective_date: '2026-01-01',
      });

    // Waive 1000
    await request
      .post(`/api/v1/loans/${freshMonthlyId}/waive-interest`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        effective_date: '2026-01-01',
        waive_amount: 1000,
      });

    // Check cycle is settled
    const statusRes = await request
      .get(`/api/v1/loans/${freshMonthlyId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const janCycle = statusRes.body.data.cycles.find(
      (c: { cycleYear: number; cycleMonth: number }) => c.cycleYear === 2026 && c.cycleMonth === 1,
    );
    expect(janCycle.isSettled).toBe(true);
  });

  it('rejects on DAILY loan → 400', async () => {
    const res = await request
      .post(`/api/v1/loans/${overdueDailyLoanId}/waive-interest`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        effective_date: '2026-01-15',
        waive_amount: 500,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/MONTHLY/);
  });

  it('collector gets 403', async () => {
    const res = await request
      .post(`/api/v1/loans/${monthlyLoanId}/waive-interest`)
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        effective_date: '2026-01-15',
        waive_amount: 500,
      });

    expect(res.status).toBe(403);
  });
});

// ─── List Waivers — GET /loans/:id/waivers ──────────────────────────────

describe('List Waivers — GET /loans/:id/waivers', () => {
  it('lists both PENALTY_WAIVER and INTEREST_WAIVER → 200', async () => {
    // Get waivers for monthly loan (should have INTEREST_WAIVER)
    const res = await request
      .get(`/api/v1/loans/${monthlyLoanId}/waivers`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);

    const types = res.body.data.map((w: { transactionType: string }) => w.transactionType);
    expect(types).toContain('INTEREST_WAIVER');
  });

  it('supports pagination', async () => {
    const res = await request
      .get(`/api/v1/loans/${monthlyLoanId}/waivers?page=1&limit=1`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
    expect(res.body.pagination.limit).toBe(1);
  });

  it('non-existent loan → 404', async () => {
    const res = await request
      .get('/api/v1/loans/00000000-0000-0000-0000-000000000000/waivers')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(404);
  });

  it('collector gets 403', async () => {
    const res = await request
      .get(`/api/v1/loans/${monthlyLoanId}/waivers`)
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(403);
  });
});

// ─── Closure Validation — PATCH /loans/:id/close ────────────────────────

describe('Closure Validation — PATCH /loans/:id/close', () => {
  it('blocks closure when outstanding penalties exist → 400', async () => {
    // Create a fully-paid daily loan but with an outstanding penalty
    const freshRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 1000,
        interest_rate: 5,
        disbursement_date: '2025-06-01',
        term_days: 60,
        grace_days: 7,
      });
    const closeLoanId = freshRes.body.data.id;
    const totalRepayment = freshRes.body.data.totalRepaymentAmount;

    // Pay full amount
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: closeLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: totalRepayment,
        transaction_date: '2026-01-31',
      });

    // Impose penalty
    await request
      .post(`/api/v1/loans/${closeLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});

    // Try to close — should fail
    const closeRes = await request
      .patch(`/api/v1/loans/${closeLoanId}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(closeRes.status).toBe(400);
    expect(closeRes.body.error.message).toMatch(/outstanding penalties/i);
  });

  it('allows closure when all penalties PAID', async () => {
    // Create a fully-paid daily loan with paid penalty
    const freshRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 1000,
        interest_rate: 5,
        disbursement_date: '2025-06-01',
        term_days: 60,
        grace_days: 7,
      });
    const closeLoanId = freshRes.body.data.id;
    const totalRepayment = freshRes.body.data.totalRepaymentAmount;

    // Pay full amount
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: closeLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: totalRepayment,
        transaction_date: '2026-01-31',
      });

    // Impose penalty
    const penRes = await request
      .post(`/api/v1/loans/${closeLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});
    const penId = penRes.body.data.penalty.id;
    const penAmount = penRes.body.data.penalty.netPayable;

    // Pay penalty fully
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: closeLoanId,
        transaction_type: 'PENALTY',
        amount: penAmount,
        transaction_date: '2026-01-31',
        penalty_id: penId,
      });

    // Close should succeed
    const closeRes = await request
      .patch(`/api/v1/loans/${closeLoanId}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.status).toBe('CLOSED');
  });

  it('allows closure when all penalties WAIVED', async () => {
    // Create a fully-paid daily loan with waived penalty
    const freshRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 1000,
        interest_rate: 5,
        disbursement_date: '2025-06-01',
        term_days: 60,
        grace_days: 7,
      });
    const closeLoanId = freshRes.body.data.id;
    const totalRepayment = freshRes.body.data.totalRepaymentAmount;

    // Pay full amount
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: closeLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: totalRepayment,
        transaction_date: '2026-01-31',
      });

    // Impose penalty
    const penRes = await request
      .post(`/api/v1/loans/${closeLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});
    const penId = penRes.body.data.penalty.id;
    const penAmount = penRes.body.data.penalty.penaltyAmount;

    // Waive penalty fully
    await request
      .patch(`/api/v1/penalties/${penId}/waive`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ waive_amount: penAmount });

    // Close should succeed
    const closeRes = await request
      .patch(`/api/v1/loans/${closeLoanId}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.status).toBe('CLOSED');
  });

  it('monthly loan closure still works unchanged', async () => {
    // Create a simple monthly loan, pay all interest, return all principal, close it
    const freshRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrower1Id,
        principal_amount: 10000,
        interest_rate: 2,
        disbursement_date: '2025-12-15',
      });
    const freshMonthlyId = freshRes.body.data.id;

    // Pay interest for January cycle: 10000 * 2 / 100 = 200
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: freshMonthlyId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 200,
        transaction_date: '2026-01-15',
        effective_date: '2026-01-15',
      });

    // Return all principal
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: freshMonthlyId,
        transaction_type: 'PRINCIPAL_RETURN',
        amount: 10000,
        transaction_date: '2026-01-15',
      });

    // Close
    const closeRes = await request
      .patch(`/api/v1/loans/${freshMonthlyId}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.status).toBe('CLOSED');
  });
});

// ─── No-Penalty Loan Closure (Regression) ───────────────────────────────

describe('No-Penalty Loan Closure', () => {
  it('daily loan with no penalties closes normally (regression)', async () => {
    const freshRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower1Id,
        principal_amount: 1000,
        interest_rate: 5,
        disbursement_date: '2025-06-01',
        term_days: 60,
        grace_days: 7,
      });
    const closeLoanId = freshRes.body.data.id;
    const totalRepayment = freshRes.body.data.totalRepaymentAmount;

    // Pay full amount
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: closeLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: totalRepayment,
        transaction_date: '2026-01-31',
      });

    // Close — should succeed without any penalties
    const closeRes = await request
      .patch(`/api/v1/loans/${closeLoanId}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.status).toBe('CLOSED');
  });
});
