import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenant.js';
import { requireRole } from '../middleware/require-role.js';
import { validate } from '../middleware/validate.js';
import { dateRangeQuerySchema } from '../schemas/dashboard.schema.js';
import * as reportsController from '../controllers/reports.controller.js';

const router = Router();

router.use(authenticate, requireTenant);

router.get(
  '/profit-loss',
  requireRole('ADMIN'),
  validate({ query: dateRangeQuerySchema }),
  reportsController.getProfitLossHandler,
);

router.get(
  '/collector-summary',
  requireRole('ADMIN'),
  validate({ query: dateRangeQuerySchema }),
  reportsController.getCollectorSummaryHandler,
);

router.get(
  '/loan-book',
  requireRole('ADMIN'),
  reportsController.getLoanBookHandler,
);

export default router;
