import { jest } from '@jest/globals';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import app from '../../src/app.js';
import prisma from '../helpers/prisma';

jest.setTimeout(60_000);

const request = supertest(app);

let tenantId: string;
let adminAccessToken: string;
let adminUserId: string;
let borrowerId: string;
let guarantorId: string;
let dailyLoanId: string;
let monthlyLoanId: string;
let dailyGuarantorPaymentId: string;

const SLUG = 'recovery-test-tenant';
const PHONE_PREFIX = '8800';

// Wide enough to hold every loan and payment in this file, including "defaulted just now".
const ALL_TIME = 'from=2025-01-01&to=2099-12-31';

async function cleanUp() {
  await prisma.$executeRaw`DELETE FROM "penalties" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = ${SLUG})`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE ${PHONE_PREFIX + '%'})`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE ${PHONE_PREFIX + '%'}`;
  await prisma.tenant.deleteMany({ where: { slug: SLUG } });
}

async function fundSummary() {
  const res = await request.get('/api/v1/fund/summary').set('Authorization', `Bearer ${adminAccessToken}`);
  expect(res.status).toBe(200);
  return res.body.data;
}

async function profitLoss(range: string) {
  const res = await request
    .get(`/api/v1/reports/profit-loss?${range}`)
    .set('Authorization', `Bearer ${adminAccessToken}`);
  expect(res.status).toBe(200);
  return res.body.data;
}

async function defaulterAmount(loanId: string): Promise<string> {
  const res = await request.get('/api/v1/dashboard/defaulters').set('Authorization', `Bearer ${adminAccessToken}`);
  expect(res.status).toBe(200);
  const row = res.body.data.defaulters.find((d: { loanId: string }) => d.loanId === loanId);
  expect(row).toBeDefined();
  return row.outstandingAmount;
}

beforeAll(async () => {
  await cleanUp();

  const tenant = await prisma.tenant.create({
    data: { name: 'Recovery Test Tenant', slug: SLUG, ownerName: 'Owner', ownerPhone: `${PHONE_PREFIX}000000` },
  });
  tenantId = tenant.id;

  const admin = await prisma.user.create({
    data: {
      tenantId,
      name: 'Recovery Admin',
      phone: `${PHONE_PREFIX}000001`,
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });
  adminUserId = admin.id;

  const adminLogin = await request
    .post('/api/v1/auth/login')
    .send({ phone: `${PHONE_PREFIX}000001`, password: 'Admin@123' });
  adminAccessToken = adminLogin.body.data.access_token;

  const borrower = await prisma.customer.create({
    data: { tenantId, fullName: 'Recovery Borrower', phone: `${PHONE_PREFIX}100001`, createdById: adminUserId },
  });
  borrowerId = borrower.id;

  const guarantor = await prisma.customer.create({
    data: { tenantId, fullName: 'Recovery Guarantor', phone: `${PHONE_PREFIX}100002`, createdById: adminUserId },
  });
  guarantorId = guarantor.id;

  // Daily loan: 20,000 at 5% for 120 days → 4 months of interest → 24,000 to repay.
  // Of every rupee collected, 5/6 is principal and 1/6 is interest.
  const dailyRes = await request
    .post('/api/v1/loans')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'DAILY',
      borrower_id: borrowerId,
      principal_amount: 20000,
      interest_rate: 5,
      disbursement_date: '2026-01-01',
      term_days: 120,
      guarantor_id: guarantorId,
    });
  expect(dailyRes.status).toBe(201);
  expect(dailyRes.body.data.totalRepaymentAmount).toBe(24000);
  dailyLoanId = dailyRes.body.data.id;

  // The borrower pays 14,400 and then stops.
  const collectionRes = await request
    .post('/api/v1/transactions')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_id: dailyLoanId,
      transaction_type: 'DAILY_COLLECTION',
      amount: 14400,
      transaction_date: '2026-02-01',
    });
  expect(collectionRes.status).toBe(201);

  const dailyDefault = await request
    .patch(`/api/v1/loans/${dailyLoanId}/default`)
    .set('Authorization', `Bearer ${adminAccessToken}`);
  expect(dailyDefault.status).toBe(200);

  // Monthly loan: 50,000, no payments, defaulted.
  const monthlyRes = await request
    .post('/api/v1/loans')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({
      loan_type: 'MONTHLY',
      borrower_id: borrowerId,
      principal_amount: 50000,
      interest_rate: 2,
      disbursement_date: '2026-01-10',
      guarantor_id: guarantorId,
    });
  expect(monthlyRes.status).toBe(201);
  monthlyLoanId = monthlyRes.body.data.id;

  const monthlyDefault = await request
    .patch(`/api/v1/loans/${monthlyLoanId}/default`)
    .set('Authorization', `Bearer ${adminAccessToken}`);
  expect(monthlyDefault.status).toBe(200);
});

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

describe('Recoveries on defaulted loans', () => {
  it('before any recovery: the loss is the principal not yet paid back', async () => {
    const summary = await fundSummary();

    // Daily: 20,000 × (24,000 − 14,400) / 24,000 = 8,000. Monthly: 50,000.
    expect(summary.moneyLostToDefaults).toBe('58000.00');
    // 14,400 × 4,000 / 24,000
    expect(summary.totalInterestEarned).toBe('2400.00');
    expect(summary.netProfit).toBe('-55600.00');

    expect(await defaulterAmount(dailyLoanId)).toBe('8000.00');
    expect(await defaulterAmount(monthlyLoanId)).toBe('50000.00');
  });

  it('guarantor payment on a daily loan is split like any other rupee, and counted once', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: dailyLoanId,
        transaction_type: 'GUARANTOR_PAYMENT',
        amount: 2000,
        transaction_date: '2026-03-01',
      });
    expect(res.status).toBe(201);
    dailyGuarantorPaymentId = res.body.data[0].id;

    const summary = await fundSummary();

    // 2,000 received: 1,666.67 is principal, 333.33 is interest.
    // Daily loss: 20,000 × (24,000 − 16,400) / 24,000 = 6,333.33. Monthly still 50,000.
    expect(summary.moneyLostToDefaults).toBe('56333.33');
    // 16,400 × 4,000 / 24,000
    expect(summary.totalInterestEarned).toBe('2733.33');
    // Profit moves by exactly the 2,000 received.
    expect(summary.netProfit).toBe('-53600.00');

    expect(await defaulterAmount(dailyLoanId)).toBe('6333.33');
  });

  it('guarantor payment on a monthly loan lowers the loss by the full amount, in the total and on the loan', async () => {
    const res = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: monthlyLoanId,
        transaction_type: 'GUARANTOR_PAYMENT',
        amount: 3000,
        transaction_date: '2026-03-05',
      });
    expect(res.status).toBe(201);

    const summary = await fundSummary();

    // 6,333.33 + (50,000 − 3,000)
    expect(summary.moneyLostToDefaults).toBe('53333.33');
    expect(summary.totalInterestEarned).toBe('2733.33');
    expect(summary.netProfit).toBe('-50600.00');

    // The loan's own figure agrees with its share of the total.
    expect(await defaulterAmount(monthlyLoanId)).toBe('47000.00');
    expect(await defaulterAmount(dailyLoanId)).toBe('6333.33');
  });

  it('profit and loss over all dates agrees with the fund summary', async () => {
    const summary = await fundSummary();
    const pl = await profitLoss(ALL_TIME);

    expect(pl.moneyLostToDefaults).toBe(summary.moneyLostToDefaults);
    expect(pl.totalInterestEarned).toBe(summary.totalInterestEarned);
    expect(pl.netProfit).toBe(summary.netProfit);
  });

  it('profit and loss recognises the interest share on the day the guarantor paid', async () => {
    const pl = await profitLoss('from=2026-03-01&to=2026-03-01');

    // 2,000 × 4,000 / 24,000
    expect(pl.totalInterestEarned).toBe('333.33');
    expect(pl.totalReceived).toBe('2000.00');
  });

  it('removing the guarantor payment puts every figure back', async () => {
    const res = await request
      .post(`/api/v1/transactions/${dailyGuarantorPaymentId}/remove`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ reason: 'Recorded by mistake' });
    expect(res.status).toBe(200);

    const summary = await fundSummary();

    // Daily back to 8,000; monthly stays at 47,000.
    expect(summary.moneyLostToDefaults).toBe('55000.00');
    expect(summary.totalInterestEarned).toBe('2400.00');
    expect(summary.netProfit).toBe('-52600.00');

    const pl = await profitLoss(ALL_TIME);
    expect(pl.moneyLostToDefaults).toBe('55000.00');
    expect(pl.totalInterestEarned).toBe('2400.00');
    expect(pl.netProfit).toBe('-52600.00');

    expect(await defaulterAmount(dailyLoanId)).toBe('8000.00');
  });
});
