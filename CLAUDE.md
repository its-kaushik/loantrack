# LoanTrack API

Multi-tenant SaaS backend for small Indian money-lending businesses. Each tenant (a lending business) has ADMINs and COLLECTORs who manage customers, give out **monthly** (interest-only) and **daily** (fixed-term, daily instalment) loans, record collections, and track funds and profit.

The frontend is a separate repo, expected as a sibling checkout at `../loantrack-ui` (Next.js PWA). See [Frontend](#frontend-loantrack-ui) below.

## IMPORTANT: this is production financial software

**LoanTrack is live and tracks real money for real lending businesses.** A wrong number, a lost transaction or a broken endpoint is a financial error for a real person, and it may not be noticed until the books fail to reconcile. Be very careful with every change, however small. This takes priority over speed and over tidiness.

- **Understand before you edit.** Read the code path and its integration tests first. If a business rule is ambiguous, ask — never guess at how money should behave.
- **Keep changes small and scoped.** No drive-by refactors, renames or "cleanups" in financial code (loans, transactions, penalties, `utils/sql`, `utils/date.ts`).
- **Money logic needs tests.** Any change to interest, settlement, penalties, corrections, fund or report calculations must come with updated or new integration tests, and the suite must be run. If it could not be run, say so plainly instead of implying it passed.
- **Never point local commands at production.** Check `DATABASE_URL` and `DIRECT_URL` before running migrations, the seed, the tests (they write and delete rows) or any ad-hoc script.
- **Schema changes are additive and reviewed.** Add a new migration; never edit one that has been applied. No dropping or rewriting columns or data without explicit approval and a plan for existing rows.
- **History is corrected, not rewritten.** Mistakes are fixed with corrective transactions and expenses are soft-deleted. Don't add code that deletes or edits recorded money rows.
- **Preserve tenant isolation.** Every query filters by `tenantId`; a missing filter leaks one business's books to another.
- **Don't break the deployed frontend.** Keep API changes backward compatible, or call out exactly what the UI must change.
- **Hard-to-undo steps need an explicit go-ahead**: committing, pushing, deploying, running migrations, touching real data.
- **Pushing to `main` is a production deploy.** See [Deployment](#deployment). Work on a branch, and never let code that needs a schema change reach `main` before its migration has been applied to the production database. That includes documentation-only pushes: they redeploy the API too.

## Stack

- Node 22, TypeScript (strict, `module: NodeNext`, compiled to CJS — `package.json` has no `"type": "module"`), Express 4 + `express-async-errors`
- PostgreSQL 16, Prisma 7 with the `@prisma/adapter-pg` driver adapter
- Zod 4 for validation, `@asteasolutions/zod-to-openapi` + Swagger UI for docs
- `decimal.js` for all money maths, JWT + bcrypt for auth
- Jest 30 (ts-jest ESM preset) + supertest

## Commands

```bash
npm run dev               # tsx watch src/server.ts (port 3000)
npm run build             # tsc -> dist/
npm test                  # jest; integration tests need a migrated Postgres at DATABASE_URL
npx jest tests/integration/monthly-loans.test.ts   # single file (keep NODE_OPTIONS from the npm script)
npm run lint              # eslint src/
npm run format            # prettier on src/ and tests/
npm run prisma:migrate    # prisma migrate dev (uses DIRECT_URL via prisma.config.ts)
npm run prisma:generate
npm run prisma:seed       # tsx prisma/seed.ts
docker compose up         # db + migrate/seed + api
```

Swagger UI is served at `/api-docs` (and `/api-docs/swagger.json`) in development and test only. `/health` is an unwrapped infra probe.

Local seed logins (phone / password): super admin `9000000000` / `SuperAdmin@123`, tenant admin `9100000001` / `Admin@123`, collector `9200000001` / `Collector@123` (tenant slug `demo-finance`). These are for local databases only; this repo is public, so none of them may exist with these passwords in production.

## Deployment

- **API**: Railway (service `loantrack-api`, `loantrack-production.up.railway.app`) builds from the `Dockerfile` and deploys automatically on every push to `main`.
- **Frontend**: Vercel deploys `loantrack-ui` `main` to production automatically (`loantrack-ui.vercel.app`); other pushed branches get preview deployments.
- **Database**: Supabase Postgres, reached through its connection pooler.
- Deployment status for a commit is visible without dashboard access: `gh api repos/<owner>/<repo>/deployments?sha=<sha>` and its `/statuses`.

### Applying a migration to production

Migrations are applied **by hand**. Nothing runs them on deploy: the container starts with `node dist/server.js`, the production image has no Prisma CLI (dev dependencies are omitted), and Railway's pre-deploy and custom start commands are empty (confirmed 2026-10-11).

Order matters, because pushing to `main` deploys the code:

1. Write the migration so the currently deployed code keeps working once it is applied (additive, nullable columns; no renames or drops in the same release).
2. Apply it to production. The owner runs this in their own terminal — the connection string holds the database password and must never be pasted into a chat, a file in this repo or shell history.
3. Only then merge and push the code that needs it. Confirm the Railway deployment succeeded and `/health` responds.
4. Ship any frontend that depends on it last.

The connection to use is **not** the one in Railway as it stands. Both `DATABASE_URL` and `DIRECT_URL` there point at Supabase's transaction pooler (port `6543`, `?pgbouncer=true`), which is right for the app but can hang or fail `prisma migrate`. Use the same URL with the port changed to `5432` (session pooler) and the query string removed:

```bash
# run from a checkout that contains the new migration folder
read -s "PROD_URL?Paste DIRECT_URL from Railway: "
PROD_URL="${PROD_URL/:6543\//:5432/}"; PROD_URL="${PROD_URL%%\?*}"
echo "Will connect to: ${PROD_URL##*@}"      # host:5432/postgres, no password

DIRECT_URL="$PROD_URL" DATABASE_URL="$PROD_URL" npx prisma migrate status   # read-only
DIRECT_URL="$PROD_URL" DATABASE_URL="$PROD_URL" npx prisma migrate deploy
unset PROD_URL
```

`migrate status` must list only the new migration as not yet applied. If it lists anything else, or says the database is not managed by Prisma Migrate, stop and investigate before applying.

## Layout

```
src/
  app.ts, server.ts        Express wiring, global Decimal rounding, route mounting
  config/                  envalid config, OpenAPI registry + route registration
  routes/ -> controllers/ -> services/     one file per domain
  schemas/                 zod request + response schemas (also feed OpenAPI)
  middleware/              authenticate, requireTenant, requireRole, validate, idempotency, rate-limit, error-handler
  utils/date.ts            the only place business dates are constructed (UTC)
  utils/sql/               raw SQL for dashboard, fund summary, P&L
  lib/prisma.ts            PrismaClient singleton
prisma/                    schema, 2 migrations (init + check constraints / partial indexes), seed
tests/integration/         supertest against the real app + DB
tests/unit/                date + errors
```

Domains: auth, users, customers, loans (+ migration), transactions, penalties/waivers, dashboard, reports, expenses, fund, platform (super admin).

## Conventions

- **Layering**: routes declare `authenticate, requireTenant, requireRole(...)`, `validate({ body, params, query })`, then a thin controller that calls a service and replies via `sendSuccess` / `sendPaginated`. Business logic lives only in services.
- **Tenant isolation is manual**: every query must filter by `tenantId` (from `req.tenantId`). There is no Prisma middleware or RLS doing it for you.
- **Casing**: request bodies and query params are `snake_case`; responses are `camelCase`. Exception: `/auth/login` and `/auth/refresh` respond in snake_case (`access_token`, `refresh_token`, `expires_in`, `user.tenant_id`).
- **Envelope**: `{ success: true, data }`, `{ success: true, data: [], pagination: { page, limit, total, totalPages } }`, or `{ success: false, error: { code, message, details } }`. Throw `AppError.badRequest/unauthorized/forbidden/notFound/conflict` — never build error responses by hand.
- **Pagination**: `page` / `limit` query strings, `limit` clamped to 100 in every list schema.
- **Money**: compute with `Decimal` (global `ROUND_HALF_UP`), store as `Decimal(12,2)`. Entity endpoints return amounts as numbers; dashboard, fund and report aggregates return fixed 2-dp **strings**.
- **Dates**: business dates are `YYYY-MM-DD` strings parsed with `parseDate` into UTC-midnight `Date`s. `today()` is the **UTC** date. Don't call `new Date('...')` for business dates.
- **Concurrency**: loans carry a `version`; mutate with `updateMany({ where: { id, tenantId, version } , data: { ..., version: { increment: 1 } } })` and throw `AppError.conflict` when `count === 0`. Approve/reject and penalty waiver take a `SELECT ... FOR UPDATE` row lock. Read-only aggregates run in `RepeatableRead` transactions.
- **Imports** use explicit `.js` extensions. Prettier: single quotes, semicolons, trailing commas, width 100.
- **New endpoint checklist**: schema in `schemas/`, route, controller, service, and register the path in `src/config/openapi-routes.ts` (it is maintained by hand).

## Auth and roles

- Login is by phone + password. Access JWT (15 min) carries `{ userId, tenantId, role }`; refresh tokens are random UUIDs stored as SHA-256 hashes, rotated on every refresh, all revoked on logout.
- `authenticate` re-checks `user.isActive` on every request; `requireTenant` re-checks tenant status (`SUSPENDED` / `DEACTIVATED` -> 403).
- `SUPER_ADMIN` has `tenantId = null` and only uses `/platform/*` (create/list/suspend/activate tenants, stats).
- `ADMIN`: everything inside the tenant.
- `COLLECTOR`: read customers, loans (list is forced to `ACTIVE` only), loan transactions, payment status, penalties, `/loans/missed-today`; create transactions and bulk collections; list transactions (forced to their own).
- Phone is unique per tenant, and globally for super admins (partial unique indexes in the second migration).

## Domain rules

Core logic is in `services/loans.service.ts` and `services/transactions.service.ts`.

### Loan numbers
`ML-<year>-NNNN` / `DL-<year>-NNNN`, per tenant + year + type, generated atomically by an upsert on `loan_number_sequences` (`utils/loan-number.ts`), inside the creating transaction.

### Monthly loans (interest-only)
- Interest per cycle = billing principal × `interestRate` / 100. `interestRate` is a **monthly** percentage.
- `monthlyDueDay` = day-of-month of disbursement, immutable; due dates clamp to short months (`getDueDate`). The first cycle is the month after disbursement.
- A cycle is identified by the calendar month of a transaction's `effectiveDate`. Settled when approved `INTEREST_PAYMENT` + `INTEREST_WAIVER` for that month ≥ interest due.
- Billing principal for a cycle = the principal outstanding when that month began, worked back as *current remaining principal + everything returned on or after the 1st of that month* (`getBillingPrincipalForCycle`). It sums `principal_returns` amounts rather than picking "the last return before the cycle", so it does not depend on row order: a return and its reversal (a negative row carrying the same date) cancel for every cycle.
- Clients do **not** send `effective_date`. An `INTEREST_PAYMENT` is split server-side across the oldest unsettled cycles (one transaction row per cycle); any excess becomes an auto-split `PRINCIPAL_RETURN` and is rejected if it exceeds remaining principal. The endpoint therefore returns an **array** of transactions.
- `PRINCIPAL_RETURN` lowers `remainingPrincipal` and `billingPrincipal` together and writes a `principal_returns` row.
- `lastInterestPaidThrough` is derived state, recomputed by `recomputeLastSettledThrough` after any interest payment, waiver or correction.
- No advance interest is collected any more: `advanceInterestAmount` is always 0. The `ADVANCE_INTEREST` type remains in the enum and in aggregate queries for old rows.
- Close requires remaining principal = 0 and every cycle settled.

### Daily loans (fixed term)
- `totalRepayment = principal × (1 + rate/100 × ceil(termDays / 30))`, `dailyPayment = totalRepayment / termDays`, `termEndDate = disbursement + termDays`, `graceDays` default 7.
- `DAILY_COLLECTION` increments `totalCollected`. Overdue when today > `termEndDate + graceDays` and `totalCollected < totalRepayment`.
- Penalties are daily-loan only and admin-imposed: `ceil(daysOverdue / 30)` months owed, minus months already charged across **all** penalties (waived ones included), × principal × rate / 100; `override_amount` replaces the computed figure. `PENALTY` payments go to a named penalty or the oldest unpaid one.
- Interest earned on daily loans is recognised **proportionally** on each rupee collected (`collected × (totalRepayment − principal) / totalRepayment`), and deployed/outstanding principal uses the same ratio.
- Close requires `totalCollected ≥ totalRepayment` and no `PENDING` / `PARTIALLY_PAID` penalties.
- **Settlement** (`PATCH /loans/:id/settle`, admin): closes an ACTIVE daily loan at exactly what has been collected when that covers the principal but not the scheduled total — typically an early repayment charged less than the full term's interest. There is no formula; the amount is the lender's judgement. `totalRepaymentAmount` is lowered to `totalCollected` and the scheduled total is kept in `originalTotalRepaymentAmount` (`isSettled` in responses), so the proportional interest and outstanding formulas stay correct with no query changes and no phantom money. The request must carry `settlement_amount` equal to the current `totalCollected` (409 otherwise). Refused below principal, when fully repaid (use close), with pending transactions, or with unpaid penalties. Never record a fake collection to make a loan closable.

### Approval workflow
- Transactions created by an ADMIN are `APPROVED` immediately and their side effects run in the same DB transaction.
- Transactions created by a COLLECTOR are `PENDING` with **no** side effects; `PATCH /transactions/:id/approve` runs `executeSideEffects`, reject just records a reason. Balance fields only ever reflect approved money.
- "Missed today" counts a loan as collected if it has an `APPROVED` or `PENDING` collection dated today.
- `POST /transactions/bulk` (daily collections, max 100) requires an `Idempotency-Key` header, cached for 24 h; items are processed independently so the response reports per-item success/failure with HTTP 201.

### Corrections
Admin-only. Recorded money rows are never edited or deleted. A corrective transaction references `corrected_transaction_id`, has a **negative** amount, the same type as the original, and reverses its side effects. One correction per original. A DB check constraint enforces `amount > 0 OR corrected_transaction_id IS NOT NULL`.

**Entries.** One recorded payment is an *entry*: usually one row, but an interest payment can become several rows (one per month settled, plus a principal return for any excess). The rows share `transactions.entry_id`, set in `recordTransactionInTx`. Rows recorded before the column existed have `NULL` and count as one-row entries; their `created_at` values are not a reliable way to group them (rows of one payment can differ by a millisecond).

**Fix and remove** (`services/entry-fixes.service.ts`, rules in `utils/entry-fixability.ts`):
- `POST /transactions/:id/remove` undoes an entry that should not exist. `POST /transactions/:id/fix` undoes it and records a replacement, which may differ in loan, type, amount or date. Both run in one DB transaction with the loan rows locked: if the replacement is refused, nothing is undone. `GET /transactions/:id/entry` returns the entry as entered plus `canFix` / `reason`.
- Each undone row gets a corrective row **dated the same day as the row it undoes** (not today), so that day's totals become what they should have been, and a reversed principal return cancels out for every billing cycle.
- Daily loans: any entry on an open (ACTIVE or DEFAULTED) loan. Monthly loans: the **latest entry only**, because later entries were worked out on top of earlier ones. A pre-`entry_id` payment that was recorded in several rows is refused.
- Not fixable: pending or rejected rows, corrections, already-corrected rows, and non-payment rows (disbursement, opening balance, waivers).
- The replacement stays credited to the original collector (`collectedById`); the admin is the approver.
- List responses carry `isCorrection` / `isCorrected`, and the loan transaction list adds `canFix`.
- "Missed today", "received today", the collector's own total and the collector summary ignore both a corrected row and the row that corrects it.

The older path — `POST /transactions` with `corrected_transaction_id` and a caller-chosen date — still works and shares the same reversal code.

### Loan lifecycle
- `ACTIVE -> CLOSED` (validated as above, or by settlement for daily loans), `ACTIVE -> DEFAULTED` (also flags the borrower `isDefaulter`), `DEFAULTED -> WRITTEN_OFF`, `DEFAULTED -> CLOSED` (admin judgement, no financial validation), `ACTIVE -> CANCELLED` (only with no approved transactions other than disbursement and no pending ones; needs a reason).
- Transactions are accepted on `ACTIVE` and `DEFAULTED` loans. `GUARANTOR_PAYMENT` is only valid on `DEFAULTED` loans.
- Cancelled loans are excluded from every financial aggregate.

### Migrating pre-existing loans (`POST /loans/migrate`)
- Monthly: stores `remaining_principal` and `last_interest_paid_through`, `isMigrated = true`, creates **no** transactions; cycle walks start the month after `lastInterestPaidThrough`, which never moves backwards.
- Daily: creates an `OPENING_BALANCE` transaction for `total_base_collected_so_far` plus optional pre-existing penalty rows. No `DISBURSEMENT` row, so migrated loans don't reduce cash in hand.

### Fund and reports (`utils/sql/fund-queries.ts`)
- Cash in hand = fund injections − withdrawals − disbursements + money-in transactions − expenses (approved only, non-cancelled loans, `OPENING_BALANCE` and waivers excluded). `/fund/reconciliation` computes it two ways and compares.
- Net profit = interest earned (monthly interest + proportional daily interest + penalties) − money lost to defaults (net of guarantor recoveries) − expenses.
- `/reports/profit-loss?from&to` filters flows by date but reports `moneyDeployed` and `cashInHand` as current snapshots. `dailyDisbursed`, `monthlyDisbursed`, `totalReceived` exist only in the P&L variant.

## Gotchas

- **Two Prisma clients.** App code imports `@prisma/client` (generator `prisma-client-js`). `tests/helpers/prisma.ts` and `prisma/seed.ts` import `src/generated/prisma/client.js`, a checked-in client from an earlier generator setup. `src/generated` is gitignored but still tracked, and `prisma generate` no longer writes there — after a schema change the tests and seed will be using a stale client unless that is fixed.
- **Docs lag the code.** `BRD.md`, `TECHNICAL_SPEC.md`, `IMPLEMENTATION_PLAN.md` describe the original design. At least three things changed afterwards: advance interest was removed, `effective_date` was removed from the API in favour of auto-settlement, and daily-loan interest moved from principal-first to proportional recognition. Trust the code and `git log`.
- **Env mismatches.** `.env.example` uses `postgres:postgres`, `docker-compose.yml` uses `loantrack:loantrack`. `prisma.config.ts` reads `DIRECT_URL`, which the compose `migrate` service does not set. `CORS_ORIGINS`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` are supported but absent from `.env.example`.
- **UTC "today".** Server-side `today()` is the UTC date while the frontend uses the device's local date, so they disagree between 00:00 and 05:30 IST.
- **Login lookup** is `findFirst({ where: { phone } })` with no tenant qualifier, while phone uniqueness is only per tenant.
- **Tests share one database.** Each integration file creates tenants with its own slug and phone prefix and deletes them in `beforeAll`; pick an unused prefix for a new file. Rate limits are lifted when `NODE_ENV=test`.
- **Eight tests fail on a clean checkout** (as of 2026-10-11) because they were not updated after earlier changes or rely on hard-coded early-2026 dates: two in `collector-workflow` (removed `effective_date`, overpayment auto-split), two in `daily-loans` (advance interest, in-term overdue), two in `penalties-waivers` (non-overdue penalty, collector access), one in `dashboard` (in-term overdue) and one in `monthly-loans` (multi-cycle overpayment). Compare against that baseline rather than expecting green; a "socket hang up" failure is a flake.
- Port 3000 is the default for both this API and `next dev` in the frontend.

## Frontend (`../loantrack-ui`)

Next.js 16 App Router PWA (React 19, Tailwind 4, shadcn/ui "new-york", TanStack Query 5, zustand, react-hook-form + zod, axios, `@ducanh2912/next-pwa`, vitest + Testing Library + msw). Mobile-first with a bottom tab bar; the super-admin area uses a sidebar. Every page is a client component.

- Scripts: `npm run dev`, `npm run build` (`next build --webpack`, required by the PWA plugin), `npm test` (vitest), `npm run lint`. Env: `NEXT_PUBLIC_API_URL` (backend origin, without `/api/v1`).
- Route groups under `src/app`: `(auth)/login`; `(app)` wraps everything authenticated and holds `(admin)` (dashboard, money, more), `(browse)` (customers, loans, today — shared by admin and collector, collector read-only), `(collector)` (profile), `(platform)` (super admin) and `shared/`. Role gating is client-side in `(app)/layout.tsx` plus each group layout.
- Code layout: `src/features/<domain>/{components,hooks,schemas.ts,types.ts,__tests__}`, API functions in `src/lib/api/<domain>.api.ts`, query keys in `src/lib/query-keys.ts`, shared types in `src/types`.
- `src/lib/api/client.ts` converts request bodies and params camelCase -> snake_case, unwraps the response envelope, and does a queued refresh-and-retry on 401. Responses are not case-converted, which is why `auth.api.ts` maps the snake_case login/refresh payloads by hand.
- Auth state: access token in memory only; refresh token and user persisted to localStorage (`loantrack-auth`). `(app)/layout.tsx` refreshes on load and again at 80% of token lifetime; a 403 on refresh shows the "tenant suspended" screen.
- Amount fields typed `string` in the UI come from the aggregate endpoints; entity amounts are `number`.
- `docs/` holds copies of this repo's BRD/spec files and a `swagger.json` snapshot.
- That repo has its own `CLAUDE.md` with the frontend conventions in more detail.

### Frontend branches and API parity (checked 2026-10-11)

- The frontend's default branch is `main`. It also has an old `master` branch that stops on 2026-02-01, 31 commits behind `main`. Check which branch the sibling checkout is on before reading it: `master` still has the pre-`missed-today` collector screen, the `effectiveDate` form fields and the old P&L type, all of which `main` has fixed.
- On `main` the UI matches this API except for one leftover: the create-loan form still previews advance interest and the monthly loan detail still shows an "Advance Interest" row, though it is always 0 now.
