import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenant.js';
import { requireRole } from '../middleware/require-role.js';
import { validate } from '../middleware/validate.js';
import { createFundEntrySchema, listFundEntriesQuerySchema } from '../schemas/fund.schema.js';
import * as fundController from '../controllers/fund.controller.js';

const router = Router();

router.use(authenticate, requireTenant);

router.get(
  '/entries',
  requireRole('ADMIN'),
  validate({ query: listFundEntriesQuerySchema }),
  fundController.listFundEntriesHandler,
);

router.post(
  '/entries',
  requireRole('ADMIN'),
  validate({ body: createFundEntrySchema }),
  fundController.createFundEntryHandler,
);

router.get(
  '/summary',
  requireRole('ADMIN'),
  fundController.getFundSummaryHandler,
);

router.get(
  '/reconciliation',
  requireRole('ADMIN'),
  fundController.getReconciliationHandler,
);

export default router;
