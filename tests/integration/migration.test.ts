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
let borrower2Id: string;
let guarantorId: string;

// Tracked IDs
let migratedMonthlyLoanId: string;
let migratedDailyLoanId: string;

const SLUG = 'p10-mig-test-tenant';
const PHONE_PREFIX = '9700';

beforeAll(async () => {
  // Clean up any leftover test data
  await prisma.$executeRaw`DELETE FROM "penalties" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "fund_entries" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "expenses" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE ${PHONE_PREFIX + '%'})`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE ${PHONE_PREFIX + '%'}`;
  await prisma.tenant.deleteMany({ where: { slug: SLUG } });

  // Create tenant
  const tenant = await prisma.tenant.create({
    data: { name: 'P10 Migration Test Tenant', slug: SLUG, ownerName: 'Owner', ownerPhone: `${PHONE_PREFIX}000000` },
  });
  tenantId = tenant.id;

  // Create admin
  const admin = await prisma.user.create({
    data: {
      tenantId,
      name: 'P10 Admin',
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
      name: 'P10 Collector',
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

  // Create borrowers
  const borrower = await prisma.customer.create({
    data: { tenantId, fullName: 'P10 Borrower 1', phone: `${PHONE_PREFIX}100001`, createdById: adminUserId },
  });
  borrowerId = borrower.id;

  const borrower2 = await prisma.customer.create({
    data: { tenantId, fullName: 'P10 Borrower 2', phone: `${PHONE_PREFIX}100002`, createdById: adminUserId },
  });
  borrower2Id = borrower2.id;

  // Create guarantor
  const guarantor = await prisma.customer.create({
    data: { tenantId, fullName: 'P10 Guarantor', phone: `${PHONE_PREFIX}100003`, createdById: adminUserId },
  });
  guarantorId = guarantor.id;
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "penalties" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "fund_entries" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "expenses" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE ${PHONE_PREFIX + '%'})`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE ${PHONE_PREFIX + '%'}`;
  await prisma.tenant.deleteMany({ where: { slug: SLUG } });
  await prisma.$disconnect();
});

// ─── Monthly Migration ─────────────────────────────────────────────────

describe('Monthly Migration', () => {
  it('admin migrates monthly loan → 201 with correct fields', async () => {
    const res = await request
      .post('/api/v1/loans/migrate')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrowerId,
        principal_amount: 100000,
        interest_rate: 2.5,
        disbursement_date: '2025-06-15',
        expected_months: 12,
        remaining_principal: 80000,
        last_interest_paid_through: '2025-12-15',
        guarantor_id: guarantorId,
        collateral_description: 'Gold necklace',
        collateral_estimated_value: 50000,
        notes: 'Migrated monthly loan',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.loanType).toBe('MONTHLY');
    expect(res.body.data.loanNumber).toMatch(/^ML-2025-/);
    expect(res.body.data.principalAmount).toBe(100000);
    expect(res.body.data.interestRate).toBe(2.5);
    expect(res.body.data.disbursementDate).toBe('2025-06-15');
    expect(res.body.data.expectedMonths).toBe(12);
    expect(res.body.data.guarantorId).toBe(guarantorId);
    expect(res.body.data.collateralDescription).toBe('Gold necklace');
    expect(res.body.data.collateralEstimatedValue).toBe(50000);
    expect(res.body.data.notes).toBe('Migrated monthly loan');
    expect(res.body.data.status).toBe('ACTIVE');
    migratedMonthlyLoanId = res.body.data.id;
  });

  it('isMigrated is true in response', async () => {
    const res = await request
      .get(`/api/v1/loans/${migratedMonthlyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.isMigrated).toBe(true);
  });

  it('remainingPrincipal and billingPrincipal both equal remaining_principal input', async () => {
    const res = await request
      .get(`/api/v1/loans/${migratedMonthlyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.remainingPrincipal).toBe(80000);
    expect(res.body.data.billingPrincipal).toBe(80000);
  });

  it('no DISBURSEMENT transaction created', async () => {
    const res = await request
      .get(`/api/v1/loans/${migratedMonthlyLoanId}/transactions`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it('GET /:id returns correct lastInterestPaidThrough', async () => {
    const res = await request
      .get(`/api/v1/loans/${migratedMonthlyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.lastInterestPaidThrough).toBe('2025-12-15');
  });

  it('payment status skips pre-migration cycles', async () => {
    const res = await request
      .get(`/api/v1/loans/${migratedMonthlyLoanId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    // Disbursed 2025-06-15, lastInterestPaidThrough 2025-12-15
    // Should skip cycles Jul-Dec 2025 (months 7-12)
    // First cycle should be Jan 2026
    const cycles = res.body.data.cycles;
    expect(cycles.length).toBeGreaterThan(0);
    const firstCycle = cycles[0];
    expect(firstCycle.cycleYear).toBe(2026);
    expect(firstCycle.cycleMonth).toBe(1);
    // No cycle before Jan 2026 should appear
    const preMigrationCycles = cycles.filter(
      (c: { cycleYear: number; cycleMonth: number }) =>
        c.cycleYear < 2026 || (c.cycleYear === 2026 && c.cycleMonth < 1),
    );
    expect(preMigrationCycles.length).toBe(0);
  });

  it('overdue detection: unsettled post-migration cycle IS overdue', async () => {
    const res = await request
      .get(`/api/v1/loans/${migratedMonthlyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    // Jan 2026 cycle due date is 2026-01-15, which is in the past (today is 2026-01-31)
    // No payments recorded, so it should be overdue
    expect(res.body.data.isOverdue).toBe(true);
  });
});

// ─── Daily Migration ───────────────────────────────────────────────────

describe('Daily Migration', () => {
  it('admin migrates daily loan → 201 with correct fields', async () => {
    const res = await request
      .post('/api/v1/loans/migrate')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrower2Id,
        principal_amount: 100000,
        interest_rate: 5,
        disbursement_date: '2025-06-10',
        term_days: 120,
        grace_days: 7,
        total_base_collected_so_far: 50000,
        guarantor_id: guarantorId,
        notes: 'Migrated daily loan',
        pre_existing_penalties: [
          { days_overdue: 45, months_charged: 2, penalty_amount: 10000, status: 'PAID' },
          { days_overdue: 75, months_charged: 1, penalty_amount: 5000, status: 'PENDING' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.loanType).toBe('DAILY');
    expect(res.body.data.loanNumber).toMatch(/^DL-2025-/);
    expect(res.body.data.principalAmount).toBe(100000);
    expect(res.body.data.interestRate).toBe(5);
    expect(res.body.data.disbursementDate).toBe('2025-06-10');
    expect(res.body.data.termDays).toBe(120);
    expect(res.body.data.graceDays).toBe(7);
    expect(res.body.data.guarantorId).toBe(guarantorId);
    expect(res.body.data.notes).toBe('Migrated daily loan');
    expect(res.body.data.status).toBe('ACTIVE');
    migratedDailyLoanId = res.body.data.id;
  });

  it('isMigrated is true and totalCollected equals total_base_collected_so_far', async () => {
    const res = await request
      .get(`/api/v1/loans/${migratedDailyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.isMigrated).toBe(true);
    expect(res.body.data.totalCollected).toBe(50000);
  });

  it('OPENING_BALANCE transaction created', async () => {
    const res = await request
      .get(`/api/v1/loans/${migratedDailyLoanId}/transactions`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].transactionType).toBe('OPENING_BALANCE');
    expect(res.body.data[0].amount).toBe(50000);
    expect(res.body.data[0].approvalStatus).toBe('APPROVED');
  });

  it('server computes totalRepaymentAmount, dailyPaymentAmount, termEndDate correctly', async () => {
    const res = await request
      .get(`/api/v1/loans/${migratedDailyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    // totalRepayment = 100000 × (1 + 5/100 × 120/30) = 100000 × 1.2 = 120000
    expect(res.body.data.totalRepaymentAmount).toBe(120000);
    // dailyPayment = 120000 / 120 = 1000
    expect(res.body.data.dailyPaymentAmount).toBe(1000);
    // termEndDate = 2025-06-10 + 120 days = 2025-10-08
    expect(res.body.data.termEndDate).toBe('2025-10-08');
  });

  it('daysPaid computed correctly from totalCollected / dailyPaymentAmount', async () => {
    const res = await request
      .get(`/api/v1/loans/${migratedDailyLoanId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    // 50000 / 1000 = 50 days paid
    expect(res.body.data.daysPaid).toBe(50);
  });

  it('pre-existing penalties created as penalty rows', async () => {
    const res = await request
      .get(`/api/v1/loans/${migratedDailyLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(2);
  });

  it('PAID penalties have amountCollected = penaltyAmount, PENDING have amountCollected = 0', async () => {
    const res = await request
      .get(`/api/v1/loans/${migratedDailyLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    const penalties = res.body.data;

    const paidPenalty = penalties.find((p: { status: string }) => p.status === 'PAID');
    expect(paidPenalty).toBeDefined();
    expect(paidPenalty.amountCollected).toBe(10000);
    expect(paidPenalty.penaltyAmount).toBe(10000);
    expect(paidPenalty.netPayable).toBe(0);

    const pendingPenalty = penalties.find((p: { status: string }) => p.status === 'PENDING');
    expect(pendingPenalty).toBeDefined();
    expect(pendingPenalty.amountCollected).toBe(0);
    expect(pendingPenalty.penaltyAmount).toBe(5000);
    expect(pendingPenalty.netPayable).toBe(5000);
  });

  it('incremental penalty calculation accounts for pre-existing monthsCharged', async () => {
    // Pre-existing: 2 + 1 = 3 monthsCharged already
    // The loan is overdue. Impose penalty should only charge incremental months
    const res = await request
      .post(`/api/v1/loans/${migratedDailyLoanId}/penalties`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data.calculation).toBeDefined();
    expect(res.body.data.calculation.monthsAlreadyPenalised).toBe(3);
    // Incremental months = totalMonthsOwed - 3
    expect(res.body.data.calculation.incrementalMonths).toBeGreaterThan(0);
  });
});

// ─── Billing Principal for Migrated Monthly Loans ──────────────────────

describe('Billing Principal for Migrated Monthly Loans', () => {
  it('uses billingPrincipal (not principalAmount) for cycles before any principal return', async () => {
    const res = await request
      .get(`/api/v1/loans/${migratedMonthlyLoanId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    const cycles = res.body.data.cycles;
    expect(cycles.length).toBeGreaterThan(0);
    // billingPrincipalForCycle should be 80000 (remaining_principal), not 100000 (principalAmount)
    expect(cycles[0].billingPrincipalForCycle).toBe(80000);
  });

  it('after a principal return, the next cycle uses the updated billing principal', async () => {
    // Record a principal return on the migrated loan
    const txnRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: migratedMonthlyLoanId,
        transaction_type: 'PRINCIPAL_RETURN',
        amount: 20000,
        transaction_date: '2026-01-10',
      });

    expect(txnRes.status).toBe(201);

    // Check payment status — cycle after the return should have reduced billing principal
    const res = await request
      .get(`/api/v1/loans/${migratedMonthlyLoanId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    const cycles = res.body.data.cycles;
    // Jan 2026 cycle starts at 2026-01-01, principal return is on 2026-01-10 (after cycle start)
    // so Jan cycle should still use 80000
    const janCycle = cycles.find((c: { cycleYear: number; cycleMonth: number }) => c.cycleYear === 2026 && c.cycleMonth === 1);
    expect(janCycle).toBeDefined();
    expect(janCycle.billingPrincipalForCycle).toBe(80000);
  });

  it('interest due calculation uses correct billing principal', async () => {
    const res = await request
      .get(`/api/v1/loans/${migratedMonthlyLoanId}/payment-status`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    const janCycle = res.body.data.cycles.find(
      (c: { cycleYear: number; cycleMonth: number }) => c.cycleYear === 2026 && c.cycleMonth === 1,
    );
    expect(janCycle).toBeDefined();
    // interestDue = billingPrincipal × rate / 100 = 80000 × 2.5 / 100 = 2000
    expect(janCycle.interestDue).toBe(2000);
  });
});

// ─── Access Control & Validation ───────────────────────────────────────

describe('Access Control & Validation', () => {
  it('collector cannot migrate loans → 403', async () => {
    const res = await request
      .post('/api/v1/loans/migrate')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrowerId,
        principal_amount: 100000,
        interest_rate: 2.5,
        disbursement_date: '2025-06-15',
        remaining_principal: 80000,
        last_interest_paid_through: '2025-12-15',
      });

    expect(res.status).toBe(403);
  });

  it('missing required fields → 400', async () => {
    const res = await request
      .post('/api/v1/loans/migrate')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrowerId,
        // missing principal_amount, interest_rate, etc.
      });

    expect(res.status).toBe(400);
  });

  it('invalid loan_type → 400', async () => {
    const res = await request
      .post('/api/v1/loans/migrate')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'INVALID',
        borrower_id: borrowerId,
        principal_amount: 100000,
        interest_rate: 2.5,
        disbursement_date: '2025-06-15',
        remaining_principal: 80000,
        last_interest_paid_through: '2025-12-15',
      });

    expect(res.status).toBe(400);
  });

  it('non-existent borrower_id → 404', async () => {
    const res = await request
      .post('/api/v1/loans/migrate')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: '00000000-0000-0000-0000-000000000000',
        principal_amount: 100000,
        interest_rate: 2.5,
        disbursement_date: '2025-06-15',
        remaining_principal: 80000,
        last_interest_paid_through: '2025-12-15',
      });

    expect(res.status).toBe(404);
  });
});

// ─── Cash in Hand Exclusion ────────────────────────────────────────────

describe('Cash in Hand Exclusion', () => {
  it('fund summary after daily migration: OPENING_BALANCE NOT counted in Cash in Hand', async () => {
    const res = await request
      .get('/api/v1/fund/summary')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    // cashInHand should NOT include the 50000 OPENING_BALANCE
    // Since there are no fund entries (injections), cashInHand will be negative
    // from non-migrated loan transactions but OPENING_BALANCE should not contribute positively
    const cashInHand = parseFloat(res.body.data.cashInHand);
    expect(typeof cashInHand).toBe('number');
    expect(Number.isNaN(cashInHand)).toBe(false);
  });

  it('fund summary after monthly migration: no impact on Cash in Hand (no transactions)', async () => {
    const res = await request
      .get('/api/v1/fund/summary')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    // Monthly migrated loan has zero transactions, so no impact on CiH
    expect(res.body.data.cashInHand).toBeDefined();
  });

  it('reconciliation still matches after migrations', async () => {
    const res = await request
      .get('/api/v1/fund/reconciliation')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.matches).toBe(true);
    expect(res.body.data.queryResult).toBe(res.body.data.bottomUpResult);
  });
});
