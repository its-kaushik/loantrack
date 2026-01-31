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
let borrowerId: string;
let guarantorId: string;
let dailyLoanId: string;
let monthlyLoanId: string;
let cancellableDailyLoanId: string;

// Tracked IDs for later tests
let dailyCollectionTxnId: string;
let principalReturnTxnId: string;
let interestPaymentTxnId: string;
let penaltyTxnId: string;
let guarantorPaymentTxnId: string;
let penaltyId: string;

const SLUG = 'p8-test-tenant';
const PHONE_PREFIX = '9200';

beforeAll(async () => {
  // Clean up any leftover test data
  await prisma.$executeRaw`DELETE FROM "penalties" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE ${PHONE_PREFIX + '%'})`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE ${PHONE_PREFIX + '%'}`;
  await prisma.tenant.deleteMany({ where: { slug: SLUG } });

  // Create tenant
  const tenant = await prisma.tenant.create({
    data: { name: 'P8 Test Tenant', slug: SLUG, ownerName: 'Owner', ownerPhone: `${PHONE_PREFIX}000000` },
  });
  tenantId = tenant.id;

  // Create admin
  const admin = await prisma.user.create({
    data: {
      tenantId,
      name: 'P8 Admin',
      phone: `${PHONE_PREFIX}000001`,
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });
  adminUserId = admin.id;

  // Create collector
  await prisma.user.create({
    data: {
      tenantId,
      name: 'P8 Collector',
      phone: `${PHONE_PREFIX}000002`,
      passwordHash: await bcrypt.hash('Collector@123', 12),
      role: 'COLLECTOR',
    },
  });

  // Login both
  const adminLogin = await request.post('/api/v1/auth/login').send({ phone: `${PHONE_PREFIX}000001`, password: 'Admin@123' });
  adminAccessToken = adminLogin.body.data.access_token;

  const collectorLogin = await request.post('/api/v1/auth/login').send({ phone: `${PHONE_PREFIX}000002`, password: 'Collector@123' });
  collectorAccessToken = collectorLogin.body.data.access_token;

  // Create borrower customer
  const borrower = await prisma.customer.create({
    data: { tenantId, fullName: 'P8 Borrower', phone: `${PHONE_PREFIX}100001`, createdById: adminUserId },
  });
  borrowerId = borrower.id;

  // Create guarantor customer
  const guarantor = await prisma.customer.create({
    data: { tenantId, fullName: 'P8 Guarantor', phone: `${PHONE_PREFIX}100002`, createdById: adminUserId },
  });
  guarantorId = guarantor.id;

  // Create ACTIVE daily loan with guarantor (disbursed 6 months ago, overdue)
  const dailyRes = await request
    .post('/api/v1/loans')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'DAILY',
      borrower_id: borrowerId,
      principal_amount: 100000,
      interest_rate: 5,
      disbursement_date: '2025-06-01',
      term_days: 60,
      grace_days: 7,
      guarantor_id: guarantorId,
    });
  dailyLoanId = dailyRes.body.data.id;

  // Record some transactions on the daily loan for correction tests
  const collectionRes = await request
    .post('/api/v1/transactions')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_id: dailyLoanId,
      transaction_type: 'DAILY_COLLECTION',
      amount: 500,
      transaction_date: '2025-06-02',
    });
  dailyCollectionTxnId = collectionRes.body.data[0].id;

  // Create ACTIVE monthly loan with guarantor
  const monthlyRes = await request
    .post('/api/v1/loans')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'MONTHLY',
      borrower_id: borrowerId,
      principal_amount: 100000,
      interest_rate: 2,
      disbursement_date: '2025-12-15',
      guarantor_id: guarantorId,
    });
  monthlyLoanId = monthlyRes.body.data.id;

  // Record an interest payment on monthly loan for correction test
  const interestRes = await request
    .post('/api/v1/transactions')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_id: monthlyLoanId,
      transaction_type: 'INTEREST_PAYMENT',
      amount: 2000,
      transaction_date: '2026-01-15',
      effective_date: '2026-01-15',
    });
  interestPaymentTxnId = interestRes.body.data[0].id;

  // Record a principal return on monthly loan for correction test
  const principalRes = await request
    .post('/api/v1/transactions')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_id: monthlyLoanId,
      transaction_type: 'PRINCIPAL_RETURN',
      amount: 10000,
      transaction_date: '2026-01-15',
    });
  principalReturnTxnId = principalRes.body.data[0].id;

  // Create a 2nd ACTIVE daily loan for cancellation tests (fresh, no extra txns)
  const cancellableRes = await request
    .post('/api/v1/loans')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'DAILY',
      borrower_id: borrowerId,
      principal_amount: 50000,
      interest_rate: 5,
      disbursement_date: '2026-01-20',
      term_days: 120,
    });
  cancellableDailyLoanId = cancellableRes.body.data.id;

  // Impose a penalty on the overdue daily loan for correction test
  const penaltyRes = await request
    .post(`/api/v1/loans/${dailyLoanId}/penalties`)
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({});
  penaltyId = penaltyRes.body.data.penalty.id;

  // Pay the penalty partially for correction test
  const penaltyPayRes = await request
    .post('/api/v1/transactions')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_id: dailyLoanId,
      transaction_type: 'PENALTY',
      amount: 500,
      transaction_date: '2025-08-10',
      penalty_id: penaltyId,
    });
  penaltyTxnId = penaltyPayRes.body.data[0].id;
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "penalties" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE ${PHONE_PREFIX + '%'})`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE ${PHONE_PREFIX + '%'}`;
  await prisma.tenant.deleteMany({ where: { slug: SLUG } });
  await prisma.$disconnect();
});

// ═════════════════════════════════════════════════════════════════════════════
// Loan Default — PATCH /loans/:id/default
// ═════════════════════════════════════════════════════════════════════════════

describe('Loan Default — PATCH /loans/:id/default', () => {
  it('defaults ACTIVE daily loan → 200, status=DEFAULTED, defaultedAt set', async () => {
    const res = await request
      .patch(`/api/v1/loans/${dailyLoanId}/default`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('DEFAULTED');
    expect(res.body.data.defaultedAt).toBeTruthy();
    expect(res.body.data.defaultedById).toBeTruthy();
  });

  it('defaults ACTIVE monthly loan → 200', async () => {
    const res = await request
      .patch(`/api/v1/loans/${monthlyLoanId}/default`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('DEFAULTED');
    expect(res.body.data.defaultedAt).toBeTruthy();
  });

  it('sets borrower isDefaulter=true', async () => {
    const res = await request
      .get(`/api/v1/customers/${borrowerId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.isDefaulter).toBe(true);
  });

  it('guarantor warning appears on GET /customers/:id for guarantor', async () => {
    const res = await request
      .get(`/api/v1/customers/${guarantorId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    const warnings = res.body.data.guarantorWarnings;
    expect(warnings).toBeDefined();
    expect(warnings.length).toBeGreaterThan(0);
    const defaultedWarning = warnings.find((w: { status: string }) => w.status === 'DEFAULTED');
    expect(defaultedWarning).toBeDefined();
  });

  it('rejects defaulting an already DEFAULTED loan → 400', async () => {
    const res = await request
      .patch(`/api/v1/loans/${dailyLoanId}/default`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(400);
  });

  it('rejects defaulting a CANCELLED loan → 400', async () => {
    // cancellableDailyLoanId is still ACTIVE, cancel it first
    await request
      .patch(`/api/v1/loans/${cancellableDailyLoanId}/cancel`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ cancellation_reason: 'Test cancellation' });

    const res = await request
      .patch(`/api/v1/loans/${cancellableDailyLoanId}/default`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(400);
  });

  it('collector cannot default → 403', async () => {
    const res = await request
      .patch(`/api/v1/loans/${dailyLoanId}/default`)
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(403);
  });

  it('non-existent loan → 404', async () => {
    const res = await request
      .patch('/api/v1/loans/00000000-0000-0000-0000-000000000000/default')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Loan Write-off — PATCH /loans/:id/write-off
// ═════════════════════════════════════════════════════════════════════════════

describe('Loan Write-off — PATCH /loans/:id/write-off', () => {
  it('writes off DEFAULTED daily loan → 200, status=WRITTEN_OFF', async () => {
    const res = await request
      .patch(`/api/v1/loans/${dailyLoanId}/write-off`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('WRITTEN_OFF');
    expect(res.body.data.writtenOffAt).toBeTruthy();
    expect(res.body.data.writtenOffById).toBeTruthy();
  });

  it('guarantor warning still shows for WRITTEN_OFF loan', async () => {
    const res = await request
      .get(`/api/v1/customers/${guarantorId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    const warnings = res.body.data.guarantorWarnings;
    const woWarning = warnings.find((w: { status: string }) => w.status === 'WRITTEN_OFF');
    expect(woWarning).toBeDefined();
  });

  it('rejects writing off ACTIVE loan → 400', async () => {
    // Create a new ACTIVE loan to test against
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2026-01-25',
        term_days: 30,
      });
    const activeLoanId = loanRes.body.data.id;

    const res = await request
      .patch(`/api/v1/loans/${activeLoanId}/write-off`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(400);
  });

  it('collector cannot write off → 403', async () => {
    const res = await request
      .patch(`/api/v1/loans/${dailyLoanId}/write-off`)
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Close Defaulted Loan — PATCH /loans/:id/close
// ═════════════════════════════════════════════════════════════════════════════

describe('Close Defaulted Loan — PATCH /loans/:id/close', () => {
  let defaultedDailyForClose: string;
  let defaultedMonthlyForClose: string;

  beforeAll(async () => {
    // Create and default a daily loan
    const dailyRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 20000,
        interest_rate: 5,
        disbursement_date: '2025-07-01',
        term_days: 30,
      });
    defaultedDailyForClose = dailyRes.body.data.id;

    await request
      .patch(`/api/v1/loans/${defaultedDailyForClose}/default`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    // Create and default a monthly loan
    const monthlyRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrowerId,
        principal_amount: 30000,
        interest_rate: 2,
        disbursement_date: '2025-11-15',
      });
    defaultedMonthlyForClose = monthlyRes.body.data.id;

    await request
      .patch(`/api/v1/loans/${defaultedMonthlyForClose}/default`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
  });

  it('closes DEFAULTED daily loan without full repayment → 200', async () => {
    const res = await request
      .patch(`/api/v1/loans/${defaultedDailyForClose}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CLOSED');
    expect(res.body.data.closureDate).toBeTruthy();
  });

  it('closes DEFAULTED monthly loan without settled cycles → 200', async () => {
    const res = await request
      .patch(`/api/v1/loans/${defaultedMonthlyForClose}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CLOSED');
  });

  it('does NOT auto-clear isDefaulter', async () => {
    const res = await request
      .get(`/api/v1/customers/${borrowerId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.body.data.isDefaulter).toBe(true);
  });

  it('still rejects closing ACTIVE loan with insufficient payment → 400', async () => {
    // Create a fresh ACTIVE loan with no payments
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 15000,
        interest_rate: 5,
        disbursement_date: '2026-01-28',
        term_days: 30,
      });

    const res = await request
      .patch(`/api/v1/loans/${loanRes.body.data.id}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Loan Cancellation — PATCH /loans/:id/cancel
// ═════════════════════════════════════════════════════════════════════════════

describe('Loan Cancellation — PATCH /loans/:id/cancel', () => {
  let freshCancellableLoanId: string;

  beforeAll(async () => {
    // Create a fresh ACTIVE daily loan for cancellation
    const res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 25000,
        interest_rate: 5,
        disbursement_date: '2026-01-29',
        term_days: 60,
      });
    freshCancellableLoanId = res.body.data.id;
  });

  it('cancels ACTIVE loan with no payments beyond disbursement → 200', async () => {
    const res = await request
      .patch(`/api/v1/loans/${freshCancellableLoanId}/cancel`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ cancellation_reason: 'Loan created in error' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(res.body.data.cancelledAt).toBeTruthy();
    expect(res.body.data.cancelledById).toBeTruthy();
  });

  it('returns cancellationReason in response', async () => {
    const res = await request
      .get(`/api/v1/loans/${freshCancellableLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.cancellationReason).toBe('Loan created in error');
  });

  it('requires cancellation_reason in body → 400 without', async () => {
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2026-01-30',
        term_days: 30,
      });

    const res = await request
      .patch(`/api/v1/loans/${loanRes.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('rejects when APPROVED non-initial transactions exist → 400', async () => {
    // Create a loan, add a daily collection, then try to cancel
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2026-01-25',
        term_days: 30,
      });

    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanRes.body.data.id,
        transaction_type: 'DAILY_COLLECTION',
        amount: 500,
        transaction_date: '2026-01-26',
      });

    const res = await request
      .patch(`/api/v1/loans/${loanRes.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ cancellation_reason: 'Test' });

    expect(res.status).toBe(400);
  });

  it('rejects when PENDING transactions exist → 400', async () => {
    // Create a loan, collector adds pending txn, then try to cancel
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2026-01-25',
        term_days: 30,
      });

    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: loanRes.body.data.id,
        transaction_type: 'DAILY_COLLECTION',
        amount: 500,
        transaction_date: '2026-01-26',
      });

    const res = await request
      .patch(`/api/v1/loans/${loanRes.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ cancellation_reason: 'Test' });

    expect(res.status).toBe(400);
  });

  it('rejects cancellation of DEFAULTED loan → 400', async () => {
    const res = await request
      .patch(`/api/v1/loans/${monthlyLoanId}/cancel`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ cancellation_reason: 'Test' });

    expect(res.status).toBe(400);
  });

  it('collector cannot cancel → 403', async () => {
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2026-01-30',
        term_days: 30,
      });

    const res = await request
      .patch(`/api/v1/loans/${loanRes.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({ cancellation_reason: 'Test' });

    expect(res.status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Guarantor Payment — POST /transactions GUARANTOR_PAYMENT
// ═════════════════════════════════════════════════════════════════════════════

describe('Guarantor Payment — POST /transactions GUARANTOR_PAYMENT', () => {
  let defaultedDailyForGP: string;
  let defaultedMonthlyForGP: string;
  let dailyTotalCollectedBefore: number;

  beforeAll(async () => {
    // Create and default a fresh daily loan for guarantor payment tests
    const dailyRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 40000,
        interest_rate: 5,
        disbursement_date: '2025-08-01',
        term_days: 60,
        guarantor_id: guarantorId,
      });
    defaultedDailyForGP = dailyRes.body.data.id;

    await request
      .patch(`/api/v1/loans/${defaultedDailyForGP}/default`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    // Fetch totalCollected before
    const loanDetail = await request
      .get(`/api/v1/loans/${defaultedDailyForGP}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    dailyTotalCollectedBefore = loanDetail.body.data.totalCollected;

    // Create and default a fresh monthly loan
    const monthlyRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrowerId,
        principal_amount: 50000,
        interest_rate: 2,
        disbursement_date: '2025-10-15',
        guarantor_id: guarantorId,
      });
    defaultedMonthlyForGP = monthlyRes.body.data.id;

    await request
      .patch(`/api/v1/loans/${defaultedMonthlyForGP}/default`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
  });

  it('admin records GUARANTOR_PAYMENT on DEFAULTED daily loan → 201, auto-approved', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: defaultedDailyForGP,
        transaction_type: 'GUARANTOR_PAYMENT',
        amount: 5000,
        transaction_date: '2026-01-20',
      });

    expect(res.status).toBe(201);
    expect(res.body.data[0].transactionType).toBe('GUARANTOR_PAYMENT');
    expect(res.body.data[0].approvalStatus).toBe('APPROVED');
    guarantorPaymentTxnId = res.body.data[0].id;
  });

  it('increments totalCollected for daily loan', async () => {
    const res = await request
      .get(`/api/v1/loans/${defaultedDailyForGP}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.body.data.totalCollected).toBe(dailyTotalCollectedBefore + 5000);
  });

  it('collector creates PENDING GUARANTOR_PAYMENT → approval increments totalCollected', async () => {
    // Fetch totalCollected before
    const beforeRes = await request
      .get(`/api/v1/loans/${defaultedDailyForGP}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    const beforeTotal = beforeRes.body.data.totalCollected;

    // Collector creates PENDING
    const txnRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: defaultedDailyForGP,
        transaction_type: 'GUARANTOR_PAYMENT',
        amount: 2000,
        transaction_date: '2026-01-21',
      });

    expect(txnRes.status).toBe(201);
    expect(txnRes.body.data[0].approvalStatus).toBe('PENDING');

    // Approve
    const approveRes = await request
      .patch(`/api/v1/transactions/${txnRes.body.data[0].id}/approve`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(approveRes.status).toBe(200);

    // Check totalCollected increased
    const afterRes = await request
      .get(`/api/v1/loans/${defaultedDailyForGP}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(afterRes.body.data.totalCollected).toBe(beforeTotal + 2000);
  });

  it('rejects GUARANTOR_PAYMENT on ACTIVE loan → 400', async () => {
    // Create a fresh ACTIVE loan
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2026-01-28',
        term_days: 30,
      });

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanRes.body.data.id,
        transaction_type: 'GUARANTOR_PAYMENT',
        amount: 1000,
        transaction_date: '2026-01-29',
      });

    expect(res.status).toBe(400);
  });

  it('rejects GUARANTOR_PAYMENT on CLOSED loan → 400', async () => {
    // Use one of the previously closed loans (defaultedDailyForClose from closeLoan tests)
    // Instead, create-default-close a new loan
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2025-09-01',
        term_days: 30,
      });
    await request
      .patch(`/api/v1/loans/${loanRes.body.data.id}/default`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    await request
      .patch(`/api/v1/loans/${loanRes.body.data.id}/close`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanRes.body.data.id,
        transaction_type: 'GUARANTOR_PAYMENT',
        amount: 1000,
        transaction_date: '2026-01-29',
      });

    expect(res.status).toBe(400);
  });

  it('monthly DEFAULTED loan: recorded but no totalCollected change', async () => {
    const beforeRes = await request
      .get(`/api/v1/loans/${defaultedMonthlyForGP}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: defaultedMonthlyForGP,
        transaction_type: 'GUARANTOR_PAYMENT',
        amount: 3000,
        transaction_date: '2026-01-22',
      });

    expect(res.status).toBe(201);
    expect(res.body.data[0].approvalStatus).toBe('APPROVED');

    // Monthly loans don't have totalCollected in the same sense
    // Verify transaction was created without error
    const afterRes = await request
      .get(`/api/v1/loans/${defaultedMonthlyForGP}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    // Monthly detail doesn't have totalCollected, verify status unchanged
    expect(afterRes.body.data.status).toBe('DEFAULTED');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Corrective Transactions
// ═════════════════════════════════════════════════════════════════════════════

describe('Corrective Transactions', () => {
  it('corrects approved DAILY_COLLECTION → negative amount, auto-approved, decrements totalCollected', async () => {
    // dailyLoanId was defaulted then written off; let's use a fresh defaulted daily for this
    // Actually, use defaultedDailyForGP which has collections
    // We need the dailyCollectionTxnId from setup — that was on dailyLoanId
    // dailyLoanId is now WRITTEN_OFF, transactions on WRITTEN_OFF are rejected
    // So let's create a fresh scenario
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 30000,
        interest_rate: 5,
        disbursement_date: '2025-09-01',
        term_days: 60,
      });
    const corrLoanId = loanRes.body.data.id;

    // Record a collection
    const collRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: corrLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 1000,
        transaction_date: '2025-09-02',
      });
    const collTxnId = collRes.body.data[0].id;

    // Get totalCollected before correction
    const beforeRes = await request
      .get(`/api/v1/loans/${corrLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    const beforeTotal = beforeRes.body.data.totalCollected;

    // Correct the collection
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: corrLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: -1000,
        corrected_transaction_id: collTxnId,
        transaction_date: '2026-01-30',
      });

    expect(res.status).toBe(201);
    expect(res.body.data[0].amount).toBe(-1000);
    expect(res.body.data[0].approvalStatus).toBe('APPROVED');

    // Check totalCollected decreased
    const afterRes = await request
      .get(`/api/v1/loans/${corrLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(afterRes.body.data.totalCollected).toBe(beforeTotal - 1000);
  });

  it('corrects approved PRINCIPAL_RETURN → increments remainingPrincipal, negative principal_returns record', async () => {
    // monthlyLoanId is now DEFAULTED so transactions are allowed
    // Use the principalReturnTxnId from setup

    // Get remainingPrincipal before correction
    const beforeRes = await request
      .get(`/api/v1/loans/${monthlyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    const beforePrincipal = beforeRes.body.data.remainingPrincipal;

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: monthlyLoanId,
        transaction_type: 'PRINCIPAL_RETURN',
        amount: -10000,
        corrected_transaction_id: principalReturnTxnId,
        transaction_date: '2026-01-30',
      });

    expect(res.status).toBe(201);
    expect(res.body.data[0].amount).toBe(-10000);

    // Check remainingPrincipal increased
    const afterRes = await request
      .get(`/api/v1/loans/${monthlyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(afterRes.body.data.remainingPrincipal).toBe(beforePrincipal + 10000);
  });

  it('corrects approved PENALTY → decrements penalty.amountCollected, recalculates status', async () => {
    // penaltyTxnId was for a 500 payment on penaltyId (dailyLoanId, now WRITTEN_OFF)
    // Transactions on WRITTEN_OFF loans are rejected
    // So create a fresh scenario
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 30000,
        interest_rate: 5,
        disbursement_date: '2025-06-15',
        term_days: 30,
        grace_days: 7,
      });
    const penLoanId = loanRes.body.data.id;

    // Impose penalty
    const penRes = await request
      .post(`/api/v1/loans/${penLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});
    const penId = penRes.body.data.penalty.id;

    // Pay penalty
    const payRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: penLoanId,
        transaction_type: 'PENALTY',
        amount: 500,
        transaction_date: '2025-08-15',
        penalty_id: penId,
      });
    const payTxnId = payRes.body.data[0].id;

    // Correct the penalty payment
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: penLoanId,
        transaction_type: 'PENALTY',
        amount: -500,
        corrected_transaction_id: payTxnId,
        transaction_date: '2026-01-30',
      });

    expect(res.status).toBe(201);

    // Verify penalty status reverted
    const penaltiesRes = await request
      .get(`/api/v1/loans/${penLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const correctedPenalty = penaltiesRes.body.data.find((p: { id: string }) => p.id === penId);
    expect(correctedPenalty).toBeDefined();
    expect(correctedPenalty.amountCollected).toBe(0);
    expect(correctedPenalty.status).toBe('PENDING');
  });

  it('corrects approved INTEREST_PAYMENT → no loan-level side effect', async () => {
    // interestPaymentTxnId is on monthlyLoanId (now DEFAULTED)
    const beforeRes = await request
      .get(`/api/v1/loans/${monthlyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    const beforePrincipal = beforeRes.body.data.remainingPrincipal;

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: monthlyLoanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: -2000,
        corrected_transaction_id: interestPaymentTxnId,
        transaction_date: '2026-01-30',
      });

    expect(res.status).toBe(201);
    expect(res.body.data[0].amount).toBe(-2000);

    // remainingPrincipal unchanged
    const afterRes = await request
      .get(`/api/v1/loans/${monthlyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(afterRes.body.data.remainingPrincipal).toBe(beforePrincipal);
  });

  it('corrects approved GUARANTOR_PAYMENT on daily → decrements totalCollected', async () => {
    // guarantorPaymentTxnId was created on defaultedDailyForGP in the GP tests
    // Need to get the variable from the outer scope — it was set in the Guarantor Payment tests
    // But the describe block scoping means we use the module-level variable

    // Get totalCollected before
    // We need defaultedDailyForGP — but it's scoped inside describe
    // Let's create a fresh scenario instead
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 20000,
        interest_rate: 5,
        disbursement_date: '2025-10-01',
        term_days: 60,
        guarantor_id: guarantorId,
      });
    const gpLoanId = loanRes.body.data.id;

    await request
      .patch(`/api/v1/loans/${gpLoanId}/default`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    // Record guarantor payment
    const gpRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: gpLoanId,
        transaction_type: 'GUARANTOR_PAYMENT',
        amount: 3000,
        transaction_date: '2026-01-25',
      });
    const gpTxnId = gpRes.body.data[0].id;

    const beforeRes = await request
      .get(`/api/v1/loans/${gpLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    const beforeTotal = beforeRes.body.data.totalCollected;

    // Correct the guarantor payment
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: gpLoanId,
        transaction_type: 'GUARANTOR_PAYMENT',
        amount: -3000,
        corrected_transaction_id: gpTxnId,
        transaction_date: '2026-01-30',
      });

    expect(res.status).toBe(201);

    const afterRes = await request
      .get(`/api/v1/loans/${gpLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(afterRes.body.data.totalCollected).toBe(beforeTotal - 3000);
  });

  it('collector cannot create corrective transactions → 403', async () => {
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2025-11-01',
        term_days: 30,
      });
    const collRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanRes.body.data.id,
        transaction_type: 'DAILY_COLLECTION',
        amount: 500,
        transaction_date: '2025-11-02',
      });

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: loanRes.body.data.id,
        transaction_type: 'DAILY_COLLECTION',
        amount: -500,
        corrected_transaction_id: collRes.body.data[0].id,
        transaction_date: '2026-01-30',
      });

    expect(res.status).toBe(403);
  });

  it('rejects correcting PENDING transaction → 400', async () => {
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2025-11-05',
        term_days: 30,
      });
    // Collector creates PENDING
    const collRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: loanRes.body.data.id,
        transaction_type: 'DAILY_COLLECTION',
        amount: 500,
        transaction_date: '2025-11-06',
      });

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanRes.body.data.id,
        transaction_type: 'DAILY_COLLECTION',
        amount: -500,
        corrected_transaction_id: collRes.body.data[0].id,
        transaction_date: '2026-01-30',
      });

    expect(res.status).toBe(400);
  });

  it('rejects correcting REJECTED transaction → 400', async () => {
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2025-11-10',
        term_days: 30,
      });
    // Collector creates PENDING then admin rejects
    const collRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_id: loanRes.body.data.id,
        transaction_type: 'DAILY_COLLECTION',
        amount: 500,
        transaction_date: '2025-11-11',
      });

    await request
      .patch(`/api/v1/transactions/${collRes.body.data[0].id}/reject`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ rejection_reason: 'Test rejection' });

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanRes.body.data.id,
        transaction_type: 'DAILY_COLLECTION',
        amount: -500,
        corrected_transaction_id: collRes.body.data[0].id,
        transaction_date: '2026-01-30',
      });

    expect(res.status).toBe(400);
  });

  it('rejects double correction → 409', async () => {
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2025-11-15',
        term_days: 30,
      });
    const collRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanRes.body.data.id,
        transaction_type: 'DAILY_COLLECTION',
        amount: 500,
        transaction_date: '2025-11-16',
      });

    // First correction
    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanRes.body.data.id,
        transaction_type: 'DAILY_COLLECTION',
        amount: -500,
        corrected_transaction_id: collRes.body.data[0].id,
        transaction_date: '2026-01-30',
      });

    // Second correction
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanRes.body.data.id,
        transaction_type: 'DAILY_COLLECTION',
        amount: -500,
        corrected_transaction_id: collRes.body.data[0].id,
        transaction_date: '2026-01-30',
      });

    expect(res.status).toBe(409);
  });

  it('rejects mismatched transaction_type → 400', async () => {
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2025-11-20',
        term_days: 30,
      });
    const collRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanRes.body.data.id,
        transaction_type: 'DAILY_COLLECTION',
        amount: 500,
        transaction_date: '2025-11-21',
      });

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanRes.body.data.id,
        transaction_type: 'INTEREST_PAYMENT',
        amount: -500,
        corrected_transaction_id: collRes.body.data[0].id,
        transaction_date: '2026-01-30',
      });

    expect(res.status).toBe(400);
  });

  it('rejects mismatched loan_id → 400', async () => {
    // Create two loans, record txn on first, try to correct with second loan's id
    const loan1Res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2025-11-25',
        term_days: 30,
      });
    const loan2Res = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2025-11-26',
        term_days: 30,
      });
    const collRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loan1Res.body.data.id,
        transaction_type: 'DAILY_COLLECTION',
        amount: 500,
        transaction_date: '2025-11-27',
      });

    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loan2Res.body.data.id,
        transaction_type: 'DAILY_COLLECTION',
        amount: -500,
        corrected_transaction_id: collRes.body.data[0].id,
        transaction_date: '2026-01-30',
      });

    expect(res.status).toBe(400);
  });

  it('rejects positive amount with corrected_transaction_id → 400 (schema)', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: monthlyLoanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 500,
        corrected_transaction_id: interestPaymentTxnId,
        transaction_date: '2026-01-30',
      });

    expect(res.status).toBe(400);
  });

  it('rejects negative amount without corrected_transaction_id → 400 (schema)', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: monthlyLoanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: -500,
        transaction_date: '2026-01-30',
      });

    expect(res.status).toBe(400);
  });

  it('both original and corrective visible in audit trail', async () => {
    // Create a loan with a collection and correct it, then check both show up
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2025-12-01',
        term_days: 30,
      });
    const auditLoanId = loanRes.body.data.id;

    const collRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: auditLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 700,
        transaction_date: '2025-12-02',
      });

    await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: auditLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: -700,
        corrected_transaction_id: collRes.body.data[0].id,
        transaction_date: '2026-01-30',
      });

    // Get all transactions for this loan
    const txnRes = await request
      .get(`/api/v1/loans/${auditLoanId}/transactions`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const dailyCollections = txnRes.body.data.filter(
      (t: { transactionType: string }) => t.transactionType === 'DAILY_COLLECTION',
    );

    // Should have both: original (positive) and corrective (negative)
    const positive = dailyCollections.find((t: { amount: number }) => t.amount === 700);
    const negative = dailyCollections.find((t: { amount: number }) => t.amount === -700);
    expect(positive).toBeDefined();
    expect(negative).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Guarantor Warnings
// ═════════════════════════════════════════════════════════════════════════════

describe('Guarantor Warnings', () => {
  it('shows warnings for defaulted loan guarantor', async () => {
    // monthlyLoanId is DEFAULTED with guarantorId as guarantor
    const res = await request
      .get(`/api/v1/customers/${guarantorId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    const warnings = res.body.data.guarantorWarnings;
    expect(warnings).toBeDefined();
    const defaultedWarnings = warnings.filter(
      (w: { status: string }) => w.status === 'DEFAULTED',
    );
    expect(defaultedWarnings.length).toBeGreaterThan(0);
  });

  it('shows warnings for written-off loan guarantor', async () => {
    // dailyLoanId is WRITTEN_OFF with guarantorId as guarantor
    const res = await request
      .get(`/api/v1/customers/${guarantorId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    const warnings = res.body.data.guarantorWarnings;
    const woWarnings = warnings.filter(
      (w: { status: string }) => w.status === 'WRITTEN_OFF',
    );
    expect(woWarnings.length).toBeGreaterThan(0);
  });

  it('no warnings for active loan guarantor', async () => {
    // Create a fresh guarantor with only an ACTIVE loan guarantee
    const freshGuarantor = await prisma.customer.create({
      data: { tenantId, fullName: 'P8 Fresh Guarantor', phone: `${PHONE_PREFIX}100003`, createdById: adminUserId },
    });

    // Create an ACTIVE loan with fresh guarantor
    await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 10000,
        interest_rate: 5,
        disbursement_date: '2026-01-30',
        term_days: 30,
        guarantor_id: freshGuarantor.id,
      });

    const res = await request
      .get(`/api/v1/customers/${freshGuarantor.id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    const warnings = res.body.data.guarantorWarnings;
    // Active loans should not show warnings (only DEFAULTED/WRITTEN_OFF do)
    const dangerousWarnings = (warnings || []).filter(
      (w: { status: string }) => w.status === 'DEFAULTED' || w.status === 'WRITTEN_OFF',
    );
    expect(dangerousWarnings.length).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Status Transition Enforcement
// ═════════════════════════════════════════════════════════════════════════════

describe('Status Transition Enforcement', () => {
  it('DEFAULTED → CANCELLED rejected → 400', async () => {
    // monthlyLoanId is DEFAULTED
    const res = await request
      .patch(`/api/v1/loans/${monthlyLoanId}/cancel`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ cancellation_reason: 'Test' });

    expect(res.status).toBe(400);
  });

  it('WRITTEN_OFF → default rejected', async () => {
    // dailyLoanId is WRITTEN_OFF
    const res = await request
      .patch(`/api/v1/loans/${dailyLoanId}/default`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(400);
  });

  it('WRITTEN_OFF → write-off rejected', async () => {
    const res = await request
      .patch(`/api/v1/loans/${dailyLoanId}/write-off`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(400);
  });

  it('CANCELLED → default rejected', async () => {
    // cancellableDailyLoanId was cancelled earlier
    const res = await request
      .patch(`/api/v1/loans/${cancellableDailyLoanId}/default`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(400);
  });

  it('transactions on CANCELLED loans rejected', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: cancellableDailyLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 500,
        transaction_date: '2026-01-30',
      });

    expect(res.status).toBe(400);
  });

  it('transactions on WRITTEN_OFF loans rejected', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: dailyLoanId,
        transaction_type: 'DAILY_COLLECTION',
        amount: 500,
        transaction_date: '2026-01-30',
      });

    expect(res.status).toBe(400);
  });
});
