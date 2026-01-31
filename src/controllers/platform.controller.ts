import type { Request, Response } from 'express';
import * as platformService from '../services/platform.service.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';

export async function createTenantHandler(req: Request, res: Response) {
  const result = await platformService.createTenant(req.body);
  sendSuccess(res, result, 201);
}

export async function listTenantsHandler(req: Request, res: Response) {
  const { data, pagination } = await platformService.listTenants(req.query as any);
  sendPaginated(res, data, pagination);
}

export async function getTenantHandler(req: Request, res: Response) {
  const tenantId = req.params.id as string;
  const tenant = await platformService.getTenant(tenantId);
  sendSuccess(res, tenant);
}

export async function suspendTenantHandler(req: Request, res: Response) {
  const tenantId = req.params.id as string;
  const tenant = await platformService.suspendTenant(tenantId);
  sendSuccess(res, tenant);
}

export async function activateTenantHandler(req: Request, res: Response) {
  const tenantId = req.params.id as string;
  const tenant = await platformService.activateTenant(tenantId);
  sendSuccess(res, tenant);
}

export async function getPlatformStatsHandler(_req: Request, res: Response) {
  const stats = await platformService.getPlatformStats();
  sendSuccess(res, stats);
}
