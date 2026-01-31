import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenant.js';
import { requireRole } from '../middleware/require-role.js';
import { validate } from '../middleware/validate.js';
import { penaltyIdParamSchema, waivePenaltySchema } from '../schemas/penalty.schema.js';
import * as penaltiesController from '../controllers/penalties.controller.js';

const router = Router();

// All penalty routes require authentication + active tenant
router.use(authenticate, requireTenant);

// ADMIN only can waive penalties
router.patch(
  '/:id/waive',
  requireRole('ADMIN'),
  validate({ params: penaltyIdParamSchema, body: waivePenaltySchema }),
  penaltiesController.waivePenaltyHandler,
);

export default router;
