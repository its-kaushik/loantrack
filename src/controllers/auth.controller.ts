import type { Request, Response } from 'express';
import * as authService from '../services/auth.service.js';
import { sendSuccess } from '../utils/response.js';

export async function loginHandler(req: Request, res: Response) {
  const { phone, password } = req.body;
  const result = await authService.login(phone, password);
  sendSuccess(res, result);
}

export async function refreshHandler(req: Request, res: Response) {
  const { refresh_token } = req.body;
  const result = await authService.refresh(refresh_token);
  sendSuccess(res, result);
}

export async function logoutHandler(req: Request, res: Response) {
  await authService.logout(req.user!.userId);
  sendSuccess(res, { message: 'Logged out successfully' });
}

export async function changePasswordHandler(req: Request, res: Response) {
  const { current_password, new_password } = req.body;
  await authService.changePassword(req.user!.userId, current_password, new_password);
  sendSuccess(res, { message: 'Password changed successfully' });
}

export async function getMeHandler(req: Request, res: Response) {
  const user = await authService.getMe(req.user!.userId);
  sendSuccess(res, user);
}
