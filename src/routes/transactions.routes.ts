import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenant.js';
import { requireRole } from '../middleware/require-role.js';
import { validate } from '../middleware/validate.js';
import { requireIdempotencyKey } from '../middleware/idempotency.js';
import {
  createTransactionSchema,
  bulkCollectionSchema,
  rejectTransactionSchema,
  transactionIdParamSchema,
  listTransactionsQuerySchema,
  pendingTransactionsQuerySchema,
} from '../schemas/transaction.schema.js';
import * as transactionsController from '../controllers/transactions.controller.js';

const router = Router();

// All transaction routes require authentication + active tenant
router.use(authenticate, requireTenant);

// ─── Specific routes MUST come before parameterized routes ───────────────

// ADMIN + COLLECTOR can create transactions (role determines approval status)
router.post(
  '/',
  requireRole('ADMIN', 'COLLECTOR'),
  validate({ body: createTransactionSchema }),
  transactionsController.createTransactionHandler,
);

// COLLECTOR only — bulk daily collections with idempotency
router.post(
  '/bulk',
  requireRole('COLLECTOR'),
  requireIdempotencyKey(),
  validate({ body: bulkCollectionSchema }),
  transactionsController.bulkCollectionHandler,
);

// ADMIN only — list pending approvals
router.get(
  '/pending',
  requireRole('ADMIN'),
  validate({ query: pendingTransactionsQuerySchema }),
  transactionsController.listPendingHandler,
);

// ADMIN only — list all transactions with filters
router.get(
  '/',
  requireRole('ADMIN'),
  validate({ query: listTransactionsQuerySchema }),
  transactionsController.listTransactionsHandler,
);

// ─── Parameterized routes ────────────────────────────────────────────────

// ADMIN only — approve a pending transaction
router.patch(
  '/:id/approve',
  requireRole('ADMIN'),
  validate({ params: transactionIdParamSchema }),
  transactionsController.approveTransactionHandler,
);

// ADMIN only — reject a pending transaction
router.patch(
  '/:id/reject',
  requireRole('ADMIN'),
  validate({ params: transactionIdParamSchema, body: rejectTransactionSchema }),
  transactionsController.rejectTransactionHandler,
);

export default router;
