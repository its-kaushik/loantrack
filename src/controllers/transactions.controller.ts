import type { Request, Response } from 'express';
import * as transactionsService from '../services/transactions.service.js';
import { sendSuccess } from '../utils/response.js';

export async function createTransactionHandler(req: Request, res: Response) {
  const transactions = await transactionsService.recordTransaction(req.tenantId!, req.user!.userId, req.body);
  sendSuccess(res, transactions, 201);
}
