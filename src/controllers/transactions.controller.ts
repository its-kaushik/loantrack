import type { Request, Response } from 'express';
import * as transactionsService from '../services/transactions.service.js';
import prisma from '../lib/prisma.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';

export async function createTransactionHandler(req: Request, res: Response) {
  const transactions = await transactionsService.recordTransaction(
    req.tenantId!,
    req.user!.userId,
    req.user!.role as 'ADMIN' | 'COLLECTOR',
    req.body,
  );
  sendSuccess(res, transactions, 201);
}

export async function bulkCollectionHandler(req: Request, res: Response): Promise<void> {
  const result = await transactionsService.recordBulkCollections(
    req.tenantId!,
    req.user!.userId,
    req.body.collections,
  );

  const responseBody = { success: true as const, data: result };
  const statusCode = 201;

  // Store idempotency key if present
  if (req.idempotencyKey) {
    try {
      await prisma.idempotencyKey.create({
        data: {
          key: req.idempotencyKey,
          tenantId: req.tenantId!,
          userId: req.user!.userId,
          responseStatus: statusCode,
          responseBody: responseBody as object,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
        },
      });
    } catch {
      // Duplicate key race condition — another request already stored it
      // Re-read and return the cached response
      const cached = await prisma.idempotencyKey.findUnique({
        where: { key: req.idempotencyKey },
      });
      if (cached) {
        res.status(cached.responseStatus).json(cached.responseBody);
        return;
      }
    }
  }

  res.status(statusCode).json(responseBody);
}

export async function listPendingHandler(req: Request, res: Response) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await transactionsService.listPendingTransactions(req.tenantId!, req.query as any);
  sendPaginated(res, result.data, result.pagination);
}

export async function approveTransactionHandler(req: Request, res: Response) {
  const transactionId = req.params.id as string;
  const result = await transactionsService.approveTransaction(req.tenantId!, transactionId, req.user!.userId);
  sendSuccess(res, result);
}

export async function rejectTransactionHandler(req: Request, res: Response) {
  const transactionId = req.params.id as string;
  const result = await transactionsService.rejectTransaction(
    req.tenantId!,
    transactionId,
    req.user!.userId,
    req.body.rejection_reason,
  );
  sendSuccess(res, result);
}

export async function listTransactionsHandler(req: Request, res: Response) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await transactionsService.listTransactions(req.tenantId!, req.query as any);
  sendPaginated(res, result.data, result.pagination);
}
