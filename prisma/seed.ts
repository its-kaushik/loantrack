import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

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
  const existingAdmin = await prisma.user.findFirst({
    where: { tenantId: tenant.id, phone: adminPhone },
  });

  if (!existingAdmin) {
    await prisma.user.create({
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
  const existingCollector = await prisma.user.findFirst({
    where: { tenantId: tenant.id, phone: collectorPhone },
  });

  if (!existingCollector) {
    await prisma.user.create({
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
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
