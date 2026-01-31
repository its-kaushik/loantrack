import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenant.js';
import { requireRole } from '../middleware/require-role.js';
import * as dashboardController from '../controllers/dashboard.controller.js';

const router = Router();

router.use(authenticate, requireTenant);

router.get('/today', requireRole('ADMIN'), dashboardController.getTodaySummaryHandler);
router.get('/overdue', requireRole('ADMIN'), dashboardController.getOverdueLoansHandler);
router.get('/defaulters', requireRole('ADMIN'), dashboardController.getDefaultersHandler);
router.get('/fund-summary', requireRole('ADMIN'), dashboardController.getFundSummaryHandler);

export default router;
