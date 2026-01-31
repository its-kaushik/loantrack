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
let expense1Id: string;
let expense2Id: string;

beforeAll(async () => {
  // Clean up any leftover test data
  await prisma.$executeRaw`DELETE FROM "expenses" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-exp-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '9300%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '9300%'`;
  await prisma.tenant.deleteMany({ where: { slug: 'p9-exp-test-tenant' } });

  // Create tenant
  const tenant = await prisma.tenant.create({
    data: { name: 'P9 Expense Test Tenant', slug: 'p9-exp-test-tenant', ownerName: 'Owner', ownerPhone: '9300000000' },
  });
  tenantId = tenant.id;

  // Create admin
  const admin = await prisma.user.create({
    data: {
      tenantId,
      name: 'Exp Test Admin',
      phone: '9300000001',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });
  adminUserId = admin.id;

  // Create collector
  await prisma.user.create({
    data: {
      tenantId,
      name: 'Exp Test Collector',
      phone: '9300000002',
      passwordHash: await bcrypt.hash('Collector@123', 12),
      role: 'COLLECTOR',
    },
  });

  // Login both users
  const adminLogin = await request.post('/api/v1/auth/login').send({ phone: '9300000001', password: 'Admin@123' });
  adminAccessToken = adminLogin.body.data.access_token;

  const collectorLogin = await request.post('/api/v1/auth/login').send({ phone: '9300000002', password: 'Collector@123' });
  collectorAccessToken = collectorLogin.body.data.access_token;
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "expenses" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" = 'p9-exp-test-tenant')`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '9300%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '9300%'`;
  await prisma.tenant.deleteMany({ where: { slug: 'p9-exp-test-tenant' } });
  await prisma.$disconnect();
});

// ─── Create Expense ─────────────────────────────────────────────────────

describe('Create Expense — POST /expenses', () => {
  it('admin creates TRAVEL expense → 201', async () => {
    const res = await request
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        category: 'TRAVEL',
        amount: 5000,
        description: 'Branch visit travel',
        expense_date: '2026-01-15',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.category).toBe('TRAVEL');
    expect(res.body.data.amount).toBe(5000);
    expect(res.body.data.description).toBe('Branch visit travel');
    expect(res.body.data.expenseDate).toBe('2026-01-15');
    expect(res.body.data.isDeleted).toBe(false);
    expect(res.body.data.createdById).toBe(adminUserId);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.tenantId).toBe(tenantId);
    expense1Id = res.body.data.id;
  });

  it('admin creates SALARY expense → 201', async () => {
    const res = await request
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        category: 'SALARY',
        amount: 25000,
        description: 'Collector salary',
        expense_date: '2026-01-20',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.category).toBe('SALARY');
    expect(res.body.data.amount).toBe(25000);
    expense2Id = res.body.data.id;
  });

  it('collector cannot create expense → 403', async () => {
    const res = await request
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({
        category: 'MISC',
        amount: 100,
        expense_date: '2026-01-15',
      });

    expect(res.status).toBe(403);
  });
});

// ─── List Expenses ──────────────────────────────────────────────────────

describe('List Expenses — GET /expenses', () => {
  it('lists all expenses → 200', async () => {
    const res = await request
      .get('/api/v1/expenses')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBe(2);
  });

  it('filters by category → only matching', async () => {
    const res = await request
      .get('/api/v1/expenses?category=TRAVEL')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].category).toBe('TRAVEL');
  });

  it('filters by date range → only matching', async () => {
    const res = await request
      .get('/api/v1/expenses?from=2026-01-18&to=2026-01-25')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].category).toBe('SALARY');
  });

  it('pagination works', async () => {
    const res = await request
      .get('/api/v1/expenses?page=1&limit=1')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.pagination.limit).toBe(1);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.pagination.totalPages).toBe(2);
  });

  it('collector cannot list expenses → 403', async () => {
    const res = await request
      .get('/api/v1/expenses')
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(403);
  });
});

// ─── Update Expense ─────────────────────────────────────────────────────

describe('Update Expense — PUT /expenses/:id', () => {
  it('updates expense amount and description → 200', async () => {
    const res = await request
      .put(`/api/v1/expenses/${expense1Id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ amount: 7500, description: 'Updated travel expense' });

    expect(res.status).toBe(200);
    expect(res.body.data.amount).toBe(7500);
    expect(res.body.data.description).toBe('Updated travel expense');
    expect(res.body.data.category).toBe('TRAVEL');
  });

  it('update non-existent expense → 404', async () => {
    const res = await request
      .put('/api/v1/expenses/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ amount: 100 });

    expect(res.status).toBe(404);
  });
});

// ─── Soft-Delete Expense ────────────────────────────────────────────────

describe('Soft-Delete Expense — PATCH /expenses/:id/delete', () => {
  it('soft-deletes expense → 200', async () => {
    const res = await request
      .patch(`/api/v1/expenses/${expense2Id}/delete`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe('Expense deleted');
  });

  it('deleted expense excluded from list', async () => {
    const res = await request
      .get('/api/v1/expenses')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe(expense1Id);
  });

  it('update deleted expense → 400', async () => {
    const res = await request
      .put(`/api/v1/expenses/${expense2Id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ amount: 100 });

    expect(res.status).toBe(400);
  });

  it('soft-delete already deleted → 400', async () => {
    const res = await request
      .patch(`/api/v1/expenses/${expense2Id}/delete`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(400);
  });
});
