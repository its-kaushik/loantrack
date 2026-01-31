import type { Request, Response } from 'express';
import * as usersService from '../services/users.service.js';
import { sendSuccess } from '../utils/response.js';

export async function listUsersHandler(req: Request, res: Response) {
  const users = await usersService.listUsers(req.tenantId!);
  sendSuccess(res, users);
}

export async function createUserHandler(req: Request, res: Response) {
  const user = await usersService.createUser(req.tenantId!, req.body);
  sendSuccess(res, user, 201);
}

export async function updateUserHandler(req: Request, res: Response) {
  const userId = req.params.id as string;
  const user = await usersService.updateUser(req.tenantId!, userId, req.body);
  sendSuccess(res, user);
}

export async function deactivateUserHandler(req: Request, res: Response) {
  const userId = req.params.id as string;
  const result = await usersService.deactivateUser(req.tenantId!, userId, req.user!.userId);
  sendSuccess(res, result);
}

export async function resetPasswordHandler(req: Request, res: Response) {
  const userId = req.params.id as string;
  const result = await usersService.resetPassword(req.tenantId!, userId, req.body.new_password);
  sendSuccess(res, result);
}
