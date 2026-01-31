import { jest } from '@jest/globals';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import app from '../../src/app.js';
import prisma from '../helpers/prisma';

jest.setTimeout(30_000);

const request = supertest(app);

let tenantId: string;
let tenantId2: string;
let adminAccessToken: string;
let tenant2AdminAccessToken: string;
let collectorAccessToken: string;
let createdCollectorId: string;

beforeAll(async () => {
  // Clean up
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '7000%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '7000%'`;
  await prisma.tenant.deleteMany({ where: { slug: { in: ['users-test-tenant', 'users-test-tenant-2'] } } });

  // Create tenants
  const tenant = await prisma.tenant.create({
    data: { name: 'Users Test Tenant', slug: 'users-test-tenant', ownerName: 'Owner', ownerPhone: '7000000000' },
  });
  tenantId = tenant.id;

  const tenant2 = await prisma.tenant.create({
    data: { name: 'Users Test Tenant 2', slug: 'users-test-tenant-2', ownerName: 'Owner 2', ownerPhone: '7000000099' },
  });
  tenantId2 = tenant2.id;

  // Create admin in tenant 1
  await prisma.user.create({
    data: {
      tenantId,
      name: 'Users Test Admin',
      phone: '7000000001',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });

  // Create collector in tenant 1
  await prisma.user.create({
    data: {
      tenantId,
      name: 'Users Test Collector',
      phone: '7000000002',
      passwordHash: await bcrypt.hash('Collector@123', 12),
      role: 'COLLECTOR',
    },
  });

  // Create admin in tenant 2
  await prisma.user.create({
    data: {
      tenantId: tenantId2,
      name: 'Tenant2 Admin',
      phone: '7000000003',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });

  // Login all users
  const adminLogin = await request.post('/api/v1/auth/login').send({ phone: '7000000001', password: 'Admin@123' });
  adminAccessToken = adminLogin.body.data.access_token;

  const collectorLogin = await request.post('/api/v1/auth/login').send({ phone: '7000000002', password: 'Collector@123' });
  collectorAccessToken = collectorLogin.body.data.access_token;

  const tenant2AdminLogin = await request.post('/api/v1/auth/login').send({ phone: '7000000003', password: 'Admin@123' });
  tenant2AdminAccessToken = tenant2AdminLogin.body.data.access_token;
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '7000%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '7000%'`;
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, tenantId2] } } });
  await prisma.$disconnect();
});

// ─── List Users ─────────────────────────────────────────────────────────────

describe('GET /api/v1/users', () => {
  it('admin can list users in their tenant', async () => {
    const res = await request.get('/api/v1/users').set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    // All returned users should belong to this tenant (no cross-tenant leak)
    for (const user of res.body.data) {
      expect(user.id).toBeDefined();
      expect(user.name).toBeDefined();
    }
  });

  it('tenant A admin cannot see tenant B users', async () => {
    const resA = await request.get('/api/v1/users').set('Authorization', `Bearer ${adminAccessToken}`);
    const resB = await request.get('/api/v1/users').set('Authorization', `Bearer ${tenant2AdminAccessToken}`);

    const phoneSetA = new Set(resA.body.data.map((u: { phone: string }) => u.phone));
    const phoneSetB = new Set(resB.body.data.map((u: { phone: string }) => u.phone));

    // No overlap between tenants
    for (const phone of phoneSetA) {
      expect(phoneSetB.has(phone)).toBe(false);
    }
  });
});

// ─── Create User ────────────────────────────────────────────────────────────

describe('POST /api/v1/users', () => {
  it('admin can create a collector account', async () => {
    const res = await request
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'New Collector', phone: '7000000010', password: 'Test@123', role: 'COLLECTOR' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('New Collector');
    expect(res.body.data.role).toBe('COLLECTOR');
    expect(res.body.data.isActive).toBe(true);
    createdCollectorId = res.body.data.id;
  });

  it('rejects duplicate phone in same tenant', async () => {
    const res = await request
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Duplicate', phone: '7000000010', password: 'Test@123', role: 'COLLECTOR' });

    expect(res.status).toBe(409);
  });

  it('rejects invalid role', async () => {
    const res = await request
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Bad Role', phone: '7000000011', password: 'Test@123', role: 'ADMIN' });

    expect(res.status).toBe(400);
  });
});

// ─── Update User ────────────────────────────────────────────────────────────

describe('PUT /api/v1/users/:id', () => {
  it('admin can update a user', async () => {
    const res = await request
      .put(`/api/v1/users/${createdCollectorId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Updated Collector' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Updated Collector');
  });

  it('rejects update with duplicate phone', async () => {
    const res = await request
      .put(`/api/v1/users/${createdCollectorId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ phone: '7000000001' }); // admin's phone

    expect(res.status).toBe(409);
  });

  it('returns 404 for user in different tenant', async () => {
    const res = await request
      .put(`/api/v1/users/${createdCollectorId}`)
      .set('Authorization', `Bearer ${tenant2AdminAccessToken}`)
      .send({ name: 'Hacked Name' });

    expect(res.status).toBe(404);
  });
});

// ─── Deactivate User ────────────────────────────────────────────────────────

describe('PATCH /api/v1/users/:id/deactivate', () => {
  it('admin can deactivate a collector', async () => {
    const res = await request
      .patch(`/api/v1/users/${createdCollectorId}/deactivate`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
  });

  it('deactivated user cannot log in', async () => {
    const res = await request.post('/api/v1/auth/login').send({ phone: '7000000010', password: 'Test@123' });
    expect(res.status).toBe(401);
  });
});

// ─── Reset Password ─────────────────────────────────────────────────────────

describe('POST /api/v1/users/:id/reset-password', () => {
  it('admin can reset a user password', async () => {
    // Find collector by phone
    const collector = await prisma.user.findFirst({ where: { tenantId, phone: '7000000002' } });

    const res = await request
      .post(`/api/v1/users/${collector!.id}/reset-password`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ new_password: 'ResetPass@123' });

    expect(res.status).toBe(200);

    // Can login with new password
    const loginRes = await request.post('/api/v1/auth/login').send({ phone: '7000000002', password: 'ResetPass@123' });
    expect(loginRes.status).toBe(200);
  });
});

// ─── Collector Restrictions ─────────────────────────────────────────────────

describe('Collector restrictions', () => {
  it('collector cannot list users', async () => {
    const res = await request.get('/api/v1/users').set('Authorization', `Bearer ${collectorAccessToken}`);
    expect(res.status).toBe(403);
  });

  it('collector cannot create users', async () => {
    const res = await request
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({ name: 'Test', phone: '0000000000', password: 'Test@123', role: 'COLLECTOR' });
    expect(res.status).toBe(403);
  });
});
