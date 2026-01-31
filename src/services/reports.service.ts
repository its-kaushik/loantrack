import prisma from '../lib/prisma.js';
import { computeProfitLoss } from '../utils/sql/fund-queries.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxClient = any;

function toDecimalStr(val: unknown): string {
  if (val === null || val === undefined) return '0.00';
  return Number(val).toFixed(2);
}

function toBigInt(val: unknown): number {
  if (val === null || val === undefined) return 0;
  return Number(val);
}

export async function getProfitLoss(tenantId: string, from: string, to: string) {
  return prisma.$transaction(
    async (tx) => {
      const summary = await computeProfitLoss(tx, tenantId, from, to);
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

export async function getCollectorSummary(tenantId: string, from: string, to: string) {
  return prisma.$transaction(
    async (tx: TxClient) => {
      const rows: Array<{
        user_id: string;
        name: string;
        total_transactions: unknown;
        total_amount: unknown;
        loans_serviced: unknown;
        approved: unknown;
        pending: unknown;
        rejected: unknown;
      }> = await tx.$queryRaw`
        SELECT
          u.id AS user_id,
          u.name,
          COUNT(t.id) AS total_transactions,
          COALESCE(SUM(t.amount), 0) AS total_amount,
          COUNT(DISTINCT t.loan_id) AS loans_serviced,
          COUNT(*) FILTER (WHERE t.approval_status = 'APPROVED') AS approved,
          COUNT(*) FILTER (WHERE t.approval_status = 'PENDING') AS pending,
          COUNT(*) FILTER (WHERE t.approval_status = 'REJECTED') AS rejected
        FROM users u
        LEFT JOIN transactions t ON t.collected_by = u.id
          AND t.tenant_id = ${tenantId}::uuid
          AND t.transaction_date BETWEEN ${from}::date AND ${to}::date
          AND t.transaction_type NOT IN ('DISBURSEMENT', 'OPENING_BALANCE', 'INTEREST_WAIVER', 'PENALTY_WAIVER')
        WHERE u.tenant_id = ${tenantId}::uuid
          AND u.role = 'COLLECTOR'
          AND u.is_active = true
        GROUP BY u.id, u.name
        ORDER BY total_amount DESC
      `;

      return rows.map((r) => ({
        userId: r.user_id,
        name: r.name,
        totalTransactions: toBigInt(r.total_transactions),
        totalAmount: toDecimalStr(r.total_amount),
        loansServiced: toBigInt(r.loans_serviced),
        approved: toBigInt(r.approved),
        pending: toBigInt(r.pending),
        rejected: toBigInt(r.rejected),
      }));
    },
    { isolationLevel: 'RepeatableRead' },
  );
}

export async function getLoanBook(tenantId: string) {
  return prisma.$transaction(
    async (tx: TxClient) => {
      const rows: Array<{
        loan_id: string;
        loan_number: string;
        loan_type: string;
        status: string;
        borrower_name: string;
        principal_amount: unknown;
        disbursement_date: unknown;
        outstanding_amount: unknown;
        interest_earned: unknown;
        guarantor_name: unknown;
      }> = await tx.$queryRaw`
        SELECT
          l.id AS loan_id,
          l.loan_number,
          l.loan_type::text,
          l.status::text,
          c.full_name AS borrower_name,
          l.principal_amount,
          l.disbursement_date,
          CASE
            WHEN l.loan_type = 'MONTHLY' THEN l.remaining_principal
            ELSE GREATEST(l.total_repayment_amount - l.total_collected, 0)
          END AS outstanding_amount,
          CASE
            WHEN l.loan_type = 'MONTHLY' THEN COALESCE(
              (SELECT SUM(t.amount) FROM transactions t
                WHERE t.loan_id = l.id
                AND t.transaction_type IN ('INTEREST_PAYMENT', 'ADVANCE_INTEREST')
                AND t.approval_status = 'APPROVED'), 0)
            ELSE GREATEST(l.total_collected - l.principal_amount, 0)
          END AS interest_earned,
          g.full_name AS guarantor_name
        FROM loans l
        JOIN customers c ON c.id = l.borrower_id
        LEFT JOIN customers g ON g.id = l.guarantor_id
        WHERE l.tenant_id = ${tenantId}::uuid
          AND l.status != 'CANCELLED'
        ORDER BY l.disbursement_date DESC
      `;

      return rows.map((r) => ({
        loanId: r.loan_id,
        loanNumber: r.loan_number,
        loanType: r.loan_type,
        status: r.status,
        borrowerName: r.borrower_name,
        principalAmount: toDecimalStr(r.principal_amount),
        disbursementDate: String(r.disbursement_date).substring(0, 10),
        outstandingAmount: toDecimalStr(r.outstanding_amount),
        interestEarned: toDecimalStr(r.interest_earned),
        guarantorName: r.guarantor_name ? String(r.guarantor_name) : null,
      }));
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
