import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenant.js';
import { requireRole } from '../middleware/require-role.js';
import { validate } from '../middleware/validate.js';
import {
  createExpenseSchema,
  updateExpenseSchema,
  expenseIdParamSchema,
  listExpensesQuerySchema,
} from '../schemas/expense.schema.js';
import * as expensesController from '../controllers/expenses.controller.js';

const router = Router();

router.use(authenticate, requireTenant);

router.get(
  '/',
  requireRole('ADMIN'),
  validate({ query: listExpensesQuerySchema }),
  expensesController.listExpensesHandler,
);

router.post(
  '/',
  requireRole('ADMIN'),
  validate({ body: createExpenseSchema }),
  expensesController.createExpenseHandler,
);

router.put(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: expenseIdParamSchema, body: updateExpenseSchema }),
  expensesController.updateExpenseHandler,
);

router.patch(
  '/:id/delete',
  requireRole('ADMIN'),
  validate({ params: expenseIdParamSchema }),
  expensesController.softDeleteExpenseHandler,
);

export default router;
