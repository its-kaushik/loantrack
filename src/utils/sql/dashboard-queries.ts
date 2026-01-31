// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TxClient = any;

function toBigInt(val: unknown): number {
  if (val === null || val === undefined) return 0;
  return Number(val);
}

function toDecimalStr(val: unknown): string {
  if (val === null || val === undefined) return '0.00';
  return Number(val).toFixed(2);
}

// ─── Today's Summary ──────────────────────────────────────────────────────

export interface TodaySummaryResult {
  activeDailyLoanCount: number;
  expectedCollections: { count: number; totalAmount: string };
  receivedCollections: { count: number; totalAmount: string };
  missedToday: Array<{ loanId: string; borrowerName: string; dailyPaymentAmount: string }>;
  monthlyInterestDueToday: Array<{ loanId: string; borrowerName: string; interestAmount: string; dueDate: string }>;
  pendingApprovalsCount: number;
  totalCollectedToday: string;
}

export async function getTodaySummary(tx: TxClient, tenantId: string, todayStr: string): Promise<TodaySummaryResult> {
  // 1. Active daily loan count
  const [activeDailyRow]: [{ count: unknown }] = await tx.$queryRaw`
    SELECT COUNT(*) AS count FROM loans
    WHERE tenant_id = ${tenantId}::uuid AND loan_type = 'DAILY' AND status = 'ACTIVE'
  `;
  const activeDailyLoanCount = toBigInt(activeDailyRow.count);

  // 2. Expected collections today (active daily loans within term)
  const [expectedRow]: [{ count: unknown; total_amount: unknown }] = await tx.$queryRaw`
    SELECT COUNT(*) AS count, COALESCE(SUM(daily_payment_amount), 0) AS total_amount
    FROM loans
    WHERE tenant_id = ${tenantId}::uuid
      AND loan_type = 'DAILY'
      AND status = 'ACTIVE'
      AND ${todayStr}::date <= term_end_date
  `;
  const expectedCollections = {
    count: toBigInt(expectedRow.count),
    totalAmount: toDecimalStr(expectedRow.total_amount),
  };

  // 3. Received collections today
  const [receivedRow]: [{ count: unknown; total_amount: unknown }] = await tx.$queryRaw`
    SELECT COUNT(*) AS count, COALESCE(SUM(t.amount), 0) AS total_amount
    FROM transactions t
    WHERE t.tenant_id = ${tenantId}::uuid
      AND t.transaction_type = 'DAILY_COLLECTION'
      AND t.approval_status = 'APPROVED'
      AND t.transaction_date = ${todayStr}::date
  `;
  const receivedCollections = {
    count: toBigInt(receivedRow.count),
    totalAmount: toDecimalStr(receivedRow.total_amount),
  };

  // 4. Missed today (active daily within term with NO approved DAILY_COLLECTION today)
  const missedRows: Array<{ loan_id: string; borrower_name: string; daily_payment_amount: unknown }> = await tx.$queryRaw`
    SELECT l.id AS loan_id, c.full_name AS borrower_name, l.daily_payment_amount
    FROM loans l
    JOIN customers c ON c.id = l.borrower_id
    WHERE l.tenant_id = ${tenantId}::uuid
      AND l.loan_type = 'DAILY'
      AND l.status = 'ACTIVE'
      AND ${todayStr}::date <= l.term_end_date
      AND NOT EXISTS (
        SELECT 1 FROM transactions t
        WHERE t.loan_id = l.id
          AND t.transaction_type = 'DAILY_COLLECTION'
          AND t.approval_status = 'APPROVED'
          AND t.transaction_date = ${todayStr}::date
      )
  `;
  const missedToday = missedRows.map((r) => ({
    loanId: r.loan_id,
    borrowerName: r.borrower_name,
    dailyPaymentAmount: toDecimalStr(r.daily_payment_amount),
  }));

  // 5. Monthly interest due today
  const monthlyDueRows: Array<{
    loan_id: string;
    borrower_name: string;
    interest_amount: unknown;
    due_date: unknown;
  }> = await tx.$queryRaw`
    SELECT l.id AS loan_id, c.full_name AS borrower_name,
      (l.remaining_principal * l.interest_rate / 100) AS interest_amount,
      (DATE_TRUNC('month', ${todayStr}::date) +
        (LEAST(l.monthly_due_day, EXTRACT(DAY FROM DATE_TRUNC('month', ${todayStr}::date) + INTERVAL '1 month' - INTERVAL '1 day'))::int - 1) * INTERVAL '1 day'
      )::date AS due_date
    FROM loans l
    JOIN customers c ON c.id = l.borrower_id
    WHERE l.tenant_id = ${tenantId}::uuid
      AND l.loan_type = 'MONTHLY'
      AND l.status = 'ACTIVE'
      AND LEAST(l.monthly_due_day,
        EXTRACT(DAY FROM DATE_TRUNC('month', ${todayStr}::date) + INTERVAL '1 month' - INTERVAL '1 day'))
        = EXTRACT(DAY FROM ${todayStr}::date)
      AND (l.last_interest_paid_through IS NULL OR l.last_interest_paid_through < DATE_TRUNC('month', ${todayStr}::date))
  `;
  const monthlyInterestDueToday = monthlyDueRows.map((r) => ({
    loanId: r.loan_id,
    borrowerName: r.borrower_name,
    interestAmount: toDecimalStr(r.interest_amount),
    dueDate: String(r.due_date).substring(0, 10),
  }));

  // 6. Pending approvals count
  const [pendingRow]: [{ count: unknown }] = await tx.$queryRaw`
    SELECT COUNT(*) AS count FROM transactions
    WHERE tenant_id = ${tenantId}::uuid AND approval_status = 'PENDING'
  `;
  const pendingApprovalsCount = toBigInt(pendingRow.count);

  // 7. Total collected today (all approved money-in transactions)
  const [totalCollectedRow]: [{ total: unknown }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM transactions
    WHERE tenant_id = ${tenantId}::uuid
      AND transaction_type IN ('ADVANCE_INTEREST', 'INTEREST_PAYMENT', 'PRINCIPAL_RETURN', 'DAILY_COLLECTION', 'PENALTY', 'GUARANTOR_PAYMENT')
      AND approval_status = 'APPROVED'
      AND transaction_date = ${todayStr}::date
  `;
  const totalCollectedToday = toDecimalStr(totalCollectedRow.total);

  return {
    activeDailyLoanCount,
    expectedCollections,
    receivedCollections,
    missedToday,
    monthlyInterestDueToday,
    pendingApprovalsCount,
    totalCollectedToday,
  };
}

// ─── Overdue Loans ────────────────────────────────────────────────────────

export interface OverdueLoansResult {
  overdueDailyLoans: Array<{
    loanId: string;
    loanNumber: string;
    borrowerName: string;
    daysOverdue: number;
    amountRemaining: string;
    guarantorName: string | null;
    penaltyApplicable: string;
  }>;
  overdueMonthlyLoans: Array<{
    loanId: string;
    loanNumber: string;
    borrowerName: string;
    monthsOverdue: number;
    interestDue: string;
    lastPaymentDate: string | null;
  }>;
}

export async function getOverdueLoans(tx: TxClient, tenantId: string, todayStr: string): Promise<OverdueLoansResult> {
  // 1. Overdue daily loans
  const dailyRows: Array<{
    loan_id: string;
    loan_number: string;
    borrower_name: string;
    days_overdue: unknown;
    amount_remaining: unknown;
    guarantor_name: unknown;
    penalty_applicable: unknown;
  }> = await tx.$queryRaw`
    SELECT l.id AS loan_id, l.loan_number, c.full_name AS borrower_name,
      (${todayStr}::date - (l.term_end_date + l.grace_days * INTERVAL '1 day')::date) AS days_overdue,
      GREATEST(l.total_repayment_amount - l.total_collected, 0) AS amount_remaining,
      g.full_name AS guarantor_name,
      COALESCE((SELECT SUM(p.net_payable - p.amount_collected) FROM penalties p WHERE p.loan_id = l.id AND p.status IN ('PENDING', 'PARTIALLY_PAID')), 0) AS penalty_applicable
    FROM loans l
    JOIN customers c ON c.id = l.borrower_id
    LEFT JOIN customers g ON g.id = l.guarantor_id
    WHERE l.tenant_id = ${tenantId}::uuid
      AND l.loan_type = 'DAILY'
      AND l.status = 'ACTIVE'
      AND ${todayStr}::date > (l.term_end_date + l.grace_days * INTERVAL '1 day')::date
      AND l.total_collected < l.total_repayment_amount
  `;
  const overdueDailyLoans = dailyRows.map((r) => ({
    loanId: r.loan_id,
    loanNumber: r.loan_number,
    borrowerName: r.borrower_name,
    daysOverdue: toBigInt(r.days_overdue),
    amountRemaining: toDecimalStr(r.amount_remaining),
    guarantorName: r.guarantor_name ? String(r.guarantor_name) : null,
    penaltyApplicable: toDecimalStr(r.penalty_applicable),
  }));

  // 2. Overdue monthly loans (with unsettled past-due cycles)
  const monthlyRows: Array<{
    loan_id: string;
    loan_number: string;
    borrower_name: string;
    months_overdue: unknown;
    interest_due: unknown;
    last_payment_date: unknown;
  }> = await tx.$queryRaw`
    SELECT l.id AS loan_id, l.loan_number, c.full_name AS borrower_name,
      (EXTRACT(YEAR FROM ${todayStr}::date) * 12 + EXTRACT(MONTH FROM ${todayStr}::date))
      - (EXTRACT(YEAR FROM COALESCE(l.last_interest_paid_through, l.disbursement_date)) * 12
         + EXTRACT(MONTH FROM COALESCE(l.last_interest_paid_through, l.disbursement_date)))
      AS months_overdue,
      (l.remaining_principal * l.interest_rate / 100) AS interest_due,
      l.last_interest_paid_through AS last_payment_date
    FROM loans l
    JOIN customers c ON c.id = l.borrower_id
    WHERE l.tenant_id = ${tenantId}::uuid
      AND l.loan_type = 'MONTHLY'
      AND l.status = 'ACTIVE'
      AND (
        (l.last_interest_paid_through IS NULL AND
          (EXTRACT(YEAR FROM ${todayStr}::date) * 12 + EXTRACT(MONTH FROM ${todayStr}::date))
          > (EXTRACT(YEAR FROM l.disbursement_date) * 12 + EXTRACT(MONTH FROM l.disbursement_date) + 1)
        )
        OR
        (l.last_interest_paid_through IS NOT NULL AND
          (EXTRACT(YEAR FROM ${todayStr}::date) * 12 + EXTRACT(MONTH FROM ${todayStr}::date))
          > (EXTRACT(YEAR FROM l.last_interest_paid_through) * 12 + EXTRACT(MONTH FROM l.last_interest_paid_through) + 1)
        )
      )
  `;
  const overdueMonthlyLoans = monthlyRows.map((r) => ({
    loanId: r.loan_id,
    loanNumber: r.loan_number,
    borrowerName: r.borrower_name,
    monthsOverdue: toBigInt(r.months_overdue),
    interestDue: toDecimalStr(r.interest_due),
    lastPaymentDate: r.last_payment_date ? String(r.last_payment_date).substring(0, 10) : null,
  }));

  return { overdueDailyLoans, overdueMonthlyLoans };
}

// ─── Defaulters ──────────────────────────────────────────────────────────

export interface DefaultersResult {
  defaulters: Array<{
    loanId: string;
    loanNumber: string;
    status: string;
    borrowerName: string;
    borrowerPhone: string;
    guarantorName: string | null;
    guarantorPhone: string | null;
    outstandingAmount: string;
    defaultedAt: string | null;
    writtenOffAt: string | null;
  }>;
}

export async function getDefaulters(tx: TxClient, tenantId: string): Promise<DefaultersResult> {
  const rows: Array<{
    loan_id: string;
    loan_number: string;
    status: string;
    borrower_name: string;
    borrower_phone: string;
    guarantor_name: unknown;
    guarantor_phone: unknown;
    outstanding_amount: unknown;
    defaulted_at: unknown;
    written_off_at: unknown;
  }> = await tx.$queryRaw`
    SELECT l.id AS loan_id, l.loan_number, l.status::text,
      c.full_name AS borrower_name, c.phone AS borrower_phone,
      g.full_name AS guarantor_name, g.phone AS guarantor_phone,
      CASE
        WHEN l.loan_type = 'MONTHLY' THEN l.remaining_principal
        ELSE GREATEST(l.principal_amount - l.total_collected, 0)
      END AS outstanding_amount,
      l.defaulted_at, l.written_off_at
    FROM loans l
    JOIN customers c ON c.id = l.borrower_id
    LEFT JOIN customers g ON g.id = l.guarantor_id
    WHERE l.tenant_id = ${tenantId}::uuid
      AND l.status IN ('DEFAULTED', 'WRITTEN_OFF')
    ORDER BY l.defaulted_at DESC
  `;

  return {
    defaulters: rows.map((r) => ({
      loanId: r.loan_id,
      loanNumber: r.loan_number,
      status: r.status,
      borrowerName: r.borrower_name,
      borrowerPhone: r.borrower_phone,
      guarantorName: r.guarantor_name ? String(r.guarantor_name) : null,
      guarantorPhone: r.guarantor_phone ? String(r.guarantor_phone) : null,
      outstandingAmount: toDecimalStr(r.outstanding_amount),
      defaultedAt: r.defaulted_at ? new Date(String(r.defaulted_at)).toISOString() : null,
      writtenOffAt: r.written_off_at ? new Date(String(r.written_off_at)).toISOString() : null,
    })),
  };
}
