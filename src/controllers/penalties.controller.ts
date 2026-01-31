import type { Request, Response } from 'express';
import * as penaltiesService from '../services/penalties.service.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';

export async function imposePenaltyHandler(req: Request, res: Response) {
  const loanId = req.params.id as string;
  const result = await penaltiesService.imposePenalty(req.tenantId!, loanId, req.user!.userId, req.body);
  sendSuccess(res, result, 201);
}

export async function listPenaltiesHandler(req: Request, res: Response) {
  const loanId = req.params.id as string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await penaltiesService.listPenalties(req.tenantId!, loanId, req.query as any);
  sendPaginated(res, result.data, result.pagination);
}

export async function waivePenaltyHandler(req: Request, res: Response) {
  const penaltyId = req.params.id as string;
  const result = await penaltiesService.waivePenalty(req.tenantId!, penaltyId, req.user!.userId, req.body);
  sendSuccess(res, result);
}

export async function waiveInterestHandler(req: Request, res: Response) {
  const loanId = req.params.id as string;
  const result = await penaltiesService.waiveInterest(req.tenantId!, loanId, req.user!.userId, req.body);
  sendSuccess(res, result, 201);
}

export async function listWaiversHandler(req: Request, res: Response) {
  const loanId = req.params.id as string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await penaltiesService.listWaivers(req.tenantId!, loanId, req.query as any);
  sendPaginated(res, result.data, result.pagination);
}
