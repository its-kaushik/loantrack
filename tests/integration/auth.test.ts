import { jest } from '@jest/globals';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import app from '../../src/app.js';
import prisma from '../helpers/prisma';

jest.setTimeout(30_000);

const request = supertest(app);

let tenantId: string;
let tenantId2: string;
let adminId: string;
let collectorId: string;
let adminAccessToken: string;
let adminRefreshToken: string;
let collectorAccessToken: string;

beforeAll(async () => {
  // Clean up any existing test data
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" IN ('8000000001', '8000000002', '8000000003', '8000000004'))`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" IN ('8000000001', '8000000002', '8000000003', '8000000004')`;
  await prisma.tenant.deleteMany({ where: { slug: { in: ['auth-test-tenant', 'auth-test-tenant-2'] } } });

  // Create test tenant
  const tenant = await prisma.tenant.create({
    data: { name: 'Auth Test Tenant', slug: 'auth-test-tenant', ownerName: 'Owner', ownerPhone: '8000000000' },
  });
  tenantId = tenant.id;

  const tenant2 = await prisma.tenant.create({
    data: { name: 'Auth Test Tenant 2', slug: 'auth-test-tenant-2', ownerName: 'Owner 2', ownerPhone: '8000000099' },
  });
  tenantId2 = tenant2.id;

  // Create admin user
  const admin = await prisma.user.create({
    data: {
      tenantId,
      name: 'Test Admin',
      phone: '8000000001',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });
  adminId = admin.id;

  // Create collector user
  const collector = await prisma.user.create({
    data: {
      tenantId,
      name: 'Test Collector',
      phone: '8000000002',
      passwordHash: await bcrypt.hash('Collector@123', 12),
      role: 'COLLECTOR',
    },
  });
  collectorId = collector.id;

  // Create admin in tenant 2 for multi-tenancy test
  await prisma.user.create({
    data: {
      tenantId: tenantId2,
      name: 'Tenant2 Admin',
      phone: '8000000003',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" IN ('8000000001', '8000000002', '8000000003', '8000000004'))`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" IN ('8000000001', '8000000002', '8000000003', '8000000004')`;
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, tenantId2] } } });
  await prisma.$disconnect();
});

// ─── Login ──────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/login', () => {
  it('returns access + refresh tokens for valid credentials', async () => {
    const res = await request.post('/api/v1/auth/login').send({ phone: '8000000001', password: 'Admin@123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.access_token).toBeDefined();
    expect(res.body.data.refresh_token).toBeDefined();
    expect(res.body.data.expires_in).toBe(900);
    expect(res.body.data.user.id).toBe(adminId);
    expect(res.body.data.user.role).toBe('ADMIN');
    expect(res.body.data.user.tenant_id).toBe(tenantId);

    adminAccessToken = res.body.data.access_token;
    adminRefreshToken = res.body.data.refresh_token;
  });

  it('returns 401 for invalid password', async () => {
    const res = await request.post('/api/v1/auth/login').send({ phone: '8000000001', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 401 for non-existent phone', async () => {
    const res = await request.post('/api/v1/auth/login').send({ phone: '0000000000', password: 'anything' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for deactivated user', async () => {
    const user = await prisma.user.create({
      data: {
        tenantId,
        name: 'Inactive User',
        phone: '8000000004',
        passwordHash: await bcrypt.hash('Test@123', 12),
        role: 'COLLECTOR',
        isActive: false,
      },
    });

    const res = await request.post('/api/v1/auth/login').send({ phone: '8000000004', password: 'Test@123' });
    expect(res.status).toBe(401);

    await prisma.user.delete({ where: { id: user.id } });
  });
});

// ─── Refresh ────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/refresh', () => {
  it('rotates tokens: old revoked, new pair issued', async () => {
    const res = await request.post('/api/v1/auth/refresh').send({ refresh_token: adminRefreshToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.access_token).toBeDefined();
    expect(res.body.data.refresh_token).toBeDefined();
    expect(res.body.data.refresh_token).not.toBe(adminRefreshToken);

    adminAccessToken = res.body.data.access_token;
    adminRefreshToken = res.body.data.refresh_token;
  });

  it('rejects revoked refresh token (old token after rotation)', async () => {
    const loginRes = await request.post('/api/v1/auth/login').send({ phone: '8000000001', password: 'Admin@123' });
    const oldRefreshToken = loginRes.body.data.refresh_token;

    await request.post('/api/v1/auth/refresh').send({ refresh_token: oldRefreshToken });

    const res = await request.post('/api/v1/auth/refresh').send({ refresh_token: oldRefreshToken });
    expect(res.status).toBe(401);
  });

  it('rejects invalid refresh token', async () => {
    const res = await request.post('/api/v1/auth/refresh').send({ refresh_token: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(401);
  });
});

// ─── Logout ─────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/logout', () => {
  it('revokes all refresh tokens for the user', async () => {
    const loginRes = await request.post('/api/v1/auth/login').send({ phone: '8000000001', password: 'Admin@123' });
    const accessToken = loginRes.body.data.access_token;
    const refreshToken = loginRes.body.data.refresh_token;

    const logoutRes = await request.post('/api/v1/auth/logout').set('Authorization', `Bearer ${accessToken}`);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);

    const refreshRes = await request.post('/api/v1/auth/refresh').send({ refresh_token: refreshToken });
    expect(refreshRes.status).toBe(401);

    const reloginRes = await request.post('/api/v1/auth/login').send({ phone: '8000000001', password: 'Admin@123' });
    adminAccessToken = reloginRes.body.data.access_token;
    adminRefreshToken = reloginRes.body.data.refresh_token;
  });
});

// ─── Get Me ─────────────────────────────────────────────────────────────────

describe('GET /api/v1/auth/me', () => {
  it('returns user profile with tenant info', async () => {
    const res = await request.get('/api/v1/auth/me').set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(adminId);
    expect(res.body.data.name).toBe('Test Admin');
    expect(res.body.data.role).toBe('ADMIN');
    expect(res.body.data.tenant).toBeDefined();
    expect(res.body.data.tenant.slug).toBe('auth-test-tenant');
  });

  it('rejects request without token', async () => {
    const res = await request.get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects expired/invalid token', async () => {
    const res = await request.get('/api/v1/auth/me').set('Authorization', 'Bearer invalid.token.here');
    expect(res.status).toBe(401);
  });
});

// ─── Change Password ────────────────────────────────────────────────────────

describe('PATCH /api/v1/auth/change-password', () => {
  it('changes password with correct current password', async () => {
    const res = await request
      .patch('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ current_password: 'Admin@123', new_password: 'NewAdmin@123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const loginRes = await request.post('/api/v1/auth/login').send({ phone: '8000000001', password: 'NewAdmin@123' });
    expect(loginRes.status).toBe(200);

    adminAccessToken = loginRes.body.data.access_token;
    await request
      .patch('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ current_password: 'NewAdmin@123', new_password: 'Admin@123' });

    const reloginRes = await request.post('/api/v1/auth/login').send({ phone: '8000000001', password: 'Admin@123' });
    adminAccessToken = reloginRes.body.data.access_token;
    adminRefreshToken = reloginRes.body.data.refresh_token;
  });

  it('fails with wrong current password', async () => {
    const res = await request
      .patch('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ current_password: 'WrongPassword', new_password: 'Whatever@123' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ─── Suspended Tenant ───────────────────────────────────────────────────────

describe('Suspended tenant', () => {
  it('returns 403 on authenticated endpoints when tenant is suspended', async () => {
    await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'SUSPENDED' } });

    const loginRes = await request.post('/api/v1/auth/login').send({ phone: '8000000001', password: 'Admin@123' });
    expect(loginRes.status).toBe(403);
    expect(loginRes.body.success).toBe(false);

    await prisma.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });

    const reloginRes = await request.post('/api/v1/auth/login').send({ phone: '8000000001', password: 'Admin@123' });
    adminAccessToken = reloginRes.body.data.access_token;
    adminRefreshToken = reloginRes.body.data.refresh_token;
  });
});

// ─── Role-Based Access ──────────────────────────────────────────────────────

describe('Role-based access control', () => {
  beforeAll(async () => {
    const collectorLogin = await request.post('/api/v1/auth/login').send({ phone: '8000000002', password: 'Collector@123' });
    collectorAccessToken = collectorLogin.body.data.access_token;
  });

  it('collector cannot access admin-only user management endpoints', async () => {
    const res = await request.get('/api/v1/users').set('Authorization', `Bearer ${collectorAccessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('collector cannot create users', async () => {
    const res = await request
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({ name: 'Hacker', phone: '1111111111', password: 'Test@123', role: 'COLLECTOR' });
    expect(res.status).toBe(403);
  });
});
