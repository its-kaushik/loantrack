import type { UserRole } from '@prisma/client';

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
