import prisma from '../lib/prisma.js';
import { AppError } from '../utils/errors.js';
import { parseDate, toDateString } from '../utils/date.js';
import type { ExpenseCategory } from '#generated/prisma/enums.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatExpense(e: any) {
  return {
    id: e.id,
    tenantId: e.tenantId,
    category: e.category,
    amount: Number(e.amount),
    description: e.description,
    expenseDate: toDateString(e.expenseDate),
    isDeleted: e.isDeleted,
    createdById: e.createdById,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

export async function createExpense(
  tenantId: string,
  userId: string,
  data: { category: string; amount: number; description?: string; expense_date: string },
) {
  const expense = await prisma.expense.create({
    data: {
      tenantId,
      category: data.category as ExpenseCategory,
      amount: data.amount,
      description: data.description,
      expenseDate: parseDate(data.expense_date),
      createdById: userId,
    },
  });
  return formatExpense(expense);
}

export async function updateExpense(
  tenantId: string,
  expenseId: string,
  data: { category?: string; amount?: number; description?: string; expense_date?: string },
) {
  const existing = await prisma.expense.findFirst({
    where: { id: expenseId, tenantId },
  });

  if (!existing) {
    throw AppError.notFound('Expense not found');
  }

  if (existing.isDeleted) {
    throw AppError.badRequest('Cannot update a deleted expense');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: any = {};
  if (data.category !== undefined) updateData.category = data.category;
  if (data.amount !== undefined) updateData.amount = data.amount;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.expense_date !== undefined) updateData.expenseDate = parseDate(data.expense_date);

  const expense = await prisma.expense.update({
    where: { id: expenseId },
    data: updateData,
  });
  return formatExpense(expense);
}

export async function softDeleteExpense(tenantId: string, expenseId: string) {
  const existing = await prisma.expense.findFirst({
    where: { id: expenseId, tenantId },
  });

  if (!existing) {
    throw AppError.notFound('Expense not found');
  }

  if (existing.isDeleted) {
    throw AppError.badRequest('Expense is already deleted');
  }

  await prisma.expense.update({
    where: { id: expenseId },
    data: { isDeleted: true },
  });

  return { message: 'Expense deleted' };
}

export async function listExpenses(
  tenantId: string,
  query: { category?: string; from?: string; to?: string; page: number; limit: number },
) {
  const skip = (query.page - 1) * query.limit;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId, isDeleted: false };

  if (query.category) {
    where.category = query.category;
  }

  if (query.from || query.to) {
    where.expenseDate = {};
    if (query.from) where.expenseDate.gte = parseDate(query.from);
    if (query.to) where.expenseDate.lte = parseDate(query.to);
  }

  const [data, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { expenseDate: 'desc' },
      skip,
      take: query.limit,
    }),
    prisma.expense.count({ where }),
  ]);

  return {
    data: data.map(formatExpense),
    pagination: { page: query.page, limit: query.limit, total },
  };
}
