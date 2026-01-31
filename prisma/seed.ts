import 'dotenv/config';
import bcrypt from 'bcrypt';
import Decimal from 'decimal.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

const BCRYPT_ROUNDS = 12;

async function main() {
  // 1. Super Admin
  const superAdminPhone = '9000000000';
  const existingSuperAdmin = await prisma.user.findFirst({
    where: { phone: superAdminPhone, role: 'SUPER_ADMIN' },
  });

  if (!existingSuperAdmin) {
    await prisma.user.create({
      data: {
        name: 'Super Admin',
        phone: superAdminPhone,
        passwordHash: await bcrypt.hash('SuperAdmin@123', BCRYPT_ROUNDS),
        role: 'SUPER_ADMIN',
      },
    });
    console.log('Created super admin (phone: 9000000000)');
  } else {
    console.log('Super admin already exists, skipping');
  }

  // 2. Demo Tenant
  let tenant = await prisma.tenant.findUnique({ where: { slug: 'demo-finance' } });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'Demo Finance',
        slug: 'demo-finance',
        ownerName: 'Demo Owner',
        ownerPhone: '9000000001',
      },
    });
    console.log('Created tenant: Demo Finance');
  } else {
    console.log('Tenant demo-finance already exists, skipping');
  }

  // 3. Admin user for tenant
  const adminPhone = '9100000001';
  let admin = await prisma.user.findFirst({
    where: { tenantId: tenant.id, phone: adminPhone },
  });

  if (!admin) {
    admin = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: 'Demo Admin',
        phone: adminPhone,
        passwordHash: await bcrypt.hash('Admin@123', BCRYPT_ROUNDS),
        role: 'ADMIN',
      },
    });
    console.log('Created admin user (phone: 9100000001)');
  } else {
    console.log('Admin user already exists, skipping');
  }

  // 4. Collector user for tenant
  const collectorPhone = '9200000001';
  let collector = await prisma.user.findFirst({
    where: { tenantId: tenant.id, phone: collectorPhone },
  });

  if (!collector) {
    collector = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name: 'Demo Collector',
        phone: collectorPhone,
        passwordHash: await bcrypt.hash('Collector@123', BCRYPT_ROUNDS),
        role: 'COLLECTOR',
      },
    });
    console.log('Created collector user (phone: 9200000001)');
  } else {
    console.log('Collector user already exists, skipping');
  }

  // ─── Demo Data ────────────────────────────────────────────────────────────

  // 5. Demo Customers
  const customerPhones = ['9300000001', '9300000002', '9300000003'];
  const existingCustomer = await prisma.customer.findFirst({
    where: { tenantId: tenant.id, phone: customerPhones[0] },
  });

  if (existingCustomer) {
    console.log('Demo customers already exist, skipping demo data');
    return;
  }

  const borrower1 = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      fullName: 'Rajesh Kumar',
      phone: customerPhones[0]!,
      address: '123 MG Road, Bangalore',
      occupation: 'Shop Owner',
      notes: 'Regular borrower, good repayment history',
      createdById: admin.id,
    },
  });
  console.log('Created customer: Rajesh Kumar (borrower)');

  const guarantor = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      fullName: 'Suresh Patel',
      phone: customerPhones[1]!,
      address: '456 Brigade Road, Bangalore',
      occupation: 'Textile Merchant',
      notes: 'Acts as guarantor',
      createdById: admin.id,
    },
  });
  console.log('Created customer: Suresh Patel (guarantor)');

  const borrower2 = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      fullName: 'Priya Sharma',
      phone: customerPhones[2]!,
      address: '789 Church Street, Bangalore',
      occupation: 'Restaurant Owner',
      notes: 'Second borrower with daily loan',
      createdById: admin.id,
    },
  });
  console.log('Created customer: Priya Sharma (borrower)');

  // 6. Monthly Loan — Rs 1,00,000 at 2% monthly
  const mlDisbursementDate = new Date('2025-12-01');
  const mlPrincipal = new Decimal(100000);
  const mlRate = new Decimal(2);
  const mlDueDay = mlDisbursementDate.getUTCDate(); // day 1
  const mlBillingPrincipal = mlPrincipal; // no principal returned yet
  const mlAdvanceInterest = mlBillingPrincipal.mul(mlRate).div(100);

  // Generate loan number
  const mlSeqRows: Array<{ current_value: number }> = await prisma.$queryRaw`
    INSERT INTO loan_number_sequences (tenant_id, year, loan_type, current_value)
    VALUES (${tenant.id}::uuid, 2025, 'MONTHLY'::"LoanType", 1)
    ON CONFLICT (tenant_id, year, loan_type)
    DO UPDATE SET current_value = loan_number_sequences.current_value + 1
    RETURNING current_value
  `;
  const mlLoanNumber = `ML-2025-${String(mlSeqRows[0]!.current_value).padStart(4, '0')}`;

  const monthlyLoan = await prisma.loan.create({
    data: {
      tenantId: tenant.id,
      loanNumber: mlLoanNumber,
      borrowerId: borrower1.id,
      guarantorId: guarantor.id,
      loanType: 'MONTHLY',
      principalAmount: mlPrincipal,
      interestRate: mlRate,
      disbursementDate: mlDisbursementDate,
      monthlyDueDay: mlDueDay,
      remainingPrincipal: mlPrincipal,
      billingPrincipal: mlBillingPrincipal,
      advanceInterestAmount: mlAdvanceInterest,
      status: 'ACTIVE',
      createdById: admin.id,
    },
  });
  console.log(`Created monthly loan: ${mlLoanNumber}`);

  // Disbursement transaction
  await prisma.transaction.create({
    data: {
      tenantId: tenant.id,
      loanId: monthlyLoan.id,
      transactionType: 'DISBURSEMENT',
      amount: mlPrincipal,
      transactionDate: mlDisbursementDate,
      approvalStatus: 'APPROVED',
      approvedById: admin.id,
      approvedAt: mlDisbursementDate,
    },
  });
  console.log('  Created DISBURSEMENT transaction');

  // Advance interest transaction
  await prisma.transaction.create({
    data: {
      tenantId: tenant.id,
      loanId: monthlyLoan.id,
      transactionType: 'ADVANCE_INTEREST',
      amount: mlAdvanceInterest,
      transactionDate: mlDisbursementDate,
      effectiveDate: mlDisbursementDate,
      approvalStatus: 'APPROVED',
      approvedById: admin.id,
      approvedAt: mlDisbursementDate,
    },
  });
  console.log(`  Created ADVANCE_INTEREST transaction (Rs ${mlAdvanceInterest.toFixed(2)})`);

  // 7. Daily Loan — Rs 50,000 at 5% for 100 days
  const dlDisbursementDate = new Date('2026-01-01');
  const dlPrincipal = new Decimal(50000);
  const dlRate = new Decimal(5);
  const dlTermDays = 100;
  // totalRepayment = principal * (1 + rate/100 * termDays/30)
  const dlTotalRepayment = dlPrincipal.mul(
    new Decimal(1).add(dlRate.div(100).mul(dlTermDays).div(30)),
  );
  const dlDailyPayment = dlTotalRepayment.div(dlTermDays);
  const dlTermEndDate = new Date('2026-04-11'); // Jan 1 + 100 days

  // Generate loan number
  const dlSeqRows: Array<{ current_value: number }> = await prisma.$queryRaw`
    INSERT INTO loan_number_sequences (tenant_id, year, loan_type, current_value)
    VALUES (${tenant.id}::uuid, 2026, 'DAILY'::"LoanType", 1)
    ON CONFLICT (tenant_id, year, loan_type)
    DO UPDATE SET current_value = loan_number_sequences.current_value + 1
    RETURNING current_value
  `;
  const dlLoanNumber = `DL-2026-${String(dlSeqRows[0]!.current_value).padStart(4, '0')}`;

  const dailyLoan = await prisma.loan.create({
    data: {
      tenantId: tenant.id,
      loanNumber: dlLoanNumber,
      borrowerId: borrower2.id,
      loanType: 'DAILY',
      principalAmount: dlPrincipal,
      interestRate: dlRate,
      disbursementDate: dlDisbursementDate,
      termDays: dlTermDays,
      totalRepaymentAmount: dlTotalRepayment,
      dailyPaymentAmount: dlDailyPayment,
      termEndDate: dlTermEndDate,
      graceDays: 7,
      totalCollected: dlDailyPayment.mul(10), // 10 collections made
      status: 'ACTIVE',
      createdById: admin.id,
    },
  });
  console.log(`Created daily loan: ${dlLoanNumber}`);

  // Disbursement transaction
  await prisma.transaction.create({
    data: {
      tenantId: tenant.id,
      loanId: dailyLoan.id,
      transactionType: 'DISBURSEMENT',
      amount: dlPrincipal,
      transactionDate: dlDisbursementDate,
      approvalStatus: 'APPROVED',
      approvedById: admin.id,
      approvedAt: dlDisbursementDate,
    },
  });
  console.log('  Created DISBURSEMENT transaction');

  // 10 daily collections
  for (let i = 1; i <= 10; i++) {
    const collectionDate = new Date(dlDisbursementDate);
    collectionDate.setUTCDate(collectionDate.getUTCDate() + i);
    await prisma.transaction.create({
      data: {
        tenantId: tenant.id,
        loanId: dailyLoan.id,
        transactionType: 'DAILY_COLLECTION',
        amount: dlDailyPayment,
        transactionDate: collectionDate,
        collectedById: collector.id,
        approvalStatus: 'APPROVED',
        approvedById: admin.id,
        approvedAt: collectionDate,
      },
    });
  }
  console.log(`  Created 10 DAILY_COLLECTION transactions (Rs ${dlDailyPayment.toFixed(2)} each)`);

  // 8. Fund Entries
  await prisma.fundEntry.create({
    data: {
      tenantId: tenant.id,
      entryType: 'INJECTION',
      amount: 500000,
      description: 'Initial capital injection',
      entryDate: new Date('2025-12-01'),
      createdById: admin.id,
    },
  });
  console.log('Created fund entry: INJECTION Rs 5,00,000');

  await prisma.fundEntry.create({
    data: {
      tenantId: tenant.id,
      entryType: 'WITHDRAWAL',
      amount: 25000,
      description: 'Monthly office rent',
      entryDate: new Date('2026-01-01'),
      createdById: admin.id,
    },
  });
  console.log('Created fund entry: WITHDRAWAL Rs 25,000');

  // 9. Expense
  await prisma.expense.create({
    data: {
      tenantId: tenant.id,
      category: 'TRAVEL',
      amount: 3500,
      description: 'Collection trip — North zone',
      expenseDate: new Date('2026-01-15'),
      createdById: admin.id,
    },
  });
  console.log('Created expense: TRAVEL Rs 3,500');

  console.log('\nSeed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
