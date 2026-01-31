import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenant.js';
import { requireRole } from '../middleware/require-role.js';
import { validate } from '../middleware/validate.js';
import {
  loanIdParamSchema,
  listLoansQuerySchema,
  listLoanTransactionsQuerySchema,
  createLoanSchema,
  cancelLoanSchema,
} from '../schemas/loan.schema.js';
import { migrateLoanSchema } from '../schemas/migration.schema.js';
import {
  imposePenaltySchema,
  listPenaltiesQuerySchema,
  waiveInterestSchema,
  listWaiversQuerySchema,
} from '../schemas/penalty.schema.js';
import * as loansController from '../controllers/loans.controller.js';
import * as penaltiesController from '../controllers/penalties.controller.js';

const router = Router();

// All loan routes require authentication + active tenant
router.use(authenticate, requireTenant);

// ADMIN can create
router.post(
  '/',
  requireRole('ADMIN'),
  validate({ body: createLoanSchema }),
  loansController.createLoanHandler,
);

// ADMIN can migrate pre-existing loans
router.post(
  '/migrate',
  requireRole('ADMIN'),
  validate({ body: migrateLoanSchema }),
  loansController.migrateLoanHandler,
);

// ADMIN + COLLECTOR can read
router.get(
  '/',
  requireRole('ADMIN', 'COLLECTOR'),
  validate({ query: listLoansQuerySchema }),
  loansController.listLoansHandler,
);

router.get(
  '/:id',
  requireRole('ADMIN', 'COLLECTOR'),
  validate({ params: loanIdParamSchema }),
  loansController.getLoanHandler,
);

// ADMIN only for transactions and payment status
router.get(
  '/:id/transactions',
  requireRole('ADMIN'),
  validate({ params: loanIdParamSchema, query: listLoanTransactionsQuerySchema }),
  loansController.getLoanTransactionsHandler,
);

router.get(
  '/:id/payment-status',
  requireRole('ADMIN'),
  validate({ params: loanIdParamSchema }),
  loansController.getPaymentStatusHandler,
);

// ADMIN only can close
router.patch(
  '/:id/close',
  requireRole('ADMIN'),
  validate({ params: loanIdParamSchema }),
  loansController.closeLoanHandler,
);

// ADMIN only can default
router.patch(
  '/:id/default',
  requireRole('ADMIN'),
  validate({ params: loanIdParamSchema }),
  loansController.defaultLoanHandler,
);

// ADMIN only can write off
router.patch(
  '/:id/write-off',
  requireRole('ADMIN'),
  validate({ params: loanIdParamSchema }),
  loansController.writeOffLoanHandler,
);

// ADMIN only can cancel
router.patch(
  '/:id/cancel',
  requireRole('ADMIN'),
  validate({ params: loanIdParamSchema, body: cancelLoanSchema }),
  loansController.cancelLoanHandler,
);

// ─── Penalty & Waiver Routes ───────────────────────────────────────────────

// ADMIN only can impose penalties
router.post(
  '/:id/penalties',
  requireRole('ADMIN'),
  validate({ params: loanIdParamSchema, body: imposePenaltySchema }),
  penaltiesController.imposePenaltyHandler,
);

// ADMIN only can list penalties
router.get(
  '/:id/penalties',
  requireRole('ADMIN'),
  validate({ params: loanIdParamSchema, query: listPenaltiesQuerySchema }),
  penaltiesController.listPenaltiesHandler,
);

// ADMIN only can waive interest
router.post(
  '/:id/waive-interest',
  requireRole('ADMIN'),
  validate({ params: loanIdParamSchema, body: waiveInterestSchema }),
  penaltiesController.waiveInterestHandler,
);

// ADMIN only can list waivers
router.get(
  '/:id/waivers',
  requireRole('ADMIN'),
  validate({ params: loanIdParamSchema, query: listWaiversQuerySchema }),
  penaltiesController.listWaiversHandler,
);

export default router;
