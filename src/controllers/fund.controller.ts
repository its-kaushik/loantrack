import type { Request, Response } from 'express';
import * as fundService from '../services/fund.service.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';

export async function createFundEntryHandler(req: Request, res: Response) {
  const result = await fundService.createFundEntry(req.tenantId!, req.user!.userId, req.body);
  sendSuccess(res, result, 201);
}

export async function listFundEntriesHandler(req: Request, res: Response) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await fundService.listFundEntries(req.tenantId!, req.query as any);
  sendPaginated(res, result.data, result.pagination);
}

export async function getFundSummaryHandler(req: Request, res: Response) {
  const result = await fundService.getFundSummary(req.tenantId!);
  sendSuccess(res, result);
}

export async function getReconciliationHandler(req: Request, res: Response) {
  const result = await fundService.getReconciliation(req.tenantId!);
  sendSuccess(res, result);
}
