import type { UserRole } from '#generated/prisma/enums.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        tenantId: string | null;
        role: UserRole;
      };
      tenantId?: string;
      idempotencyKey?: string;
    }
  }
}
