import prisma from '../lib/prisma.js';
import { parseDate, toDateString } from '../utils/date.js';
import { computeFundSummary, computeCashInHandBottomUp } from '../utils/sql/fund-queries.js';
import type { FundEntryType } from '#generated/prisma/enums.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatFundEntry(e: any) {
  return {
    id: e.id,
    tenantId: e.tenantId,
    entryType: e.entryType,
    amount: Number(e.amount),
    description: e.description,
    entryDate: toDateString(e.entryDate),
    createdById: e.createdById,
    createdAt: e.createdAt.toISOString(),
  };
}

export async function createFundEntry(
  tenantId: string,
  userId: string,
  data: { entry_type: string; amount: number; description?: string; entry_date: string },
) {
  const entry = await prisma.fundEntry.create({
    data: {
      tenantId,
      entryType: data.entry_type as FundEntryType,
      amount: data.amount,
      description: data.description,
      entryDate: parseDate(data.entry_date),
      createdById: userId,
    },
  });
  return formatFundEntry(entry);
}

export async function listFundEntries(
  tenantId: string,
  query: { entry_type?: string; from?: string; to?: string; page: number; limit: number },
) {
  const skip = (query.page - 1) * query.limit;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId };

  if (query.entry_type) {
    where.entryType = query.entry_type;
  }

  if (query.from || query.to) {
    where.entryDate = {};
    if (query.from) where.entryDate.gte = parseDate(query.from);
    if (query.to) where.entryDate.lte = parseDate(query.to);
  }

  const [data, total] = await Promise.all([
    prisma.fundEntry.findMany({
      where,
      orderBy: { entryDate: 'desc' },
      skip,
      take: query.limit,
    }),
    prisma.fundEntry.count({ where }),
  ]);

  return {
    data: data.map(formatFundEntry),
    pagination: { page: query.page, limit: query.limit, total },
  };
}

export async function getFundSummary(tenantId: string) {
  return prisma.$transaction(
    async (tx) => {
      const summary = await computeFundSummary(tx, tenantId);
      return {
        totalCapitalInvested: summary.totalCapitalInvested.toFixed(2),
        moneyDeployed: summary.moneyDeployed.toFixed(2),
        totalInterestEarned: summary.totalInterestEarned.toFixed(2),
        moneyLostToDefaults: summary.moneyLostToDefaults.toFixed(2),
        totalExpenses: summary.totalExpenses.toFixed(2),
        revenueForgone: summary.revenueForgone.toFixed(2),
        netProfit: summary.netProfit.toFixed(2),
        cashInHand: summary.cashInHand.toFixed(2),
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}

export async function getReconciliation(tenantId: string) {
  return prisma.$transaction(
    async (tx) => {
      const summary = await computeFundSummary(tx, tenantId);
      const bottomUp = await computeCashInHandBottomUp(tx, tenantId);

      const queryResult = summary.cashInHand.toFixed(2);
      const bottomUpResult = bottomUp.toFixed(2);

      return {
        queryResult,
        bottomUpResult,
        matches: queryResult === bottomUpResult,
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
