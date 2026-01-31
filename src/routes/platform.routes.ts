import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/require-role.js';
import { validate } from '../middleware/validate.js';
import { createTenantSchema, listTenantsQuerySchema, tenantIdParamSchema } from '../schemas/platform.schema.js';
import * as platformController from '../controllers/platform.controller.js';

const router = Router();

// All platform routes: authenticate + SUPER_ADMIN only (no requireTenant)
router.use(authenticate, requireRole('SUPER_ADMIN'));

router.post(
  '/tenants',
  validate({ body: createTenantSchema }),
  platformController.createTenantHandler,
);

router.get(
  '/tenants',
  validate({ query: listTenantsQuerySchema }),
  platformController.listTenantsHandler,
);

router.get(
  '/tenants/:id',
  validate({ params: tenantIdParamSchema }),
  platformController.getTenantHandler,
);

router.patch(
  '/tenants/:id/suspend',
  validate({ params: tenantIdParamSchema }),
  platformController.suspendTenantHandler,
);

router.patch(
  '/tenants/:id/activate',
  validate({ params: tenantIdParamSchema }),
  platformController.activateTenantHandler,
);

router.get(
  '/stats',
  platformController.getPlatformStatsHandler,
);

export default router;
