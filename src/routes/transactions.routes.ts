import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenant.js';
import { requireRole } from '../middleware/require-role.js';
import { validate } from '../middleware/validate.js';
import { createTransactionSchema } from '../schemas/transaction.schema.js';
import * as transactionsController from '../controllers/transactions.controller.js';

const router = Router();

// All transaction routes require authentication + active tenant
router.use(authenticate, requireTenant);

// ADMIN only can create transactions
router.post(
  '/',
  requireRole('ADMIN'),
  validate({ body: createTransactionSchema }),
  transactionsController.createTransactionHandler,
);

export default router;
