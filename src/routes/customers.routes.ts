import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenant.js';
import { requireRole } from '../middleware/require-role.js';
import { validate } from '../middleware/validate.js';
import {
  customerIdParamSchema,
  listCustomersQuerySchema,
  createCustomerSchema,
  updateCustomerSchema,
} from '../schemas/customer.schema.js';
import * as customersController from '../controllers/customers.controller.js';

const router = Router();

// All customer routes require authentication + active tenant
router.use(authenticate, requireTenant);

// ADMIN + COLLECTOR can read
router.get(
  '/',
  requireRole('ADMIN', 'COLLECTOR'),
  validate({ query: listCustomersQuerySchema }),
  customersController.listCustomersHandler,
);
router.get(
  '/:id',
  requireRole('ADMIN', 'COLLECTOR'),
  validate({ params: customerIdParamSchema }),
  customersController.getCustomerHandler,
);
router.get(
  '/:id/loans',
  requireRole('ADMIN', 'COLLECTOR'),
  validate({ params: customerIdParamSchema }),
  customersController.getCustomerLoansHandler,
);

// ADMIN only can write
router.post(
  '/',
  requireRole('ADMIN'),
  validate({ body: createCustomerSchema }),
  customersController.createCustomerHandler,
);
router.put(
  '/:id',
  requireRole('ADMIN'),
  validate({ params: customerIdParamSchema, body: updateCustomerSchema }),
  customersController.updateCustomerHandler,
);
router.patch(
  '/:id/clear-defaulter',
  requireRole('ADMIN'),
  validate({ params: customerIdParamSchema }),
  customersController.clearDefaulterHandler,
);

export default router;
