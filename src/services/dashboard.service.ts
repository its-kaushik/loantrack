import prisma from '../lib/prisma.js';
import { today } from '../utils/date.js';
import { getTodaySummary as getTodaySummaryQuery, getOverdueLoans as getOverdueLoansQuery, getDefaulters as getDefaultersQuery } from '../utils/sql/dashboard-queries.js';
import { computeFundSummary } from '../utils/sql/fund-queries.js';

export async function getTodaySummary(tenantId: string) {
  return prisma.$transaction(
    async (tx) => {
      return getTodaySummaryQuery(tx, tenantId, today());
    },
    { isolationLevel: 'RepeatableRead' },
  );
}

export async function getOverdueLoans(tenantId: string) {
  return prisma.$transaction(
    async (tx) => {
      return getOverdueLoansQuery(tx, tenantId, today());
    },
    { isolationLevel: 'RepeatableRead' },
  );
}

export async function getDefaulters(tenantId: string) {
  return prisma.$transaction(
    async (tx) => {
      return getDefaultersQuery(tx, tenantId);
    },
    { isolationLevel: 'RepeatableRead' },
  );
}

export async function getDashboardFundSummary(tenantId: string) {
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
