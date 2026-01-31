import type { Request, Response } from 'express';
import * as expensesService from '../services/expenses.service.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';

export async function createExpenseHandler(req: Request, res: Response) {
  const result = await expensesService.createExpense(req.tenantId!, req.user!.userId, req.body);
  sendSuccess(res, result, 201);
}

export async function updateExpenseHandler(req: Request, res: Response) {
  const expenseId = req.params.id as string;
  const result = await expensesService.updateExpense(req.tenantId!, expenseId, req.body);
  sendSuccess(res, result);
}

export async function softDeleteExpenseHandler(req: Request, res: Response) {
  const expenseId = req.params.id as string;
  const result = await expensesService.softDeleteExpense(req.tenantId!, expenseId);
  sendSuccess(res, result);
}

export async function listExpensesHandler(req: Request, res: Response) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await expensesService.listExpenses(req.tenantId!, req.query as any);
  sendPaginated(res, result.data, result.pagination);
}
