import type { Request, Response } from 'express';
import * as dashboardService from '../services/dashboard.service.js';
import { sendSuccess } from '../utils/response.js';

export async function getTodaySummaryHandler(req: Request, res: Response) {
  const result = await dashboardService.getTodaySummary(req.tenantId!);
  sendSuccess(res, result);
}

export async function getOverdueLoansHandler(req: Request, res: Response) {
  const result = await dashboardService.getOverdueLoans(req.tenantId!);
  sendSuccess(res, result);
}

export async function getDefaultersHandler(req: Request, res: Response) {
  const result = await dashboardService.getDefaulters(req.tenantId!);
  sendSuccess(res, result);
}

export async function getFundSummaryHandler(req: Request, res: Response) {
  const result = await dashboardService.getDashboardFundSummary(req.tenantId!);
  sendSuccess(res, result);
}
