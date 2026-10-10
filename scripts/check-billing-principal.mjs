// Read-only audit for the monthly billing-principal change (October 2026).
//
// The principal a month's interest is charged on used to be taken from "the last
// principal return before that month". It is now worked out as the current
// principal plus everything returned since the month began. The two agree unless
// a principal return was reversed or entered with an earlier date than a return
// already on the loan. This lists every loan-month where they differ, so the
// effect on existing loans is known before the new code is deployed.
//
// It opens a READ ONLY transaction: the database itself refuses any write.
//
//   DATABASE_URL="<connection string>" node scripts/check-billing-principal.mjs

import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL to the database to check.');
  process.exit(1);
}

// Encrypt the connection whenever the database is not on this machine. A server
// that cannot do TLS says so before any data is exchanged; only then fall back.
async function connect() {
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  if (!isLocal) {
    const secure = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    try {
      await secure.connect();
      return { client: secure, encrypted: true };
    } catch (error) {
      if (!/does not support SSL/i.test(String(error?.message))) throw error;
    }
  }
  const plain = new pg.Client({ connectionString: url });
  await plain.connect();
  return { client: plain, encrypted: false };
}

const { client: db, encrypted } = await connect();

const money = (n) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;

try {
  await db.query('BEGIN TRANSACTION READ ONLY');

  const { rows: loans } = await db.query(`
    SELECT l.id, t.slug AS tenant, l.loan_number, l.status::text AS status, l.is_migrated,
           l.principal_amount::float8 AS principal_amount,
           l.interest_rate::float8 AS interest_rate,
           l.remaining_principal::float8 AS remaining_principal,
           l.billing_principal::float8 AS billing_principal,
           to_char(l.disbursement_date, 'YYYY-MM') AS disbursed,
           to_char(l.last_interest_paid_through, 'YYYY-MM') AS paid_through,
           to_char(l.closure_date, 'YYYY-MM') AS closed,
           to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM') AS this_month
    FROM loans l JOIN tenants t ON t.id = l.tenant_id
    WHERE l.loan_type = 'MONTHLY' AND l.status <> 'CANCELLED'
    ORDER BY t.slug, l.loan_number`);

  const { rows: returns } = await db.query(`
    SELECT pr.loan_id, pr.amount_returned::float8 AS amount, pr.remaining_principal_after::float8 AS after,
           to_char(pr.return_date, 'YYYY-MM-DD') AS return_date
    FROM principal_returns pr JOIN loans l ON l.id = pr.loan_id
    WHERE l.loan_type = 'MONTHLY'
    ORDER BY pr.return_date, pr.created_at`);

  const returnsByLoan = new Map();
  for (const r of returns) {
    if (!returnsByLoan.has(r.loan_id)) returnsByLoan.set(r.loan_id, []);
    returnsByLoan.get(r.loan_id).push(r);
  }

  let cyclesChecked = 0;
  const differences = [];
  const reversedLoans = [];

  for (const loan of loans) {
    const rows = returnsByLoan.get(loan.id) ?? [];
    if (rows.some((r) => r.amount < 0)) reversedLoans.push(loan);

    // Cycles run from the month after disbursement (after the last pre-migration
    // month for migrated loans) through this month, or the month the loan closed.
    let [y, m] = loan.disbursed.split('-').map(Number);
    m += 1;
    if (loan.is_migrated && loan.paid_through && loan.paid_through >= ym(y, m > 12 ? 1 : m)) {
      [y, m] = loan.paid_through.split('-').map(Number);
      m += 1;
    }
    if (m > 12) {
      m = 1;
      y += 1;
    }
    const end = loan.closed ?? loan.this_month;

    for (; ym(y, m) <= end; m === 12 ? ((m = 1), (y += 1)) : (m += 1)) {
      cyclesChecked += 1;
      const cycleStart = `${ym(y, m)}-01`;
      const before = rows.filter((r) => r.return_date < cycleStart);

      // Old rule. Rows sharing the deciding date could be picked in either order,
      // so every row on that date is a result the old code might have given.
      let oldCandidates;
      if (before.length > 0) {
        const lastDate = before[before.length - 1].return_date;
        oldCandidates = before.filter((r) => r.return_date === lastDate).map((r) => r.after);
      } else if (rows.length > 0) {
        const firstDate = rows[0].return_date;
        oldCandidates = rows
          .filter((r) => r.return_date === firstDate)
          .map((r) => r.after + r.amount);
      } else {
        oldCandidates = [
          loan.is_migrated && loan.billing_principal != null
            ? loan.billing_principal
            : loan.principal_amount,
        ];
      }

      // New rule
      const returnedSince = rows
        .filter((r) => r.return_date >= cycleStart)
        .reduce((s, r) => s + r.amount, 0);
      const now = Math.round((loan.remaining_principal + returnedSince) * 100) / 100;

      const old = [...new Set(oldCandidates.map((v) => Math.round(v * 100) / 100))];
      if (old.length !== 1 || old[0] !== now) {
        differences.push({
          tenant: loan.tenant,
          loan: loan.loan_number,
          status: loan.status,
          month: ym(y, m),
          'billed on (old)': old.map(money).join(' or '),
          'billed on (new)': money(now),
          'interest (old)': old.map((v) => money((v * loan.interest_rate) / 100)).join(' or '),
          'interest (new)': money((now * loan.interest_rate) / 100),
        });
      }
    }
  }

  console.log(
    `Database: ${url.replace(/^.*@/, '').replace(/\?.*$/, '')}  (${encrypted ? 'encrypted connection' : 'unencrypted connection'}, read-only)`,
  );
  console.log(`Monthly loans checked: ${loans.length}   loan-months checked: ${cyclesChecked}`);
  console.log(
    `Loans with a reversed principal return: ${reversedLoans.length}` +
      (reversedLoans.length
        ? `  (${reversedLoans.map((l) => `${l.tenant}/${l.loan_number}`).join(', ')})`
        : ''),
  );
  console.log('');

  if (differences.length === 0) {
    console.log(
      'RESULT: no loan-month changes. The new calculation gives the same figures as the old one for every existing loan.',
    );
  } else {
    console.log(`RESULT: ${differences.length} loan-month(s) would be billed differently:`);
    console.table(differences);
  }
} finally {
  await db.query('ROLLBACK').catch(() => {});
  await db.end();
}
