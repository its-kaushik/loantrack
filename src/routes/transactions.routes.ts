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
  fixEntrySchema,
  removeEntrySchema,
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

// ADMIN + COLLECTOR — bulk daily collections with idempotency
router.post(
  '/bulk',
  requireRole('ADMIN', 'COLLECTOR'),
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

// ADMIN + COLLECTOR — list transactions (collectors auto-scoped to own)
router.get(
  '/',
  requireRole('ADMIN', 'COLLECTOR'),
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

// ADMIN only — the payment a transaction belongs to, and whether it may be changed
router.get(
  '/:id/entry',
  requireRole('ADMIN'),
  validate({ params: transactionIdParamSchema }),
  transactionsController.getEntryHandler,
);

// ADMIN only — undo a wrongly recorded payment and record the corrected one
router.post(
  '/:id/fix',
  requireRole('ADMIN'),
  validate({ params: transactionIdParamSchema, body: fixEntrySchema }),
  transactionsController.fixEntryHandler,
);

// ADMIN only — undo a payment that should not have been recorded
router.post(
  '/:id/remove',
  requireRole('ADMIN'),
  validate({ params: transactionIdParamSchema, body: removeEntrySchema }),
  transactionsController.removeEntryHandler,
);

export default router;
