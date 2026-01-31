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
let adminUserId: string;
let firstCustomerId: string;

beforeAll(async () => {
  // Clean up
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('cust-test-tenant', 'cust-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('cust-test-tenant', 'cust-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '6000%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '6000%'`;
  await prisma.tenant.deleteMany({ where: { slug: { in: ['cust-test-tenant', 'cust-test-tenant-2'] } } });

  // Create tenants
  const tenant = await prisma.tenant.create({
    data: { name: 'Cust Test Tenant', slug: 'cust-test-tenant', ownerName: 'Owner', ownerPhone: '6000000000' },
  });
  tenantId = tenant.id;

  const tenant2 = await prisma.tenant.create({
    data: { name: 'Cust Test Tenant 2', slug: 'cust-test-tenant-2', ownerName: 'Owner 2', ownerPhone: '6000000099' },
  });
  tenantId2 = tenant2.id;

  // Create admin in tenant 1
  const admin = await prisma.user.create({
    data: {
      tenantId,
      name: 'Cust Test Admin',
      phone: '6000000001',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });
  adminUserId = admin.id;

  // Create collector in tenant 1
  await prisma.user.create({
    data: {
      tenantId,
      name: 'Cust Test Collector',
      phone: '6000000002',
      passwordHash: await bcrypt.hash('Collector@123', 12),
      role: 'COLLECTOR',
    },
  });

  // Create admin in tenant 2
  await prisma.user.create({
    data: {
      tenantId: tenantId2,
      name: 'Tenant2 Cust Admin',
      phone: '6000000003',
      passwordHash: await bcrypt.hash('Admin@123', 12),
      role: 'ADMIN',
    },
  });

  // Login all users
  const adminLogin = await request.post('/api/v1/auth/login').send({ phone: '6000000001', password: 'Admin@123' });
  adminAccessToken = adminLogin.body.data.access_token;

  const collectorLogin = await request.post('/api/v1/auth/login').send({ phone: '6000000002', password: 'Collector@123' });
  collectorAccessToken = collectorLogin.body.data.access_token;

  const tenant2AdminLogin = await request.post('/api/v1/auth/login').send({ phone: '6000000003', password: 'Admin@123' });
  tenant2AdminAccessToken = tenant2AdminLogin.body.data.access_token;
});

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM "loans" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('cust-test-tenant', 'cust-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "customers" WHERE "tenant_id" IN (SELECT "id" FROM "tenants" WHERE "slug" IN ('cust-test-tenant', 'cust-test-tenant-2'))`;
  await prisma.$executeRaw`DELETE FROM "refresh_tokens" WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "phone" LIKE '6000%')`;
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" LIKE '6000%'`;
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, tenantId2] } } });
  await prisma.$disconnect();
});

// ─── POST /customers ───────────────────────────────────────────────────────

describe('POST /api/v1/customers', () => {
  it('creates a customer with minimal fields', async () => {
    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ full_name: 'Rajesh Kumar', phone: '6000100001' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.fullName).toBe('Rajesh Kumar');
    expect(res.body.data.phone).toBe('6000100001');
    expect(res.body.data.isDefaulter).toBe(false);
    firstCustomerId = res.body.data.id;
  });

  it('creates a customer with all fields', async () => {
    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        full_name: 'Suresh Patel',
        phone: '6000100002',
        alternate_phone: '6000100003',
        address: '456 Oak Street',
        aadhaar_number: '111122223333',
        pan_number: 'ABCDE1234F',
        id_proof_type: 'AADHAAR',
        occupation: 'Business Owner',
        notes: 'Good customer',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.aadhaarNumber).toBe('111122223333');
    expect(res.body.data.panNumber).toBe('ABCDE1234F');
    expect(res.body.data.occupation).toBe('Business Owner');
  });

  it('rejects duplicate aadhaar in same tenant (409)', async () => {
    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ full_name: 'Duplicate Aadhaar', phone: '6000100004', aadhaar_number: '111122223333' });

    expect(res.status).toBe(409);
  });

  it('rejects duplicate PAN in same tenant (409)', async () => {
    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ full_name: 'Duplicate PAN', phone: '6000100005', pan_number: 'ABCDE1234F' });

    expect(res.status).toBe(409);
  });

  it('allows same aadhaar in different tenant (201)', async () => {
    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${tenant2AdminAccessToken}`)
      .send({ full_name: 'Cross Tenant', phone: '6000100006', aadhaar_number: '111122223333' });

    expect(res.status).toBe(201);
  });

  it('allows multiple null aadhaar (201)', async () => {
    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ full_name: 'No Aadhaar', phone: '6000100007' });

    expect(res.status).toBe(201);
  });

  it('rejects invalid aadhaar format (400)', async () => {
    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ full_name: 'Bad Aadhaar', phone: '6000100008', aadhaar_number: '1234' });

    expect(res.status).toBe(400);
  });

  it('rejects invalid PAN format (400)', async () => {
    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ full_name: 'Bad PAN', phone: '6000100009', pan_number: 'invalid' });

    expect(res.status).toBe(400);
  });

  it('collector cannot create (403)', async () => {
    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({ full_name: 'Blocked', phone: '6000100010' });

    expect(res.status).toBe(403);
  });

  it('rejects missing required fields (400)', async () => {
    const res = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ phone: '6000100011' });

    expect(res.status).toBe(400);
  });
});

// ─── GET /customers ────────────────────────────────────────────────────────

describe('GET /api/v1/customers', () => {
  it('lists customers with pagination', async () => {
    const res = await request
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.totalPages).toBeDefined();
  });

  it('collector can list customers', async () => {
    const res = await request
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(200);
  });

  it('searches by name (ILIKE)', async () => {
    const res = await request
      .get('/api/v1/customers?search=rajesh')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].fullName.toLowerCase()).toContain('rajesh');
  });

  it('filters by is_defaulter', async () => {
    const res = await request
      .get('/api/v1/customers?is_defaulter=false')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    for (const customer of res.body.data) {
      expect(customer.isDefaulter).toBe(false);
    }
  });

  it('filters by phone', async () => {
    const res = await request
      .get('/api/v1/customers?phone=6000100001')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].phone).toBe('6000100001');
  });

  it('respects pagination limits', async () => {
    const res = await request
      .get('/api/v1/customers?page=1&limit=2')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.pagination.limit).toBe(2);
  });

  it('returns empty page for high page number', async () => {
    const res = await request
      .get('/api/v1/customers?page=999')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });

  it('enforces tenant isolation', async () => {
    const resA = await request.get('/api/v1/customers').set('Authorization', `Bearer ${adminAccessToken}`);
    const resB = await request.get('/api/v1/customers').set('Authorization', `Bearer ${tenant2AdminAccessToken}`);

    const idsA = new Set(resA.body.data.map((c: { id: string }) => c.id));
    const idsB = new Set(resB.body.data.map((c: { id: string }) => c.id));

    for (const id of idsA) {
      expect(idsB.has(id)).toBe(false);
    }
  });

  it('rejects unauthenticated request (401)', async () => {
    const res = await request.get('/api/v1/customers');
    expect(res.status).toBe(401);
  });
});

// ─── GET /customers/:id ────────────────────────────────────────────────────

describe('GET /api/v1/customers/:id', () => {
  it('returns customer detail with guarantorWarnings array', async () => {
    const res = await request
      .get(`/api/v1/customers/${firstCustomerId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(firstCustomerId);
    expect(res.body.data.fullName).toBe('Rajesh Kumar');
    expect(Array.isArray(res.body.data.guarantorWarnings)).toBe(true);
  });

  it('collector can view customer detail', async () => {
    const res = await request
      .get(`/api/v1/customers/${firstCustomerId}`)
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(200);
  });

  it('returns 404 for non-existent customer', async () => {
    const res = await request
      .get('/api/v1/customers/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for cross-tenant access', async () => {
    const res = await request
      .get(`/api/v1/customers/${firstCustomerId}`)
      .set('Authorization', `Bearer ${tenant2AdminAccessToken}`);

    expect(res.status).toBe(404);
  });

  it('populates guarantor warnings when defaulted loan exists', async () => {
    // Create a borrower
    const borrower = await prisma.customer.create({
      data: {
        tenantId,
        fullName: 'Borrower For Warning',
        phone: '6000100050',
        createdById: adminUserId,
      },
    });

    // Create a defaulted loan with firstCustomerId as guarantor
    await prisma.loan.create({
      data: {
        tenantId,
        loanNumber: 'CT-TEST-001',
        borrowerId: borrower.id,
        guarantorId: firstCustomerId,
        loanType: 'MONTHLY',
        principalAmount: 10000,
        interestRate: 2,
        disbursementDate: new Date('2025-01-01'),
        status: 'DEFAULTED',
        createdById: adminUserId,
      },
    });

    const res = await request
      .get(`/api/v1/customers/${firstCustomerId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.guarantorWarnings.length).toBeGreaterThanOrEqual(1);
    const warning = res.body.data.guarantorWarnings.find((w: any) => w.loanNumber === 'CT-TEST-001');
    expect(warning).toBeDefined();
    expect(warning.borrowerName).toBe('Borrower For Warning');
    expect(warning.status).toBe('DEFAULTED');
  });
});

// ─── PUT /customers/:id ────────────────────────────────────────────────────

describe('PUT /api/v1/customers/:id', () => {
  it('updates customer name', async () => {
    const res = await request
      .put(`/api/v1/customers/${firstCustomerId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ full_name: 'Rajesh Kumar Updated' });

    expect(res.status).toBe(200);
    expect(res.body.data.fullName).toBe('Rajesh Kumar Updated');
  });

  it('updates optional fields', async () => {
    const res = await request
      .put(`/api/v1/customers/${firstCustomerId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ occupation: 'Engineer', notes: 'Updated notes' });

    expect(res.status).toBe(200);
    expect(res.body.data.occupation).toBe('Engineer');
    expect(res.body.data.notes).toBe('Updated notes');
  });

  it('clears nullable field with null', async () => {
    const res = await request
      .put(`/api/v1/customers/${firstCustomerId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ occupation: null });

    expect(res.status).toBe(200);
    expect(res.body.data.occupation).toBeNull();
  });

  it('rejects duplicate aadhaar on update (409)', async () => {
    // Set aadhaar on firstCustomer first
    await request
      .put(`/api/v1/customers/${firstCustomerId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ aadhaar_number: '999988887777' });

    // Try to set same aadhaar on a different customer
    const other = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ full_name: 'Other Person', phone: '6000100020' });

    const res = await request
      .put(`/api/v1/customers/${other.body.data.id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ aadhaar_number: '999988887777' });

    expect(res.status).toBe(409);
  });

  it('rejects duplicate PAN on update (409)', async () => {
    await request
      .put(`/api/v1/customers/${firstCustomerId}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ pan_number: 'ZZZZZ9999Z' });

    const other = await request
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ full_name: 'PAN Dup Test', phone: '6000100021' });

    const res = await request
      .put(`/api/v1/customers/${other.body.data.id}`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ pan_number: 'ZZZZZ9999Z' });

    expect(res.status).toBe(409);
  });

  it('returns 404 for cross-tenant update', async () => {
    const res = await request
      .put(`/api/v1/customers/${firstCustomerId}`)
      .set('Authorization', `Bearer ${tenant2AdminAccessToken}`)
      .send({ full_name: 'Hacked' });

    expect(res.status).toBe(404);
  });

  it('collector cannot update (403)', async () => {
    const res = await request
      .put(`/api/v1/customers/${firstCustomerId}`)
      .set('Authorization', `Bearer ${collectorAccessToken}`)
      .send({ full_name: 'Blocked' });

    expect(res.status).toBe(403);
  });
});

// ─── GET /customers/:id/loans ──────────────────────────────────────────────

describe('GET /api/v1/customers/:id/loans', () => {
  it('returns empty array when no loans as borrower', async () => {
    const res = await request
      .get(`/api/v1/customers/${firstCustomerId}/loans`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('collector can view customer loans', async () => {
    const res = await request
      .get(`/api/v1/customers/${firstCustomerId}/loans`)
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(200);
  });

  it('returns 404 for non-existent customer', async () => {
    const res = await request
      .get('/api/v1/customers/00000000-0000-0000-0000-000000000000/loans')
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for cross-tenant access', async () => {
    const res = await request
      .get(`/api/v1/customers/${firstCustomerId}/loans`)
      .set('Authorization', `Bearer ${tenant2AdminAccessToken}`);

    expect(res.status).toBe(404);
  });
});

// ─── PATCH /customers/:id/clear-defaulter ──────────────────────────────────

describe('PATCH /api/v1/customers/:id/clear-defaulter', () => {
  it('clears defaulter flag', async () => {
    // Set is_defaulter via Prisma
    await prisma.customer.update({
      where: { id: firstCustomerId },
      data: { isDefaulter: true },
    });

    const res = await request
      .patch(`/api/v1/customers/${firstCustomerId}/clear-defaulter`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.isDefaulter).toBe(false);
  });

  it('returns 400 if not a defaulter', async () => {
    const res = await request
      .patch(`/api/v1/customers/${firstCustomerId}/clear-defaulter`)
      .set('Authorization', `Bearer ${adminAccessToken}`);

    expect(res.status).toBe(400);
  });

  it('returns 404 for cross-tenant access', async () => {
    const res = await request
      .patch(`/api/v1/customers/${firstCustomerId}/clear-defaulter`)
      .set('Authorization', `Bearer ${tenant2AdminAccessToken}`);

    expect(res.status).toBe(404);
  });

  it('collector cannot clear defaulter (403)', async () => {
    const res = await request
      .patch(`/api/v1/customers/${firstCustomerId}/clear-defaulter`)
      .set('Authorization', `Bearer ${collectorAccessToken}`);

    expect(res.status).toBe(403);
  });
});
