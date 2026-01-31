import { Decimal } from 'decimal.js';

export interface FundSummaryResult {
  totalCapitalInvested: Decimal;
  moneyDeployed: Decimal;
  totalInterestEarned: Decimal;
  moneyLostToDefaults: Decimal;
  totalExpenses: Decimal;
  revenueForgone: Decimal;
  netProfit: Decimal;
  cashInHand: Decimal;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxClient = any;

function toDecimal(val: unknown): Decimal {
  if (val === null || val === undefined) return new Decimal(0);
  return new Decimal(String(val));
}

// ─── computeFundSummary ──────────────────────────────────────────────────────

export async function computeFundSummary(tx: TxClient, tenantId: string): Promise<FundSummaryResult> {
  // 1. Total Capital Invested
  const [capRow]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(CASE WHEN entry_type = 'INJECTION' THEN amount ELSE -amount END), 0) AS total
    FROM fund_entries
    WHERE tenant_id = ${tenantId}::uuid
  `;
  const totalCapitalInvested = toDecimal(capRow.total);

  // 2. Money Deployed
  const [monthlyDeployed]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(remaining_principal), 0) AS total
    FROM loans
    WHERE tenant_id = ${tenantId}::uuid
      AND loan_type = 'MONTHLY'
      AND status = 'ACTIVE'
  `;
  const [dailyDeployed]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(GREATEST(principal_amount - total_collected, 0)), 0) AS total
    FROM loans
    WHERE tenant_id = ${tenantId}::uuid
      AND loan_type = 'DAILY'
      AND status = 'ACTIVE'
  `;
  const moneyDeployed = toDecimal(monthlyDeployed.total).plus(toDecimal(dailyDeployed.total));

  // 3. Total Interest Earned
  // Monthly: SUM of INTEREST_PAYMENT + ADVANCE_INTEREST approved transactions on non-cancelled loans
  const [monthlyInterest]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(t.amount), 0) AS total
    FROM transactions t
    JOIN loans l ON l.id = t.loan_id
    WHERE t.tenant_id = ${tenantId}::uuid
      AND t.transaction_type IN ('INTEREST_PAYMENT', 'ADVANCE_INTEREST')
      AND t.approval_status = 'APPROVED'
      AND l.status != 'CANCELLED'
  `;
  // Daily: SUM(GREATEST(total_collected - principal_amount, 0)) per non-cancelled daily loan
  const [dailyInterest]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(GREATEST(total_collected - principal_amount, 0)), 0) AS total
    FROM loans
    WHERE tenant_id = ${tenantId}::uuid
      AND loan_type = 'DAILY'
      AND status != 'CANCELLED'
  `;
  // Penalties collected
  const [penaltiesCollected]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(t.amount), 0) AS total
    FROM transactions t
    JOIN loans l ON l.id = t.loan_id
    WHERE t.tenant_id = ${tenantId}::uuid
      AND t.transaction_type = 'PENALTY'
      AND t.approval_status = 'APPROVED'
      AND l.status != 'CANCELLED'
  `;
  const totalInterestEarned = toDecimal(monthlyInterest.total)
    .plus(toDecimal(dailyInterest.total))
    .plus(toDecimal(penaltiesCollected.total));

  // 4. Money Lost to Defaults
  const [monthlyDefaults]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(remaining_principal), 0) AS total
    FROM loans
    WHERE tenant_id = ${tenantId}::uuid
      AND loan_type = 'MONTHLY'
      AND status IN ('DEFAULTED', 'WRITTEN_OFF')
  `;
  const [dailyDefaults]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(GREATEST(principal_amount - total_collected, 0)), 0) AS total
    FROM loans
    WHERE tenant_id = ${tenantId}::uuid
      AND loan_type = 'DAILY'
      AND status IN ('DEFAULTED', 'WRITTEN_OFF')
  `;
  const [guarantorRecoveries]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(t.amount), 0) AS total
    FROM transactions t
    JOIN loans l ON l.id = t.loan_id
    WHERE t.tenant_id = ${tenantId}::uuid
      AND t.transaction_type = 'GUARANTOR_PAYMENT'
      AND t.approval_status = 'APPROVED'
      AND l.status IN ('DEFAULTED', 'WRITTEN_OFF')
  `;
  const moneyLostToDefaults = toDecimal(monthlyDefaults.total)
    .plus(toDecimal(dailyDefaults.total))
    .minus(toDecimal(guarantorRecoveries.total));

  // 5. Total Expenses
  const [expRow]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM expenses
    WHERE tenant_id = ${tenantId}::uuid
      AND is_deleted = false
  `;
  const totalExpenses = toDecimal(expRow.total);

  // 6. Revenue Forgone
  const [interestWaivers]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(t.amount), 0) AS total
    FROM transactions t
    JOIN loans l ON l.id = t.loan_id
    WHERE t.tenant_id = ${tenantId}::uuid
      AND t.transaction_type = 'INTEREST_WAIVER'
      AND t.approval_status = 'APPROVED'
      AND l.status != 'CANCELLED'
  `;
  const [penaltyWaivers]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(waived_amount), 0) AS total
    FROM penalties p
    JOIN loans l ON l.id = p.loan_id
    WHERE p.tenant_id = ${tenantId}::uuid
      AND l.status != 'CANCELLED'
  `;
  const revenueForgone = toDecimal(interestWaivers.total).plus(toDecimal(penaltyWaivers.total));

  // 7. Net Profit
  const netProfit = totalInterestEarned.minus(moneyLostToDefaults).minus(totalExpenses);

  // 8. Cash in Hand
  const cashInHand = await computeCashInHand(tx, tenantId);

  return {
    totalCapitalInvested,
    moneyDeployed,
    totalInterestEarned,
    moneyLostToDefaults,
    totalExpenses,
    revenueForgone,
    netProfit,
    cashInHand,
  };
}

// ─── computeCashInHand (top-down: capital - disbursements + collections - expenses) ─

async function computeCashInHand(tx: TxClient, tenantId: string): Promise<Decimal> {
  // Capital invested
  const [capRow]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(CASE WHEN entry_type = 'INJECTION' THEN amount ELSE -amount END), 0) AS total
    FROM fund_entries
    WHERE tenant_id = ${tenantId}::uuid
  `;

  // Disbursements (approved, on non-cancelled loans)
  const [disbRow]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(t.amount), 0) AS total
    FROM transactions t
    JOIN loans l ON l.id = t.loan_id
    WHERE t.tenant_id = ${tenantId}::uuid
      AND t.transaction_type = 'DISBURSEMENT'
      AND t.approval_status = 'APPROVED'
      AND l.status != 'CANCELLED'
  `;

  // Collections (money-in: all approved, non-OPENING_BALANCE, non-waiver, on non-cancelled loans)
  const [collRow]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(t.amount), 0) AS total
    FROM transactions t
    JOIN loans l ON l.id = t.loan_id
    WHERE t.tenant_id = ${tenantId}::uuid
      AND t.transaction_type IN ('ADVANCE_INTEREST', 'INTEREST_PAYMENT', 'PRINCIPAL_RETURN', 'DAILY_COLLECTION', 'PENALTY', 'GUARANTOR_PAYMENT')
      AND t.approval_status = 'APPROVED'
      AND l.status != 'CANCELLED'
  `;

  // Expenses
  const [expRow]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM expenses
    WHERE tenant_id = ${tenantId}::uuid
      AND is_deleted = false
  `;

  return toDecimal(capRow.total)
    .minus(toDecimal(disbRow.total))
    .plus(toDecimal(collRow.total))
    .minus(toDecimal(expRow.total));
}

// ─── computeCashInHandBottomUp ──────────────────────────────────────────────

export async function computeCashInHandBottomUp(tx: TxClient, tenantId: string): Promise<Decimal> {
  // 1. Fund entries (injections - withdrawals)
  const [fundRow]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(CASE WHEN entry_type = 'INJECTION' THEN amount ELSE -amount END), 0) AS total
    FROM fund_entries
    WHERE tenant_id = ${tenantId}::uuid
  `;

  // 2. Disbursements (approved, non-cancelled loans)
  const [disbRow]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(t.amount), 0) AS total
    FROM transactions t
    JOIN loans l ON l.id = t.loan_id
    WHERE t.tenant_id = ${tenantId}::uuid
      AND t.transaction_type = 'DISBURSEMENT'
      AND t.approval_status = 'APPROVED'
      AND l.status != 'CANCELLED'
  `;

  // 3. Money-in transactions (6 types, approved, non-cancelled loans, excludes OPENING_BALANCE)
  const [moneyInRow]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(t.amount), 0) AS total
    FROM transactions t
    JOIN loans l ON l.id = t.loan_id
    WHERE t.tenant_id = ${tenantId}::uuid
      AND t.transaction_type IN ('ADVANCE_INTEREST', 'INTEREST_PAYMENT', 'PRINCIPAL_RETURN', 'DAILY_COLLECTION', 'PENALTY', 'GUARANTOR_PAYMENT')
      AND t.approval_status = 'APPROVED'
      AND l.status != 'CANCELLED'
  `;

  // 4. Expenses (non-deleted)
  const [expRow]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM expenses
    WHERE tenant_id = ${tenantId}::uuid
      AND is_deleted = false
  `;

  return toDecimal(fundRow.total)
    .minus(toDecimal(disbRow.total))
    .plus(toDecimal(moneyInRow.total))
    .minus(toDecimal(expRow.total));
}

// ─── computeProfitLoss (date-range filtered) ──────────────────────────────────

export async function computeProfitLoss(
  tx: TxClient,
  tenantId: string,
  fromDate: string,
  toDate: string,
): Promise<FundSummaryResult> {
  // 1. Total Capital Invested (cumulative through end of range)
  const [capRow]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(CASE WHEN entry_type = 'INJECTION' THEN amount ELSE -amount END), 0) AS total
    FROM fund_entries
    WHERE tenant_id = ${tenantId}::uuid
      AND entry_date <= ${toDate}::date
  `;
  const totalCapitalInvested = toDecimal(capRow.total);

  // 2. Money Deployed (current snapshot, no date filter)
  const [monthlyDeployed]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(remaining_principal), 0) AS total
    FROM loans
    WHERE tenant_id = ${tenantId}::uuid
      AND loan_type = 'MONTHLY'
      AND status = 'ACTIVE'
  `;
  const [dailyDeployed]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(GREATEST(principal_amount - total_collected, 0)), 0) AS total
    FROM loans
    WHERE tenant_id = ${tenantId}::uuid
      AND loan_type = 'DAILY'
      AND status = 'ACTIVE'
  `;
  const moneyDeployed = toDecimal(monthlyDeployed.total).plus(toDecimal(dailyDeployed.total));

  // 3. Total Interest Earned (date-filtered)
  // Monthly interest payments within date range
  const [monthlyInterest]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(t.amount), 0) AS total
    FROM transactions t
    JOIN loans l ON l.id = t.loan_id
    WHERE t.tenant_id = ${tenantId}::uuid
      AND t.transaction_type IN ('INTEREST_PAYMENT', 'ADVANCE_INTEREST')
      AND t.approval_status = 'APPROVED'
      AND l.status != 'CANCELLED'
      AND t.transaction_date BETWEEN ${fromDate}::date AND ${toDate}::date
  `;

  // Daily interest: marginal approach per loan
  // For each daily loan: MAX(collected_through_toDate - principal, 0) - MAX(collected_before_fromDate - principal, 0)
  const dailyInterestRows: Array<{ interest: unknown }> = await tx.$queryRaw`
    SELECT
      GREATEST(
        LEAST(l.total_collected,
          COALESCE((SELECT SUM(t.amount) FROM transactions t
            WHERE t.loan_id = l.id AND t.approval_status = 'APPROVED'
            AND t.transaction_type = 'DAILY_COLLECTION'
            AND t.transaction_date <= ${toDate}::date), 0)
        ) - l.principal_amount,
        0
      )
      -
      GREATEST(
        LEAST(l.total_collected,
          COALESCE((SELECT SUM(t.amount) FROM transactions t
            WHERE t.loan_id = l.id AND t.approval_status = 'APPROVED'
            AND t.transaction_type = 'DAILY_COLLECTION'
            AND t.transaction_date < ${fromDate}::date), 0)
        ) - l.principal_amount,
        0
      ) AS interest
    FROM loans l
    WHERE l.tenant_id = ${tenantId}::uuid
      AND l.loan_type = 'DAILY'
      AND l.status != 'CANCELLED'
  `;
  let dailyInterestTotal = new Decimal(0);
  for (const row of dailyInterestRows) {
    dailyInterestTotal = dailyInterestTotal.plus(toDecimal(row.interest));
  }

  // Penalties within date range
  const [penaltiesInRange]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(t.amount), 0) AS total
    FROM transactions t
    JOIN loans l ON l.id = t.loan_id
    WHERE t.tenant_id = ${tenantId}::uuid
      AND t.transaction_type = 'PENALTY'
      AND t.approval_status = 'APPROVED'
      AND l.status != 'CANCELLED'
      AND t.transaction_date BETWEEN ${fromDate}::date AND ${toDate}::date
  `;
  const totalInterestEarned = toDecimal(monthlyInterest.total)
    .plus(dailyInterestTotal)
    .plus(toDecimal(penaltiesInRange.total));

  // 4. Money Lost to Defaults (loans defaulted within range)
  const [monthlyDefaultsInRange]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(remaining_principal), 0) AS total
    FROM loans
    WHERE tenant_id = ${tenantId}::uuid
      AND loan_type = 'MONTHLY'
      AND status IN ('DEFAULTED', 'WRITTEN_OFF')
      AND defaulted_at BETWEEN ${fromDate}::date AND ${toDate}::date
  `;
  const [dailyDefaultsInRange]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(GREATEST(principal_amount - total_collected, 0)), 0) AS total
    FROM loans
    WHERE tenant_id = ${tenantId}::uuid
      AND loan_type = 'DAILY'
      AND status IN ('DEFAULTED', 'WRITTEN_OFF')
      AND defaulted_at BETWEEN ${fromDate}::date AND ${toDate}::date
  `;
  const [guarantorRecoveriesInRange]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(t.amount), 0) AS total
    FROM transactions t
    JOIN loans l ON l.id = t.loan_id
    WHERE t.tenant_id = ${tenantId}::uuid
      AND t.transaction_type = 'GUARANTOR_PAYMENT'
      AND t.approval_status = 'APPROVED'
      AND l.status IN ('DEFAULTED', 'WRITTEN_OFF')
      AND l.defaulted_at BETWEEN ${fromDate}::date AND ${toDate}::date
  `;
  const moneyLostToDefaults = toDecimal(monthlyDefaultsInRange.total)
    .plus(toDecimal(dailyDefaultsInRange.total))
    .minus(toDecimal(guarantorRecoveriesInRange.total));

  // 5. Total Expenses (date-filtered)
  const [expRow]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM expenses
    WHERE tenant_id = ${tenantId}::uuid
      AND is_deleted = false
      AND expense_date BETWEEN ${fromDate}::date AND ${toDate}::date
  `;
  const totalExpenses = toDecimal(expRow.total);

  // 6. Revenue Forgone (date-filtered)
  const [interestWaivers]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(t.amount), 0) AS total
    FROM transactions t
    JOIN loans l ON l.id = t.loan_id
    WHERE t.tenant_id = ${tenantId}::uuid
      AND t.transaction_type = 'INTEREST_WAIVER'
      AND t.approval_status = 'APPROVED'
      AND l.status != 'CANCELLED'
      AND t.transaction_date BETWEEN ${fromDate}::date AND ${toDate}::date
  `;
  const [penaltyWaivers]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(p.waived_amount), 0) AS total
    FROM penalties p
    JOIN loans l ON l.id = p.loan_id
    WHERE p.tenant_id = ${tenantId}::uuid
      AND l.status != 'CANCELLED'
      AND p.created_at BETWEEN ${fromDate}::date AND (${toDate}::date + INTERVAL '1 day')
  `;
  const revenueForgone = toDecimal(interestWaivers.total).plus(toDecimal(penaltyWaivers.total));

  // 7. Net Profit
  const netProfit = totalInterestEarned.minus(moneyLostToDefaults).minus(totalExpenses);

  // 8. Cash in Hand (current snapshot)
  const cashInHand = await computeCashInHandBottomUp(tx, tenantId);

  return {
    totalCapitalInvested,
    moneyDeployed,
    totalInterestEarned,
    moneyLostToDefaults,
    totalExpenses,
    revenueForgone,
    netProfit,
    cashInHand,
  };
}
