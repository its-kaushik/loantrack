import type { Request, Response } from 'express';
import * as loansService from '../services/loans.service.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';

export async function createLoanHandler(req: Request, res: Response) {
  const loan = req.body.loan_type === 'DAILY'
    ? await loansService.createDailyLoan(req.tenantId!, req.user!.userId, req.body)
    : await loansService.createMonthlyLoan(req.tenantId!, req.user!.userId, req.body);
  sendSuccess(res, loan, 201);
}

export async function listLoansHandler(req: Request, res: Response) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await loansService.listLoans(req.tenantId!, req.query as any, req.user!.role as 'ADMIN' | 'COLLECTOR');
  sendPaginated(res, result.data, result.pagination);
}

export async function getLoanHandler(req: Request, res: Response) {
  const loanId = req.params.id as string;
  const loan = await loansService.getLoan(req.tenantId!, loanId);
  sendSuccess(res, loan);
}

export async function getLoanTransactionsHandler(req: Request, res: Response) {
  const loanId = req.params.id as string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await loansService.getLoanTransactions(req.tenantId!, loanId, req.query as any);
  sendPaginated(res, result.data, result.pagination);
}

export async function getPaymentStatusHandler(req: Request, res: Response) {
  const loanId = req.params.id as string;
  const status = await loansService.getPaymentStatus(req.tenantId!, loanId);
  sendSuccess(res, status);
}

export async function closeLoanHandler(req: Request, res: Response) {
  const loanId = req.params.id as string;
  const loan = await loansService.closeLoan(req.tenantId!, loanId, req.user!.userId);
  sendSuccess(res, loan);
}

export async function defaultLoanHandler(req: Request, res: Response) {
  const loanId = req.params.id as string;
  const loan = await loansService.defaultLoan(req.tenantId!, loanId, req.user!.userId);
  sendSuccess(res, loan);
}

export async function writeOffLoanHandler(req: Request, res: Response) {
  const loanId = req.params.id as string;
  const loan = await loansService.writeOffLoan(req.tenantId!, loanId, req.user!.userId);
  sendSuccess(res, loan);
}

export async function cancelLoanHandler(req: Request, res: Response) {
  const loanId = req.params.id as string;
  const loan = await loansService.cancelLoan(req.tenantId!, loanId, req.user!.userId, req.body.cancellation_reason);
  sendSuccess(res, loan);
}
