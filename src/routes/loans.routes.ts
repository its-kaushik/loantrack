import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenant.js';
import { requireRole } from '../middleware/require-role.js';
import { validate } from '../middleware/validate.js';
import {
  loanIdParamSchema,
  listLoansQuerySchema,
  listLoanTransactionsQuerySchema,
  createMonthlyLoanSchema,
} from '../schemas/loan.schema.js';
import * as loansController from '../controllers/loans.controller.js';

const router = Router();

// All loan routes require authentication + active tenant
router.use(authenticate, requireTenant);

// ADMIN can create
router.post(
  '/',
  requireRole('ADMIN'),
  validate({ body: createMonthlyLoanSchema }),
  loansController.createLoanHandler,
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

export default router;
