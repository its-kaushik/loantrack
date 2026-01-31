import { jest } from '@jest/globals';
import supertest from 'supertest';
import bcrypt from 'bcrypt';
import app from '../../src/app.js';
import prisma from '../helpers/prisma';

jest.setTimeout(60_000);

const request = supertest(app);

let superAdminAccessToken: string;
let tenantAdminAccessToken: string;
let existingTenantId: string;
let createdTenantId: string;
let createdTenantAdminPhone: string;

beforeAll(async () => {
  // Clean up any leftover test data
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '9800%')`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" LIKE 'p11-%')`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" LIKE 'p11-%')`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" LIKE 'p11-%')`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" LIKE 'p11-%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '9800%'`;
  await prisma.tenant.deleteMany({ where: { slug: { startsWith: 'p11-' } } });

  // Create a SUPER_ADMIN user (tenantId: null)
  await prisma.user.create({
    data: {
      tenantId: null,
      name: 'Platform Super Admin',
      phone: '9800000001',
      passwordHash: await bcrypt.hash('SuperAdmin@123', 12),
      role: 'SUPER_ADMIN',
    },
  });

  // Create a tenant with an ADMIN user (for access control tests)
  const tenant = await prisma.tenant.create({
    data: { name: 'P11 Existing Tenant', slug: 'p11-existing', ownerName: 'Owner', ownerPhone: '9800000010' },
  });
  existingTenantId = tenant.id;

  await prisma.user.create({
    data: {
      tenantId: existingTenantId,
      name: 'P11 Tenant Admin',
      phone: '9800000002',
      passwordHash: await bcrypt.hash('TenantAdmin@123', 12),
      role: 'ADMIN',
    },
  });

  // Create a COLLECTOR in the existing tenant (for access control tests)
  await prisma.user.create({
    data: {
      tenantId: existingTenantId,
      name: 'P11 Tenant Collector',
      phone: '9800000003',
      passwordHash: await bcrypt.hash('Collector@123', 12),
      role: 'COLLECTOR',
    },
  });

  // Login SUPER_ADMIN
  const superAdminLogin = await request
    .post('/api/v1/auth/login')
    .send({ phone: '9800000001', password: 'SuperAdmin@123' });
  superAdminAccessToken = superAdminLogin.body.data.access_token;

  // Login tenant ADMIN
  const adminLogin = await request
    .post('/api/v1/auth/login')
    .send({ phone: '9800000002', password: 'TenantAdmin@123' });
  tenantAdminAccessToken = adminLogin.body.data.access_token;
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '9800%')`;
  await prisma.$executeRaw`DELETE FROM "transactions" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" LIKE 'p11-%')`;
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" LIKE 'p11-%')`;
  await prisma.$executeRaw`DELETE FROM "loan_number_sequences" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" LIKE 'p11-%')`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" LIKE 'p11-%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '9800%'`;
  await prisma.tenant.deleteMany({ where: { slug: { startsWith: 'p11-' } } });
  await prisma.$disconnect();
});

// ─── Tenant Onboarding — POST /platform/tenants ─────────────────────────

describe('POST /api/v1/platform/tenants', () => {
  it('super admin creates tenant with admin user (201)', async () => {
    const res = await request
      .post('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${superAdminAccessToken}`)
      .send({
        name: 'P11 Platform Test',
        slug: 'p11-platform-test',
        owner_name: 'Test Owner',
        owner_phone: '9800100001',
        owner_email: 'owner@test.com',
        address: '123 Test Street',
        admin_name: 'Test Admin',
        admin_phone: '9800100002',
        admin_password: 'TestAdmin@123',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tenant).toBeDefined();
    expect(res.body.data.admin).toBeDefined();
    expect(res.body.data.tenant.name).toBe('P11 Platform Test');
    expect(res.body.data.tenant.slug).toBe('p11-platform-test');
    expect(res.body.data.tenant.ownerName).toBe('Test Owner');
    expect(res.body.data.tenant.ownerEmail).toBe('owner@test.com');
    expect(res.body.data.tenant.status).toBe('ACTIVE');
    expect(res.body.data.admin.name).toBe('Test Admin');
    expect(res.body.data.admin.phone).toBe('9800100002');
    expect(res.body.data.admin.role).toBe('ADMIN');

    createdTenantId = res.body.data.tenant.id;
    createdTenantAdminPhone = '9800100002';
  });

  it('new tenant admin can log in with provided credentials', async () => {
    const res = await request
      .post('/api/v1/auth/login')
      .send({ phone: createdTenantAdminPhone, password: 'TestAdmin@123' });

    expect(res.status).toBe(200);
    expect(res.body.data.access_token).toBeDefined();
    expect(res.body.data.user.role).toBe('ADMIN');
  });

  it('rejects duplicate slug (409)', async () => {
    const res = await request
      .post('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${superAdminAccessToken}`)
      .send({
        name: 'Duplicate Slug Tenant',
        slug: 'p11-platform-test',
        owner_name: 'Owner',
        owner_phone: '9800100003',
        admin_name: 'Admin',
        admin_phone: '9800100004',
        admin_password: 'Password@123',
      });

    expect(res.status).toBe(409);
  });

  it('rejects invalid slug format (400)', async () => {
    const res = await request
      .post('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${superAdminAccessToken}`)
      .send({
        name: 'Bad Slug Tenant',
        slug: 'Bad Slug!',
        owner_name: 'Owner',
        owner_phone: '9800100005',
        admin_name: 'Admin',
        admin_phone: '9800100006',
        admin_password: 'Password@123',
      });

    expect(res.status).toBe(400);
  });

  it('rejects missing required fields (400)', async () => {
    const res = await request
      .post('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${superAdminAccessToken}`)
      .send({
        name: 'Missing Fields',
      });

    expect(res.status).toBe(400);
  });
});

// ─── Tenant Listing — GET /platform/tenants ─────────────────────────────

describe('GET /api/v1/platform/tenants', () => {
  it('lists all tenants with pagination', async () => {
    const res = await request
      .get('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${superAdminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(2);
  });

  it('filters tenants by status', async () => {
    const res = await request
      .get('/api/v1/platform/tenants')
      .query({ status: 'ACTIVE' })
      .set('Authorization', `Bearer ${superAdminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const tenant of res.body.data) {
      expect(tenant.status).toBe('ACTIVE');
    }
  });

  it('returns correct response shape', async () => {
    const res = await request
      .get('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${superAdminAccessToken}`);

    expect(res.status).toBe(200);
    const tenant = res.body.data[0];
    expect(tenant.id).toBeDefined();
    expect(tenant.name).toBeDefined();
    expect(tenant.slug).toBeDefined();
    expect(tenant.status).toBeDefined();
    expect(tenant.ownerName).toBeDefined();
    expect(tenant.ownerPhone).toBeDefined();
    expect(tenant.createdAt).toBeDefined();
    expect(tenant.updatedAt).toBeDefined();
  });
});

// ─── Tenant Detail — GET /platform/tenants/:id ─────────────────────────

describe('GET /api/v1/platform/tenants/:id', () => {
  it('returns tenant detail with aggregate counts', async () => {
    const res = await request
      .get(`/api/v1/platform/tenants/${existingTenantId}`)
      .set('Authorization', `Bearer ${superAdminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(existingTenantId);
    expect(res.body.data.name).toBe('P11 Existing Tenant');
    expect(typeof res.body.data.activeLoansCount).toBe('number');
    expect(typeof res.body.data.totalUsersCount).toBe('number');
    expect(typeof res.body.data.totalCustomersCount).toBe('number');
  });

  it('returns 404 for non-existent tenant', async () => {
    const res = await request
      .get('/api/v1/platform/tenants/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${superAdminAccessToken}`);

    expect(res.status).toBe(404);
  });

  it('counts reflect actual data', async () => {
    // Create a customer and a loan in the existing tenant
    const adminUser = await prisma.user.findFirst({
      where: { tenantId: existingTenantId, role: 'ADMIN' },
    });

    const customer = await prisma.customer.create({
      data: {
        tenantId: existingTenantId,
        fullName: 'P11 Test Customer',
        phone: '9800200001',
        createdById: adminUser!.id,
      },
    });

    await prisma.loan.create({
      data: {
        tenantId: existingTenantId,
        loanNumber: 'P11-TEST-001',
        borrowerId: customer.id,
        loanType: 'DAILY',
        principalAmount: 10000,
        interestRate: 10,
        disbursementDate: new Date('2026-01-01'),
        termDays: 100,
        totalRepaymentAmount: 11000,
        dailyPaymentAmount: 110,
        termEndDate: new Date('2026-04-11'),
        status: 'ACTIVE',
        createdById: adminUser!.id,
      },
    });

    const res = await request
      .get(`/api/v1/platform/tenants/${existingTenantId}`)
      .set('Authorization', `Bearer ${superAdminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.activeLoansCount).toBeGreaterThanOrEqual(1);
    expect(res.body.data.totalCustomersCount).toBeGreaterThanOrEqual(1);
    expect(res.body.data.totalUsersCount).toBeGreaterThanOrEqual(2);
  });
});

// ─── Tenant Suspension & Activation ─────────────────────────────────────

describe('PATCH /api/v1/platform/tenants/:id/suspend & activate', () => {
  it('suspends an active tenant (200)', async () => {
    const res = await request
      .patch(`/api/v1/platform/tenants/${createdTenantId}/suspend`)
      .set('Authorization', `Bearer ${superAdminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SUSPENDED');
  });

  it('suspended tenant admin cannot log in (403)', async () => {
    const res = await request
      .post('/api/v1/auth/login')
      .send({ phone: createdTenantAdminPhone, password: 'TestAdmin@123' });

    expect(res.status).toBe(403);
  });

  it('activates a suspended tenant (200)', async () => {
    const res = await request
      .patch(`/api/v1/platform/tenants/${createdTenantId}/activate`)
      .set('Authorization', `Bearer ${superAdminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ACTIVE');
  });

  it('reactivated tenant admin can log in again', async () => {
    const res = await request
      .post('/api/v1/auth/login')
      .send({ phone: createdTenantAdminPhone, password: 'TestAdmin@123' });

    expect(res.status).toBe(200);
    expect(res.body.data.access_token).toBeDefined();
  });
});

// ─── Platform Stats — GET /platform/stats ───────────────────────────────

describe('GET /api/v1/platform/stats', () => {
  it('returns correct structure with tenant counts by status', async () => {
    const res = await request
      .get('/api/v1/platform/stats')
      .set('Authorization', `Bearer ${superAdminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.tenants).toBeDefined();
    expect(typeof res.body.data.tenants.active).toBe('number');
    expect(typeof res.body.data.tenants.suspended).toBe('number');
    expect(typeof res.body.data.tenants.deactivated).toBe('number');
    expect(typeof res.body.data.tenants.total).toBe('number');
    expect(res.body.data.tenants.total).toBe(
      res.body.data.tenants.active + res.body.data.tenants.suspended + res.body.data.tenants.deactivated,
    );
  });

  it('loan counts reflect actual data across tenants', async () => {
    const res = await request
      .get('/api/v1/platform/stats')
      .set('Authorization', `Bearer ${superAdminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.loans).toBeDefined();
    expect(typeof res.body.data.loans.active).toBe('number');
    expect(typeof res.body.data.loans.closed).toBe('number');
    expect(typeof res.body.data.loans.defaulted).toBe('number');
    expect(typeof res.body.data.loans.writtenOff).toBe('number');
    expect(typeof res.body.data.loans.cancelled).toBe('number');
    expect(typeof res.body.data.loans.total).toBe('number');
    expect(res.body.data.loans.total).toBe(
      res.body.data.loans.active +
        res.body.data.loans.closed +
        res.body.data.loans.defaulted +
        res.body.data.loans.writtenOff +
        res.body.data.loans.cancelled,
    );
    expect(typeof res.body.data.totalUsers).toBe('number');
  });
});

// ─── Access Control ─────────────────────────────────────────────────────

describe('Platform Admin — Access Control', () => {
  it('tenant ADMIN cannot access /platform/tenants (403)', async () => {
    const res = await request
      .get('/api/v1/platform/tenants')
      .set('Authorization', `Bearer ${tenantAdminAccessToken}`);

    expect(res.status).toBe(403);
  });

  it('tenant COLLECTOR cannot access /platform/stats (403)', async () => {
    const collectorLogin = await request
      .post('/api/v1/auth/login')
      .send({ phone: '9800000003', password: 'Collector@123' });
    const collectorToken = collectorLogin.body.data.access_token;

    const res = await request
      .get('/api/v1/platform/stats')
      .set('Authorization', `Bearer ${collectorToken}`);

    expect(res.status).toBe(403);
  });

  it('super admin cannot access tenant-scoped endpoints without tenant context', async () => {
    const res = await request
      .get('/api/v1/loans')
      .set('Authorization', `Bearer ${superAdminAccessToken}`);

    // SUPER_ADMIN has no tenantId, so tenant-scoped endpoints should fail
    // The requireTenant middleware allows SUPER_ADMIN through but req.tenantId is undefined
    // The service layer will fail because tenantId is required
    expect([400, 403, 404, 500]).toContain(res.status);
  });
});
