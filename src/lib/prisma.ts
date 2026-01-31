import { PrismaClient } from '#generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '../config/index.js';

const adapter = new PrismaPg({
  connectionString: config.database.url,
});

const prisma = new PrismaClient({ adapter });

export default prisma;
