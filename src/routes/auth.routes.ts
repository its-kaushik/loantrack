import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { loginSchema, refreshSchema, changePasswordSchema } from '../schemas/auth.schema.js';
import * as authController from '../controllers/auth.controller.js';

const router = Router();

// Public routes
router.post('/login', validate({ body: loginSchema }), authController.loginHandler);
router.post('/refresh', validate({ body: refreshSchema }), authController.refreshHandler);

// Authenticated routes
router.post('/logout', authenticate, authController.logoutHandler);
router.patch('/change-password', authenticate, validate({ body: changePasswordSchema }), authController.changePasswordHandler);
router.get('/me', authenticate, authController.getMeHandler);

export default router;
