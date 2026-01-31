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

beforeAll(async () => {
  // Clean up any leftover test data
  await prisma.$executeRaw`DELETE FROM "fund_entries" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-fund-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "expenses" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-fund-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "penalties" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-fund-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-fund-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-fund-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-fund-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-fund-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-fund-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '9400%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '9400%'`;
  await prisma.tenant.deleteMany({ where: { slug: 'p9-fund-test-tenant' } });

  // Create tenant
  const tenant = await prisma.tenant.create({
    data: { name: 'P9 Fund Test Tenant', slug: 'p9-fund-test-tenant', ownerName: 'Owner', ownerPhone: '9400000000' },
  });
  tenantId = tenant.id;

  // Create admin
  const admin = await prisma.user.create({
    data: {
      tenantId,
      name: 'Fund Test Admin',
      phone: '9400000001',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });
  adminUserId = admin.id;

  // Create collector
  await prisma.user.create({
    data: {
      tenantId,
      name: 'Fund Test Collector',
      phone: '9400000002',
      passwordHash: await bcrypt.hash('Collector@123', 12),
      role: 'COLLECTOR',
    },
  });

  // Login both users
  const adminLogin = await request.post('/api/v1/auth/login').send({ phone: '9400000001', password: 'Admin@123' });
  adminAccessToken = adminLogin.body.data.access_token;

  const collectorLogin = await request.post('/api/v1/auth/login').send({ phone: '9400000002', password: 'Collector@123' });
  collectorAccessToken = collectorLogin.body.data.access_token;
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "fund_entries" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-fund-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "expenses" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-fund-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "penalties" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-fund-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "principal_returns" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-fund-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-fund-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-fund-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-fund-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-fund-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '9400%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '9400%'`;
  await prisma.tenant.deleteMany({ where: { slug: 'p9-fund-test-tenant' } });
  await prisma.$disconnect();
});

// ─── Create Fund Entry ──────────────────────────────────────────────────

describe('Create Fund Entry — POST /fund/entries', () => {
  it('admin records INJECTION → 201', async () => {
    const res = await request
      .post('/api/v1/fund/entries')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        entry_type: 'INJECTION',
        amount: 500000,
        description: 'Initial capital',
        entry_date: '2026-01-01',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.entryType).toBe('INJECTION');
    expect(res.body.data.amount).toBe(500000);
    expect(res.body.data.description).toBe('Initial capital');
    expect(res.body.data.entryDate).toBe('2026-01-01');
    expect(res.body.data.createdById).toBe(adminUserId);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.tenantId).toBe(tenantId);
  });

  it('admin records second INJECTION → 201', async () => {
    const res = await request
      .post('/api/v1/fund/entries')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        entry_type: 'INJECTION',
        amount: 200000,
        description: 'Additional capital',
        entry_date: '2026-01-10',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.amount).toBe(200000);
  });

  it('admin records WITHDRAWAL → 201', async () => {
    const res = await request
      .post('/api/v1/fund/entries')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        entry_type: 'WITHDRAWAL',
        amount: 50000,
        description: 'Profit withdrawal',
        entry_date: '2026-01-15',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.entryType).toBe('WITHDRAWAL');
    expect(res.body.data.amount).toBe(50000);
  });

  it('collector cannot create fund entry → 403', async () => {
    const res = await request
      .post('/api/v1/fund/entries')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        entry_type: 'INJECTION',
        amount: 1000,
        entry_date: '2026-01-15',
      });

    expect(res.status).toBe(403);
  });
});

// ─── List Fund Entries ──────────────────────────────────────────────────

describe('List Fund Entries — GET /fund/entries', () => {
  it('lists all entries → 200', async () => {
    const res = await request
      .get('/api/v1/fund/entries')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(3);
    expect(res.body.pagination.total).toBe(3);
  });

  it('filters by entry_type → only matching', async () => {
    const res = await request
      .get('/api/v1/fund/entries?entry_type=INJECTION')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data.every((e: { entryType: string }) => e.entryType === 'INJECTION')).toBe(true);
  });

  it('filters by date range → only matching', async () => {
    const res = await request
      .get('/api/v1/fund/entries?from=2026-01-10&to=2026-01-15')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });

  it('pagination works', async () => {
    const res = await request
      .get('/api/v1/fund/entries?page=1&limit=1')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.pagination.limit).toBe(1);
    expect(res.body.pagination.total).toBe(3);
  });
});

// ─── Fund Summary ───────────────────────────────────────────────────────

describe('Fund Summary — GET /fund/summary', () => {
  it('totalCapitalInvested = injections - withdrawals', async () => {
    const res = await request
      .get('/api/v1/fund/summary')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // 500000 + 200000 - 50000 = 650000
    expect(res.body.data.totalCapitalInvested).toBe('650000.00');
  });

  it('all 8 metrics present and numeric', async () => {
    const res = await request
      .get('/api/v1/fund/summary')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
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

  it('fund summary with no loans returns zeros for most metrics', async () => {
    const res = await request
      .get('/api/v1/fund/summary')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    // No loans, so deployed, interest, defaults should be 0
    expect(res.body.data.moneyDeployed).toBe('0.00');
    expect(res.body.data.totalInterestEarned).toBe('0.00');
    expect(res.body.data.moneyLostToDefaults).toBe('0.00');
    // Cash in hand should equal capital invested (no disbursements or expenses)
    expect(res.body.data.cashInHand).toBe('650000.00');
  });

  it('collector cannot view fund summary → 403', async () => {
    const res = await request
      .get('/api/v1/fund/summary')
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(403);
  });
});

// ─── Reconciliation ─────────────────────────────────────────────────────

describe('Reconciliation — GET /fund/reconciliation', () => {
  it('returns matching query_result and bottom_up_result', async () => {
    const res = await request
      .get('/api/v1/fund/reconciliation')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.queryResult).toBeDefined();
    expect(res.body.data.bottomUpResult).toBeDefined();
    expect(res.body.data.matches).toBe(true);
    expect(res.body.data.queryResult).toBe(res.body.data.bottomUpResult);
  });

  it('collector cannot view reconciliation → 403', async () => {
    const res = await request
      .get('/api/v1/fund/reconciliation')
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(403);
  });
});
