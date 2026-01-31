import type { Request, Response } from 'express';
import * as reportsService from '../services/reports.service.js';
import { sendSuccess } from '../utils/response.js';

export async function getProfitLossHandler(req: Request, res: Response) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { from, to } = req.query as any;
  const result = await reportsService.getProfitLoss(req.tenantId!, from, to);
  sendSuccess(res, result);
}

export async function getCollectorSummaryHandler(req: Request, res: Response) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { from, to } = req.query as any;
  const result = await reportsService.getCollectorSummary(req.tenantId!, from, to);
  sendSuccess(res, result);
}

export async function getLoanBookHandler(req: Request, res: Response) {
  const result = await reportsService.getLoanBook(req.tenantId!);
  sendSuccess(res, result);
}
