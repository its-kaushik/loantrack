import { jest } from '@jest/globals';
import prisma from '../helpers/prisma';

// Remote DB can be slow — increase timeout for all tests in this file
jest.setTimeout(30_000);

/**
 * Integration tests verifying database-level check constraints and partial unique indexes.
 * These constraints are defined in migration 20260131063104_add_constraints_and_partial_indexes.
 */

let tenantId: string;
let tenantId2: string;
let userId: string;
let customerId: string;
let loanId: string;

beforeAll(async () => {
  // Create prerequisite records for constraint testing.
  // We use Prisma client for setup so relations are valid.

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Constraint Test Tenant',
      slug: 'constraint-test',
      ownerName: 'Test Owner',
      ownerPhone: '9000000001',
    },
  });
  tenantId = tenant.id;

  const tenant2 = await prisma.tenant.create({
    data: {
      name: 'Constraint Test Tenant 2',
      slug: 'constraint-test-2',
      ownerName: 'Test Owner 2',
      ownerPhone: '9000000002',
    },
  });
  tenantId2 = tenant2.id;

  const user = await prisma.user.create({
    data: {
      tenantId,
      name: 'Test Admin',
      phone: '9100000001',
      passwordHash: '$2b$12$placeholder',
      role: 'ADMIN',
    },
  });
  userId = user.id;

  const customer = await prisma.customer.create({
    data: {
      tenantId,
      fullName: 'Test Borrower',
      phone: '9200000001',
      createdById: userId,
    },
  });
  customerId = customer.id;

  const loan = await prisma.loan.create({
    data: {
      tenantId,
      loanNumber: 'TEST-001',
      borrowerId: customerId,
      loanType: 'MONTHLY',
      principalAmount: 100000,
      interestRate: 2.0,
      disbursementDate: new Date('2025-01-01'),
      remainingPrincipal: 100000,
      billingPrincipal: 100000,
      totalCollected: 0,
      createdById: userId,
    },
  });
  loanId = loan.id;
});

afterAll(async () => {
  // Clean up in reverse dependency order
  await prisma.transaction.deleteMany({ where: { tenantId: { in: [tenantId, tenantId2] } } });
  await prisma.loan.deleteMany({ where: { tenantId: { in: [tenantId, tenantId2] } } });
  await prisma.customer.deleteMany({ where: { tenantId: { in: [tenantId, tenantId2] } } });
  await prisma.user.deleteMany({ where: { tenantId: { in: [tenantId, tenantId2] } } });
  // Clean up super admin test users (tenantId IS NULL)
  await prisma.$executeRaw`DELETE FROM "users" WHERE "phone" IN ('9500000001', '9500000002')`;
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, tenantId2] } } });
  await prisma.$disconnect();
});

// ─── Check Constraints: Loans ──────────────────────────────────────────────

describe('Check constraint: chk_loans_remaining_principal_non_negative', () => {
  it('rejects negative remaining_principal', async () => {
    await expect(
      prisma.$executeRaw`
        UPDATE "loans"
        SET "remaining_principal" = -1
        WHERE "id" = ${loanId}::uuid
      `
    ).rejects.toThrow(/chk_loans_remaining_principal_non_negative/);
  });

  it('allows zero remaining_principal', async () => {
    // Should not throw
    await prisma.$executeRaw`
      UPDATE "loans"
      SET "remaining_principal" = 0
      WHERE "id" = ${loanId}::uuid
    `;
    // Restore original value
    await prisma.$executeRaw`
      UPDATE "loans"
      SET "remaining_principal" = 100000
      WHERE "id" = ${loanId}::uuid
    `;
  });
});

describe('Check constraint: chk_loans_billing_principal_non_negative', () => {
  it('rejects negative billing_principal', async () => {
    await expect(
      prisma.$executeRaw`
        UPDATE "loans"
        SET "billing_principal" = -0.01
        WHERE "id" = ${loanId}::uuid
      `
    ).rejects.toThrow(/chk_loans_billing_principal_non_negative/);
  });

  it('allows zero billing_principal', async () => {
    await prisma.$executeRaw`
      UPDATE "loans"
      SET "billing_principal" = 0
      WHERE "id" = ${loanId}::uuid
    `;
    await prisma.$executeRaw`
      UPDATE "loans"
      SET "billing_principal" = 100000
      WHERE "id" = ${loanId}::uuid
    `;
  });
});

describe('Check constraint: chk_loans_total_collected_non_negative', () => {
  it('rejects negative total_collected', async () => {
    await expect(
      prisma.$executeRaw`
        UPDATE "loans"
        SET "total_collected" = -100
        WHERE "id" = ${loanId}::uuid
      `
    ).rejects.toThrow(/chk_loans_total_collected_non_negative/);
  });

  it('allows zero total_collected', async () => {
    await prisma.$executeRaw`
      UPDATE "loans"
      SET "total_collected" = 0
      WHERE "id" = ${loanId}::uuid
    `;
  });
});

// ─── Check Constraint: Transactions ─────────────────────────────────────────

describe('Check constraint: chk_transactions_amount_positive_or_correction', () => {
  it('rejects zero amount without corrected_transaction_id', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO "transactions" (
          "id", "tenant_id", "loan_id", "transaction_type", "amount",
          "transaction_date", "approval_status", "created_at", "updated_at"
        ) VALUES (
          gen_random_uuid(), ${tenantId}::uuid, ${loanId}::uuid,
          'INTEREST_PAYMENT', 0, '2025-02-01', 'APPROVED', NOW(), NOW()
        )
      `
    ).rejects.toThrow(/chk_transactions_amount_positive_or_correction/);
  });

  it('rejects negative amount without corrected_transaction_id', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO "transactions" (
          "id", "tenant_id", "loan_id", "transaction_type", "amount",
          "transaction_date", "approval_status", "created_at", "updated_at"
        ) VALUES (
          gen_random_uuid(), ${tenantId}::uuid, ${loanId}::uuid,
          'INTEREST_PAYMENT', -50, '2025-02-01', 'APPROVED', NOW(), NOW()
        )
      `
    ).rejects.toThrow(/chk_transactions_amount_positive_or_correction/);
  });

  it('allows positive amount without corrected_transaction_id', async () => {
    await prisma.$executeRaw`
      INSERT INTO "transactions" (
        "id", "tenant_id", "loan_id", "transaction_type", "amount",
        "transaction_date", "approval_status", "created_at", "updated_at"
      ) VALUES (
        gen_random_uuid(), ${tenantId}::uuid, ${loanId}::uuid,
        'INTEREST_PAYMENT', 1000, '2025-02-01', 'APPROVED', NOW(), NOW()
      )
    `;
  });

  it('allows negative amount when corrected_transaction_id is set', async () => {
    // First, create a transaction to reference as the corrected one
    const original = await prisma.transaction.create({
      data: {
        tenantId,
        loanId,
        transactionType: 'INTEREST_PAYMENT',
        amount: 500,
        transactionDate: new Date('2025-02-01'),
        approvalStatus: 'APPROVED',
      },
    });

    // Correction with negative amount should be allowed
    await prisma.$executeRaw`
      INSERT INTO "transactions" (
        "id", "tenant_id", "loan_id", "corrected_transaction_id",
        "transaction_type", "amount", "transaction_date",
        "approval_status", "created_at", "updated_at"
      ) VALUES (
        gen_random_uuid(), ${tenantId}::uuid, ${loanId}::uuid,
        ${original.id}::uuid, 'INTEREST_PAYMENT', -500, '2025-02-01',
        'APPROVED', NOW(), NOW()
      )
    `;
  });
});

// ─── Partial Unique Indexes: Users Phone ────────────────────────────────────

describe('Partial unique index: uq_users_tenant_phone', () => {
  it('rejects duplicate phone within the same tenant', async () => {
    // userId already exists with phone '9100000001' in tenantId
    await expect(
      prisma.user.create({
        data: {
          tenantId,
          name: 'Duplicate Phone User',
          phone: '9100000001',
          passwordHash: '$2b$12$placeholder',
          role: 'COLLECTOR',
        },
      })
    ).rejects.toThrow(/uq_users_tenant_phone|Unique constraint/);
  });

  it('allows same phone in different tenants', async () => {
    const user2 = await prisma.user.create({
      data: {
        tenantId: tenantId2,
        name: 'Same Phone Different Tenant',
        phone: '9100000001',
        passwordHash: '$2b$12$placeholder',
        role: 'ADMIN',
      },
    });
    expect(user2.id).toBeDefined();
  });
});

describe('Partial unique index: uq_users_global_phone', () => {
  it('rejects duplicate phone among super admins (tenant_id IS NULL)', async () => {
    // Create a super admin
    await prisma.$executeRaw`
      INSERT INTO "users" ("id", "name", "phone", "password_hash", "role", "created_at", "updated_at")
      VALUES (gen_random_uuid(), 'Super Admin 1', '9500000001', '$2b$12$placeholder', 'SUPER_ADMIN', NOW(), NOW())
    `;

    // Duplicate phone for another super admin should fail
    await expect(
      prisma.$executeRaw`
        INSERT INTO "users" ("id", "name", "phone", "password_hash", "role", "created_at", "updated_at")
        VALUES (gen_random_uuid(), 'Super Admin 2', '9500000001', '$2b$12$placeholder', 'SUPER_ADMIN', NOW(), NOW())
      `
    ).rejects.toThrow(/uq_users_global_phone|Unique constraint|already exists/);
  });

  it('allows different phones among super admins', async () => {
    await prisma.$executeRaw`
      INSERT INTO "users" ("id", "name", "phone", "password_hash", "role", "created_at", "updated_at")
      VALUES (gen_random_uuid(), 'Super Admin 3', '9500000002', '$2b$12$placeholder', 'SUPER_ADMIN', NOW(), NOW())
    `;
    // No error means it passed
  });
});
