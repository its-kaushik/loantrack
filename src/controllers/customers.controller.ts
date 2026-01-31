import type { Request, Response } from 'express';
import * as customersService from '../services/customers.service.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';

export async function listCustomersHandler(req: Request, res: Response) {
  const result = await customersService.listCustomers(req.tenantId!, req.query as any);
  sendPaginated(res, result.data, result.pagination);
}

export async function getCustomerHandler(req: Request, res: Response) {
  const customerId = req.params.id as string;
  const customer = await customersService.getCustomer(req.tenantId!, customerId);
  sendSuccess(res, customer);
}

export async function createCustomerHandler(req: Request, res: Response) {
  const customer = await customersService.createCustomer(req.tenantId!, req.user!.userId, req.body);
  sendSuccess(res, customer, 201);
}

export async function updateCustomerHandler(req: Request, res: Response) {
  const customerId = req.params.id as string;
  const customer = await customersService.updateCustomer(req.tenantId!, customerId, req.body);
  sendSuccess(res, customer);
}

export async function getCustomerLoansHandler(req: Request, res: Response) {
  const customerId = req.params.id as string;
  const loans = await customersService.getCustomerLoans(req.tenantId!, customerId);
  sendSuccess(res, loans);
}

export async function clearDefaulterHandler(req: Request, res: Response) {
  const customerId = req.params.id as string;
  const customer = await customersService.clearDefaulter(req.tenantId!, customerId);
  sendSuccess(res, customer);
}
