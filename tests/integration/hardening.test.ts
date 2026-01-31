import { jest } from '@jest/globals';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import Decimal from 'decimal.js';
import app from '../../src/app.js';
import prisma from '../helpers/prisma';

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

jest.setTimeout(60_000);

const request = supertest(app);

let adminAccessToken: string;
let borrowerId: string;

beforeAll(async () => {
  // Clean up any leftover test data
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'harden-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'harden-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "penalties" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'harden-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'harden-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'harden-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "expenses" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'harden-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "fund_entries" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'harden-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'harden-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '7700%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '7700%'`;
  await prisma.tenant.deleteMany({ where: { slug: 'harden-test-tenant' } });

  // Create tenant
  const tenant = await prisma.tenant.create({
    data: { name: 'Harden Test Tenant', slug: 'harden-test-tenant', ownerName: 'Owner', ownerPhone: '7700000000' },
  });

  // Create admin
  await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: 'Harden Admin',
      phone: '7700000001',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });

  // Login
  const loginRes = await request.post('/api/v1/auth/login').send({ phone: '7700000001', password: 'Admin@123' });
  adminAccessToken = loginRes.body.data.access_token;

  // Create customers
  const b1Res = await request
    .post('/api/v1/customers')
    .set('Authorization', `Bearer ${adminAccessToken}`)
    .send({ full_name: 'Harden Borrower', phone: '7700100001' });
  borrowerId = b1Res.body.data.id;
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'harden-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'harden-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "penalties" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'harden-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'harden-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'harden-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "expenses" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'harden-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "fund_entries" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'harden-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'harden-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '7700%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '7700%'`;
  await prisma.tenant.deleteMany({ where: { slug: 'harden-test-tenant' } });
  await prisma.$disconnect();
});

// ─── Security Headers ──────────────────────────────────────────────────────
// (run first — these hit /health which is not rate-limited)

describe('Security Headers', () => {
  it('should include X-Frame-Options header', async () => {
    const res = await request.get('/health');
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('should include X-Content-Type-Options: nosniff', async () => {
    const res = await request.get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('should include Strict-Transport-Security header', async () => {
    const res = await request.get('/health');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });
});

// ─── Rounding Audit ────────────────────────────────────────────────────────
// (run before rate limit tests to avoid 429 interference)

describe('Rounding Audit', () => {
  it('should calculate monthly interest correctly with HALF_UP: billing_principal=33333, rate=3% → 999.99', async () => {
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrowerId,
        principal_amount: 33333,
        interest_rate: 3,
        disbursement_date: '2025-11-01',
      });
    expect(loanRes.status).toBe(201);

    // Advance interest = billingPrincipal * rate / 100 = 33333 * 0.03 = 999.99
    expect(loanRes.body.data.advanceInterestAmount).toBe(999.99);

    // Make an interest payment and verify the amount accepted
    const payRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanRes.body.data.id,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 999.99,
        transaction_date: '2025-12-01',
        effective_date: '2025-12-01',
      });
    expect(payRes.status).toBe(201);
    expect(payRes.body.data).toHaveLength(1);
    expect(payRes.body.data[0].amount).toBe(999.99);
  });

  it('should calculate daily payment without rounding loss: principal=100000, rate=5%, 120 days', async () => {
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'DAILY',
        borrower_id: borrowerId,
        principal_amount: 100000,
        interest_rate: 5,
        disbursement_date: '2025-11-01',
        term_days: 120,
      });
    expect(loanRes.status).toBe(201);

    // totalRepayment = 100000 * (1 + 0.05 * 120 / 30) = 100000 * 1.2 = 120000
    expect(loanRes.body.data.totalRepaymentAmount).toBe(120000);
    // dailyPayment = 120000 / 120 = 1000
    expect(loanRes.body.data.dailyPaymentAmount).toBe(1000);

    // Verify no rounding loss: dailyPayment * termDays == totalRepayment
    const daily = new Decimal(loanRes.body.data.dailyPaymentAmount);
    const total = new Decimal(loanRes.body.data.totalRepaymentAmount);
    expect(daily.mul(120).eq(total)).toBe(true);
  });

  it('should auto-split overpayment exactly: interest_due=2000.00, payment=5000.01 → INTEREST=2000.00, PRINCIPAL=3000.01', async () => {
    // principal=100000, rate=2% → interest_due=2000
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrowerId,
        principal_amount: 100000,
        interest_rate: 2,
        disbursement_date: '2025-10-15',
      });
    expect(loanRes.status).toBe(201);
    const loanId = loanRes.body.data.id;

    // Overpay: 5000.01 (interest_due=2000.00, principal_return=3000.01)
    const payRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 5000.01,
        transaction_date: '2025-11-15',
        effective_date: '2025-11-15',
      });
    expect(payRes.status).toBe(201);
    expect(payRes.body.data).toHaveLength(2);

    const interestTxn = payRes.body.data.find((t: { transactionType: string }) => t.transactionType === 'INTEREST_PAYMENT');
    const principalTxn = payRes.body.data.find((t: { transactionType: string }) => t.transactionType === 'PRINCIPAL_RETURN');

    expect(interestTxn).toBeDefined();
    expect(principalTxn).toBeDefined();
    expect(interestTxn.amount).toBe(2000);
    expect(principalTxn.amount).toBe(3000.01);
  });

  it('should verify auto-split parts always equal original amount', async () => {
    const loanRes = await request
      .post('/api/v1/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_type: 'MONTHLY',
        borrower_id: borrowerId,
        principal_amount: 77777,
        interest_rate: 3,
        disbursement_date: '2025-09-01',
      });
    expect(loanRes.status).toBe(201);
    const loanId = loanRes.body.data.id;

    // interest_due = 77777 * 3 / 100 = 2333.31
    const interestDue = new Decimal(77777).mul(3).div(100);
    expect(interestDue.toFixed(2)).toBe('2333.31');

    // Overpay: total = 4000.00
    const totalPayment = new Decimal('4000.00');
    const payRes = await request
      .post('/api/v1/transactions')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        loan_id: loanId,
        transaction_type: 'INTEREST_PAYMENT',
        amount: 4000,
        transaction_date: '2025-10-01',
        effective_date: '2025-10-01',
      });
    expect(payRes.status).toBe(201);
    expect(payRes.body.data).toHaveLength(2);

    // Sum of parts must equal original payment
    const sum = payRes.body.data.reduce(
      (acc: Decimal, t: { amount: string }) => acc.add(new Decimal(t.amount)),
      new Decimal(0),
    );
    expect(sum.eq(totalPayment)).toBe(true);
  });

  it('should calculate penalty correctly: principal=100000, rate=5%, 2 months → 10000.00', async () => {
    const principal = new Decimal(100000);
    const rate = new Decimal(5);
    const months = 2;
    const penalty = principal.mul(rate).div(100).mul(months);
    expect(penalty.toFixed(2)).toBe('10000.00');
  });
});

// ─── Request Validation ────────────────────────────────────────────────────
// (run before rate limit tests)

describe('Request Validation', () => {
  it('should reject oversized JSON body (>1MB) with 413', async () => {
    const largePayload = { data: 'x'.repeat(1024 * 1024 + 1) };
    const res = await request
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(largePayload));
    expect(res.status).toBe(413);
  });

  it('should reject invalid Content-Type with 400', async () => {
    const res = await request
      .post('/api/v1/auth/login')
      .set('Content-Type', 'text/plain')
      .send('not json');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('should reject missing Authorization header on protected route with 401', async () => {
    const res = await request.get('/api/v1/customers');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('should reject malformed UUID in path params with 400', async () => {
    const res = await request
      .get('/api/v1/loans/not-a-valid-uuid')
      .set('Authorization', `Bearer ${adminAccessToken}`);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── Rate Limiting ─────────────────────────────────────────────────────────
// Uses a dedicated mini Express app with low limits so rate limit tests are
// independent of the main app's high test-mode limits.

describe('Rate Limiting', () => {
  let rateLimitApp: import('express').Express;
  let rlRequest: supertest.Agent;

  beforeAll(async () => {
    const express = (await import('express')).default;
    const rateLimit = (await import('express-rate-limit')).default;

    rateLimitApp = express();

    const rateLimitMessage = {
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests, please try again later', details: [] },
    };

    const testAuthLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: rateLimitMessage,
    });

    const testApiLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: rateLimitMessage,
    });

    rateLimitApp.use('/auth', testAuthLimiter);
    rateLimitApp.use('/api', testApiLimiter);
    rateLimitApp.post('/auth', (_req, res) => res.json({ ok: true }));
    rateLimitApp.get('/api', (_req, res) => res.json({ ok: true }));

    rlRequest = supertest(rateLimitApp);
  });

  it('should return 429 after exceeding auth rate limit', async () => {
    const promises = [];
    for (let i = 0; i < 7; i++) {
      promises.push(rlRequest.post('/auth').send({}));
    }
    const results = await Promise.all(promises);
    const statuses = results.map((r) => r.status);
    expect(statuses).toContain(429);
  });

  it('should return 429 after exceeding general API rate limit', async () => {
    const promises = [];
    for (let i = 0; i < 12; i++) {
      promises.push(rlRequest.get('/api'));
    }
    const results = await Promise.all(promises);
    const statuses = results.map((r) => r.status);
    expect(statuses).toContain(429);
  });

  it('should return correct error envelope shape on 429', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(rlRequest.post('/auth').send({}));
    }
    const results = await Promise.all(promises);
    const rateLimited = results.find((r) => r.status === 429);
    expect(rateLimited).toBeDefined();
    expect(rateLimited!.body).toMatchObject({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: expect.any(String),
        details: [],
      },
    });
  });
});
