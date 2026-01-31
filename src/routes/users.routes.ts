import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireTenant } from '../middleware/tenant.js';
import { requireRole } from '../middleware/require-role.js';
import { validate } from '../middleware/validate.js';
import { createUserSchema, updateUserSchema, resetPasswordSchema, userIdParamSchema } from '../schemas/user.schema.js';
import * as usersController from '../controllers/users.controller.js';

const router = Router();

// All user management routes require: authenticated + active tenant + ADMIN role
router.use(authenticate, requireTenant, requireRole('ADMIN'));

router.get('/', usersController.listUsersHandler);
router.post('/', validate({ body: createUserSchema }), usersController.createUserHandler);
router.put('/:id', validate({ params: userIdParamSchema, body: updateUserSchema }), usersController.updateUserHandler);
router.patch('/:id/deactivate', validate({ params: userIdParamSchema }), usersController.deactivateUserHandler);
router.post('/:id/reset-password', validate({ params: userIdParamSchema, body: resetPasswordSchema }), usersController.resetPasswordHandler);

export default router;
