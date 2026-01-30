# LoanTrack API - Implementation Plan

> Phase-by-phase guide bridging the BRD and Technical Spec to actual coding.
> Each phase is a vertical slice that produces a working, testable subset of the system.

---

## Phase Dependency Graph

```
Phase 0: Project Scaffolding & Infrastructure
  |
Phase 1: Database Schema & Migrations
  |
Phase 2: Auth & Multi-Tenancy Foundation
  |
  +---------------------------+-----------+
  |                           |           |
Phase 3: Customer Management  |   Phase 11: Platform Admin (Super Admin)
  |                           |           (parallel with 4-10)
  +-------------+             |
  |             |             |
Phase 4:      Phase 5:       |
Monthly Loans Daily Loans    |
(parallel)    (parallel)     |
  |             |             |
  +------+------+             |
         |                    |
Phase 6: Collector Workflow & Approvals
         |
Phase 7: Penalties & Waivers
         |
Phase 8: Defaults, Write-offs, Corrections & Cancellation
         |
Phase 9: Dashboard & Reports
         |
Phase 10: Migration (Day-One Import)
         |
Phase 12: Hardening & Polish (depends on all)
```

---

## Project Setup & Conventions

### Tooling

| Tool | Purpose |
|------|---------|
| Node.js (LTS) | Runtime |
| TypeScript | Language (strict mode) |
| Express.js | HTTP framework |
| Prisma | ORM + migrations |
| PostgreSQL | Database |
| Zod | Request validation |
| JWT (jsonwebtoken) | Auth tokens |
| bcrypt | Password hashing (min 12 rounds) |
| Jest + Supertest | Testing |
| ESLint + Prettier | Code quality |
| Swagger/OpenAPI (swagger-jsdoc + swagger-ui-express) | API docs |

### Folder Structure

```
src/
  app.ts                    # Express app setup, middleware registration
  server.ts                 # Server entry point
  config/
    index.ts                # Environment config (DB, JWT secrets, etc.)
  middleware/
    auth.ts                 # JWT verification, extract user context
    tenant.ts               # Inject tenant_id, check tenant is ACTIVE
    role.ts                 # RBAC guard (SUPER_ADMIN, ADMIN, COLLECTOR)
    error-handler.ts        # Global error handler
    validate.ts             # Zod schema validation middleware
  routes/
    index.ts                # Route aggregator
    auth.routes.ts
    platform.routes.ts      # Super admin routes
    users.routes.ts
    customers.routes.ts
    loans.routes.ts
    transactions.routes.ts
    penalties.routes.ts
    dashboard.routes.ts
    reports.routes.ts
    expenses.routes.ts
    fund.routes.ts
  controllers/              # Request/response handling (thin)
  services/                 # Business logic layer
  repositories/             # Data access (Prisma calls)
  schemas/                  # Zod validation schemas
  utils/
    errors.ts               # Custom error classes (AppError, etc.)
    date.ts                 # Due date computation, billing cycle helpers
    loan-number.ts          # Loan number generation
    sql/                    # Raw SQL query constants for reports/dashboard
  types/
    index.ts                # Shared TypeScript types/interfaces
prisma/
  schema.prisma
  migrations/
  seed.ts                   # Dev seed data
tests/
  unit/                     # Pure logic tests (services, utils)
  integration/              # API endpoint tests with DB
  helpers/                  # Test factories, DB setup/teardown
```

### Coding Standards

- **All financial amounts**: `Decimal(12,2)` in DB, `Decimal.js` or Prisma Decimal in code. Never `number` for money.
- **Rounding mode**: Configure `Decimal.set({ rounding: Decimal.ROUND_HALF_UP })` globally in `src/app.ts` at startup. Every financial calculation (interest, penalties, auto-split, daily payment) must use this single consistent mode. `ROUND_HALF_UP` is standard in finance. Never rely on JavaScript's default `Math.round` or implicit float rounding for money.
- **Date handling (timezone safety)**: All dates are stored as `DATE` (not `TIMESTAMP`) in PostgreSQL and represented as `YYYY-MM-DD` strings in API JSON. Never serialize JavaScript `Date` objects directly into JSON responses — extract the date string explicitly. Use `Date` objects only for intermediate calculation (e.g., computing due dates, adding days), then immediately convert back to `YYYY-MM-DD` string. All date construction must use UTC methods (`new Date(Date.UTC(year, month, day))` or a helper) to avoid local-timezone shifts where `new Date('2026-02-28')` could render as "Feb 27" in a non-UTC timezone. The `src/utils/date.ts` module must be the single place where `Date` objects are created and formatted — no ad-hoc `new Date()` calls scattered in services.
- **No raw SQL** for standard CRUD. Use Prisma query API.
- **Raw SQL via `prisma.$queryRaw`** for report/dashboard aggregations (fund summary, profit, overdue detection). Store queries in `src/utils/sql/`.
- **All multi-step financial operations** wrapped in `prisma.$transaction()`.
- **tenant_id**: extracted from JWT, never from request body/params.
- **Error responses**: consistent `{ error: { code, message, details } }` format.
- **Pagination**: `page` + `limit` query params on all list endpoints.

---

## Phase 0: Project Scaffolding & Infrastructure

**Depends on**: Nothing

### What Gets Built

- Node.js + TypeScript project initialized
- Express server with health check endpoint
- Prisma configured and connected to PostgreSQL
- Global error handling middleware
- Environment configuration (`.env` based)
- Linting and formatting setup
- Test framework wired up

### Exact Deliverables

1. `package.json` with all dependencies (including `decimal.js`)
2. `tsconfig.json` (strict mode)
3. `.env.example` with required variables:
   - `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `PORT`
4. `src/server.ts` - starts Express, connects Prisma
5. `src/app.ts` - Express app with JSON body parser, CORS, error handler. **Must call `Decimal.set({ rounding: Decimal.ROUND_HALF_UP })` at startup** before any financial logic executes.
6. `GET /health` returns `{ status: "ok" }`
7. `src/middleware/error-handler.ts` - catches all errors, returns standard format
8. `src/utils/errors.ts` - `AppError` class with `code`, `statusCode`, `message`
9. `src/utils/date.ts` - Central date utility module. All date construction and formatting goes through here. Must use UTC internally to avoid timezone drift (see Coding Standards). Exports: `toDateString(date): string` (formats as `YYYY-MM-DD`), `parseDate(str): Date` (parses `YYYY-MM-DD` in UTC), `addDays(date, n): Date`, `getDueDate(monthly_due_day, year, month): Date`. No other module should call `new Date()` directly for business dates.
10. `prisma/schema.prisma` - datasource + generator only (models come in Phase 1)
11. Jest config, one passing placeholder test
12. ESLint + Prettier config
13. `.gitignore`

### Acceptance Criteria

- [ ] `npm run dev` starts the server without errors
- [ ] `GET /health` returns 200
- [ ] `npm test` runs and passes
- [ ] `npx prisma db push` connects to PostgreSQL successfully
- [ ] TypeScript compiles with zero errors in strict mode
- [ ] `Decimal.set({ rounding: Decimal.ROUND_HALF_UP })` is called before any route handler
- [ ] `src/utils/date.ts` exports work correctly: `toDateString(parseDate('2026-02-28'))` === `'2026-02-28'` regardless of server timezone
- [ ] `parseDate('2026-02-28')` does NOT shift to Feb 27 or Mar 1 in any timezone

### Technical Notes

- Use `express-async-errors` or wrap routes to catch async errors automatically.
- Set `"strict": true` in tsconfig from day one.

---

## Phase 1: Database Schema & Migrations

**Depends on**: Phase 0

### What Gets Built

Complete Prisma schema for all tables, initial migration applied.

### Tables Created

| Table | Key Columns | Notes |
|-------|-------------|-------|
| `tenants` | id, name, slug, status, settings (JSONB) | Multi-tenant root |
| `users` | id, tenant_id (nullable), role, phone, password_hash | SUPER_ADMIN has NULL tenant_id |
| `customers` | id, tenant_id, full_name, phone, aadhaar_number, is_defaulter | Borrowers AND guarantors |
| `loans` | id, tenant_id, loan_number, loan_type, principal_amount, interest_rate, remaining_principal, billing_principal, total_collected, status, version | Core table with all monthly + daily fields |
| `transactions` | id, tenant_id, loan_id, penalty_id, corrected_transaction_id, transaction_type, amount, approval_status | Money movement audit trail |
| `principal_returns` | id, tenant_id, loan_id, transaction_id, amount_returned, remaining_principal_after | Monthly loan partial return history |
| `penalties` | id, tenant_id, loan_id, days_overdue, months_charged, penalty_amount, waived_amount, net_payable, status, amount_collected | Overdue daily loan penalties |
| `expenses` | id, tenant_id, category, amount, is_deleted | Soft-delete operational expenses |
| `fund_entries` | id, tenant_id, entry_type, amount | Capital injections/withdrawals |
| `refresh_tokens` | id, user_id, token_hash, expires_at, is_revoked | JWT refresh token storage |
| `loan_number_sequences` | tenant_id+year+loan_type (PK), current_value | Counter table for loan numbers |
| `idempotency_keys` | key (PK), tenant_id, user_id, response_status, response_body, expires_at | Bulk submission replay protection |

### Exact Deliverables

1. Complete `prisma/schema.prisma` with all models, relations, enums
2. All indexes from the Tech Spec (composite indexes with `tenant_id` as leading column)
3. All unique constraints (tenant-scoped Aadhaar/PAN, tenant+loan_number, tenant+phone for users)
4. Check constraints via raw SQL migration:
   - `remaining_principal >= 0`
   - `billing_principal >= 0`
   - `total_collected >= 0`
   - Transaction amount: `amount > 0 OR corrected_transaction_id IS NOT NULL`
5. Enums: `TenantStatus`, `UserRole`, `LoanType`, `LoanStatus`, `TransactionType`, `ApprovalStatus`, `PenaltyStatus`, `ExpenseCategory`, `FundEntryType`
6. Initial migration via `npx prisma migrate dev`

### Acceptance Criteria

- [ ] `npx prisma migrate dev` runs cleanly on a fresh database
- [ ] `npx prisma generate` produces the client without errors
- [ ] All check constraints verified via failing INSERT test queries
- [ ] All unique constraints verified via failing duplicate INSERT queries
- [ ] `npx prisma db push --force-reset && npx prisma migrate dev` is idempotent

### Technical Notes / Gotchas

- **Partial unique indexes** (e.g., `UNIQUE(tenant_id, phone) WHERE tenant_id IS NOT NULL` on users) are not natively supported by Prisma `@@unique`. Use raw SQL in the migration for these.
- **JSONB `settings`** on tenants: define a TypeScript interface for the expected shape, validate with Zod on writes.
- **`version` column** on loans: Prisma doesn't have built-in optimistic locking. Implement manually in the repository layer with `WHERE version = :expected AND id = :id`, then check `updateCount === 0` to throw 409.
- **Nullable `tenant_id`** on users for SUPER_ADMIN: Prisma relation must be optional.

---

## Phase 2: Auth & Multi-Tenancy Foundation

**Depends on**: Phase 1

### What Gets Built

- JWT-based authentication (login, refresh, logout, change password)
- Middleware chain: auth -> tenant -> role
- Tenant status enforcement (suspended tenant = 403)
- User management endpoints (admin creates collectors)
- Prisma middleware or base repository for automatic `tenant_id` scoping
- Seed script: one super admin, one tenant, one admin user

### Endpoints

| Method | Endpoint | Role |
|--------|----------|------|
| POST | `/api/v1/auth/login` | Public |
| POST | `/api/v1/auth/refresh` | Public |
| POST | `/api/v1/auth/logout` | Authenticated |
| PATCH | `/api/v1/auth/change-password` | Authenticated |
| GET | `/api/v1/auth/me` | Authenticated |
| GET | `/api/v1/users` | ADMIN |
| POST | `/api/v1/users` | ADMIN |
| PUT | `/api/v1/users/:id` | ADMIN |
| PATCH | `/api/v1/users/:id/deactivate` | ADMIN |
| POST | `/api/v1/users/:id/reset-password` | ADMIN |

### Business Logic

- **Login**: phone + password -> bcrypt compare -> JWT access token (15 min) + refresh token (7 day)
- **JWT payload**: `{ user_id, tenant_id, role }`
- **Refresh**: validate token_hash + not revoked + not expired -> new access + new refresh, revoke old (rotation)
- **Logout**: revoke ALL refresh tokens for user
- **Deactivate user**: set `is_active = false`, revoke all their refresh tokens
- **Tenant middleware**: extract `tenant_id` from JWT, query tenant, reject if `SUSPENDED` or `DEACTIVATED` (403)
- **Role middleware**: factory function `requireRole('ADMIN')` checks JWT role

### Acceptance Criteria

- [ ] Login with valid credentials returns access + refresh tokens
- [ ] Login with invalid credentials returns 401
- [ ] Access token expires in 15 minutes (verify with manipulated exp)
- [ ] Refresh token rotation works: old token is revoked, new pair issued
- [ ] Logout revokes all refresh tokens for the user
- [ ] Suspended tenant gets 403 on all tenant-scoped endpoints
- [ ] Collector cannot access admin-only endpoints (403)
- [ ] `GET /auth/me` returns user profile + tenant info
- [ ] Admin can create collector accounts
- [ ] Deactivated user cannot log in, existing tokens rejected
- [ ] All DB queries scoped by `tenant_id` (verify via test with two tenants)

### Technical Notes / Gotchas

- **Never store raw refresh tokens** in DB. Store `SHA-256(token)`.
- **Phone uniqueness**: `UNIQUE(tenant_id, phone) WHERE tenant_id IS NOT NULL` for tenant users; `UNIQUE(phone) WHERE tenant_id IS NULL` for super admins. Application-level validation needed since Prisma can't express conditional uniques.
- **bcrypt rounds**: minimum 12. Parameterize via config.
- **Prisma middleware** for tenant scoping: intercept `findMany`, `findUnique`, `create`, `update`, `delete` and inject `tenant_id` from context. Be careful with:
  - `findUnique` on `id` alone (must add `tenant_id` to where clause)
  - `$queryRaw` bypasses middleware (must manually include tenant_id)
  - Transactions started with `$transaction` must propagate context

---

## Phase 3: Customer Management

**Depends on**: Phase 2

### What Gets Built

- Full CRUD for customers (borrowers and guarantors share the same table)
- Search and filtering
- File upload for photo and ID proof
- Defaulter flag display (flag itself is managed by loan default flow in Phase 8)

### Endpoints

| Method | Endpoint | Role |
|--------|----------|------|
| GET | `/api/v1/customers` | ADMIN, COLLECTOR |
| GET | `/api/v1/customers/:id` | ADMIN, COLLECTOR |
| POST | `/api/v1/customers` | ADMIN |
| PUT | `/api/v1/customers/:id` | ADMIN |
| GET | `/api/v1/customers/:id/loans` | ADMIN, COLLECTOR |
| PATCH | `/api/v1/customers/:id/clear-defaulter` | ADMIN |
| POST | `/api/v1/customers/:id/upload-photo` | ADMIN |
| POST | `/api/v1/customers/:id/upload-id-proof` | ADMIN |

### Business Logic

- **Search**: filter by `full_name` (ILIKE), `phone`, `is_defaulter`
- **Unique constraints**: `(tenant_id, aadhaar_number)` and `(tenant_id, pan_number)` — both nullable, enforced only when provided
- **Address optional**: guarantors may be added quickly with just name + phone
- **File uploads**: stored at `uploads/{tenant_id}/customers/{customer_id}/photo.*` and `uploads/{tenant_id}/customers/{customer_id}/id_proof.*`
- **Collector visibility**: collectors can see customer details (name, phone, address) needed for collection. They cannot see `is_defaulter` flag details or loans that aren't ACTIVE (enforced in Phase 6).
- **Guarantor warnings** (computed on `GET /:id`): query loans where `guarantor_id = customer.id AND status IN ('DEFAULTED','WRITTEN_OFF')`. Return as `guarantor_warnings` array.
- **Clear defaulter**: admin manually sets `is_defaulter = false`

### Acceptance Criteria

- [ ] Create customer with minimal fields (name + phone) succeeds
- [ ] Create customer with full fields succeeds
- [ ] Duplicate Aadhaar within same tenant is rejected (409)
- [ ] Duplicate Aadhaar across different tenants is allowed
- [ ] Customer search by name (partial match) works
- [ ] Customer search by phone works
- [ ] File upload stores files in tenant-scoped path
- [ ] `GET /customers/:id` includes `guarantor_warnings` computed field
- [ ] `clear-defaulter` sets `is_defaulter = false`
- [ ] Customers from tenant A are invisible to tenant B

### Technical Notes / Gotchas

- **Nullable unique**: PostgreSQL allows multiple NULLs in a unique constraint, so nullable Aadhaar/PAN with `(tenant_id, aadhaar_number)` works correctly — duplicates are only rejected when both values are non-null.
- **File serving**: files must be served via an authenticated endpoint that validates tenant_id, not directly from a public static path.
- **Guarantor warnings query** will be slow without an index on `(tenant_id, guarantor_id)` — already specified in the loans table indexes.

---

## Phase 4: Monthly Loans (Core)

**Depends on**: Phase 3

### What Gets Built

- Monthly loan disbursement
- Interest collection (with overpayment auto-split)
- Principal return
- Loan closure validation
- Overdue detection
- Billing principal lifecycle
- Loan number generation

### Endpoints

| Method | Endpoint | Role | Notes |
|--------|----------|------|-------|
| POST | `/api/v1/loans` | ADMIN | `loan_type: "MONTHLY"` |
| GET | `/api/v1/loans` | ADMIN, COLLECTOR | Filter: `type=MONTHLY` |
| GET | `/api/v1/loans/:id` | ADMIN, COLLECTOR | Computed fields |
| GET | `/api/v1/loans/:id/transactions` | ADMIN | |
| GET | `/api/v1/loans/:id/payment-status` | ADMIN | Month-by-month status |
| POST | `/api/v1/transactions` | ADMIN | Types: INTEREST_PAYMENT, PRINCIPAL_RETURN |
| PATCH | `/api/v1/loans/:id/close` | ADMIN | Validates closure conditions |

### Business Logic

**Disbursement (DB transaction):**
1. Validate borrower exists in tenant, guarantor (if provided) exists in tenant
2. Generate loan number: `ML-{YEAR}-{SEQ}` via `SELECT ... FOR UPDATE` on `loan_number_sequences`
3. Calculate: `advance_interest = principal_amount * interest_rate / 100`
4. Extract `monthly_due_day` from `disbursement_date` (day of month, immutable)
5. Insert loan: `remaining_principal = principal_amount`, `billing_principal = principal_amount`, `status = ACTIVE`
6. Insert DISBURSEMENT transaction (auto-approved)
7. Insert ADVANCE_INTEREST transaction (auto-approved)

**Interest Collection (admin-recorded, auto-approved):**
1. Calculate `interest_due = billing_principal * interest_rate / 100`
2. If `amount <= interest_due`: create single INTEREST_PAYMENT
3. If `amount > interest_due`: auto-split into INTEREST_PAYMENT (`interest_due`) + PRINCIPAL_RETURN (`amount - interest_due`), both in one DB transaction
4. PRINCIPAL_RETURN side effect: decrement `remaining_principal`, insert `principal_returns` record
5. `billing_principal` stays unchanged (updates at cycle boundary)

**Principal Return:**
1. Validate: `amount <= remaining_principal`
2. Decrement `remaining_principal`
3. Insert `principal_returns` record (snapshot `remaining_principal_after`)
4. `billing_principal` unchanged

**Billing Principal Sync (at cycle boundary):**
- When recording first payment/waiver for a new cycle: set `billing_principal = remaining_principal`
- Detect "new cycle" by checking if `effective_date` is beyond the previously settled cycle

**Monthly Due Date Computation (via `src/utils/date.ts`):**
```
getDueDate(monthly_due_day, year, month) = new Date(Date.UTC(year, month-1, MIN(monthly_due_day, lastDayOfMonth)))
```
- All date construction uses UTC to avoid timezone shifts (see Coding Standards).
- `monthly_due_day = 31` -> Jan 31, Feb 28, Mar 31 (bounces back)
- Return value is immediately formatted to `YYYY-MM-DD` string for storage and API responses.

**Closure Validation:**
1. `remaining_principal == 0`
2. All billing cycles from disbursement through the final cycle are settled
3. Cycle is settled when `SUM(INTEREST_PAYMENT) + SUM(INTEREST_WAIVER) >= interest_due` for that cycle
4. Full month interest owed even if principal returned mid-cycle

**Computed Fields on `GET /loans/:id` (monthly):**
- `remaining_principal`, `billing_principal`, `monthly_interest_due` (= `billing_principal * rate / 100`), `next_due_date`, `is_overdue`, `total_interest_collected`, `months_active`

### Acceptance Criteria

- [ ] Disbursement creates loan + DISBURSEMENT + ADVANCE_INTEREST transactions atomically
- [ ] Loan number format: `ML-2026-0001`, increments correctly
- [ ] Concurrent loan creation doesn't produce duplicate numbers
- [ ] Interest collection with exact amount creates one transaction
- [ ] Interest overpayment auto-splits into interest + principal return
- [ ] Principal return decrements `remaining_principal` but NOT `billing_principal`
- [ ] `billing_principal` syncs to `remaining_principal` at cycle boundary
- [ ] Due date computation handles short months (Feb 28 for day 31)
- [ ] Due date bounces back after short month (Feb 28 -> Mar 31)
- [ ] Closure succeeds when `remaining_principal == 0` AND all cycles settled
- [ ] Closure fails if unsettled cycles exist
- [ ] Closure fails if `remaining_principal > 0`
- [ ] Underpayment: full amount recorded as INTEREST_PAYMENT, cycle remains unsettled
- [ ] Overdue detection flags loans with unsettled past-due cycles
- [ ] Optimistic locking: concurrent principal returns on same loan get 409

### Technical Notes / Gotchas

- **Billing principal lifecycle** is the most subtle piece. Test extensively:
  - Return principal on Feb 14, interest due Feb 15 uses OLD billing_principal
  - Return principal on Feb 5, interest due Feb 15 uses OLD billing_principal
  - After Feb 15 cycle is settled, Mar 15 uses NEW billing_principal
- **Optimistic locking**: every mutation that touches `remaining_principal` or `billing_principal` must check `WHERE version = :expected` and increment.
- **Auto-split is mandatory**: there's no bypass for overpayment. Interest must be settled first.
- **Auto-split rounding**: use `Decimal.js` with `ROUND_HALF_UP` for the interest_due calculation. The principal return portion is `amount - interest_due` (exact subtraction, no separate rounding). This ensures zero rounding loss: the two parts always sum to the original amount.
- **`effective_date`** on INTEREST_PAYMENT identifies which billing cycle it covers. This is how settlement is computed.
- **Date handling**: all due date computation must go through `src/utils/date.ts` (Phase 0). Never construct `new Date()` directly in service code. API requests and responses use `YYYY-MM-DD` strings for all date fields.

---

## Phase 5: Daily Loans (Core)

**Depends on**: Phase 3

### What Gets Built

- Daily loan disbursement with upfront repayment calculation
- Daily collection recording
- Total collected tracking
- Days paid computation
- Grace period tracking
- Loan closure validation

### Endpoints

| Method | Endpoint | Role | Notes |
|--------|----------|------|-------|
| POST | `/api/v1/loans` | ADMIN | `loan_type: "DAILY"` |
| GET | `/api/v1/loans` | ADMIN, COLLECTOR | Filter: `type=DAILY` |
| GET | `/api/v1/loans/:id` | ADMIN, COLLECTOR | Computed fields |
| GET | `/api/v1/loans/:id/transactions` | ADMIN | |
| GET | `/api/v1/loans/:id/payment-status` | ADMIN | Day-by-day status |
| POST | `/api/v1/transactions` | ADMIN | Type: DAILY_COLLECTION |
| PATCH | `/api/v1/loans/:id/close` | ADMIN | Validates closure conditions |

### Business Logic

**Disbursement (DB transaction):**
1. Validate borrower, guarantor (if provided)
2. Generate loan number: `DL-{YEAR}-{SEQ}`
3. Calculate:
   - `total_repayment = principal * (1 + interest_rate/100 * term_days/30)`
   - `daily_payment = total_repayment / term_days`
   - `term_end_date = disbursement_date + term_days`
4. Display `daily_payment` to admin for confirmation (round number check is UX, not enforced)
5. Insert loan: `total_collected = 0`, `status = ACTIVE`
6. Insert DISBURSEMENT transaction (auto-approved)

**Daily Collection (admin-recorded, auto-approved):**
1. Create DAILY_COLLECTION transaction
2. Side effect on approval: increment `loans.total_collected`
3. Amount can vary (partial, catch-up). What matters is total vs total_repayment.

**Days Paid Computation (read-only):**
```
days_paid = FLOOR(total_collected / daily_payment_amount)
```
One large payment counts as multiple days.

**Missed Payment Detection:**
- For each ACTIVE daily loan where `today <= term_end_date`:
  - If no approved DAILY_COLLECTION exists with `transaction_date = today` -> flagged as missed

**Overdue Detection:**
- `today > term_end_date + grace_days AND total_collected < total_repayment_amount` -> overdue
- `days_overdue = today - term_end_date - grace_days` (only when > 0)

**Closure Validation:**
1. `total_collected >= total_repayment_amount`
2. All imposed penalties are PAID or WAIVED (penalty handling in Phase 7)

**Computed Fields on `GET /loans/:id` (daily):**
- `total_collected`, `total_remaining` (= `total_repayment - total_collected`), `days_paid`, `days_remaining`, `days_elapsed`, `is_overdue`, `days_overdue`, `penalty_amount`, `is_base_paid` (= `total_collected >= total_repayment`)

### Acceptance Criteria

- [ ] Disbursement calculates `total_repayment` and `daily_payment` correctly
- [ ] Example: Rs 1,00,000 at 5% for 120 days = Rs 1,20,000 total, Rs 1,000/day
- [ ] Example: Rs 10,000 at 5% for 120 days = Rs 12,000 total, Rs 100/day
- [ ] Loan number format: `DL-2026-0001`
- [ ] Daily collection increments `total_collected`
- [ ] `days_paid = FLOOR(total_collected / daily_payment)` (large payment = multiple days)
- [ ] Missed detection works for active loans within term period
- [ ] Overdue detection: `today > term_end_date + grace_days AND not fully paid`
- [ ] Closure succeeds when `total_collected >= total_repayment` (penalties checked in Phase 7)
- [ ] Closure fails when `total_collected < total_repayment`
- [ ] Optimistic locking on concurrent DAILY_COLLECTION approvals

### Technical Notes / Gotchas

- **`total_collected` is a cached sum** on the loans table, updated atomically on each approved collection. This avoids scanning the transactions table for every daily loan query. Keep it in sync.
- **Principal-first accounting** (for profit): pure read-time computation. Don't store "interest earned" on the loan. Calculate as `MAX(total_collected - principal_amount, 0)`.
- **Grace days** default to 7 but are configurable per loan at disbursement.
- **Penalty check on closure** is deferred to Phase 7 — for now, closure only checks base amount.

---

## Phase 6: Collector Workflow & Approvals

**Depends on**: Phase 4, Phase 5

### What Gets Built

- Collector payment submission (PENDING status)
- Admin approval / rejection flow
- Approval-gated side effects
- Bulk collection with idempotency
- Collector data visibility restrictions
- Stale data guard (loan status validation on submission)

### Endpoints

| Method | Endpoint | Role | Notes |
|--------|----------|------|-------|
| POST | `/api/v1/transactions` | COLLECTOR | Creates PENDING transaction |
| POST | `/api/v1/transactions/bulk` | COLLECTOR | Bulk daily collections with idempotency |
| GET | `/api/v1/transactions/pending` | ADMIN | All pending approvals |
| PATCH | `/api/v1/transactions/:id/approve` | ADMIN | Approve + execute side effects |
| PATCH | `/api/v1/transactions/:id/reject` | ADMIN | Reject with reason |
| GET | `/api/v1/transactions` | ADMIN | List with filters |

### Business Logic

**Collector Submission:**
1. Collector creates transaction -> `approval_status = PENDING`
2. No side effects execute yet (no `remaining_principal` change, no `total_collected` change)
3. `collected_by` set from JWT

**Loan Status Validation on Submission:**
- `ACTIVE`: accepted
- `DEFAULTED`: accepted (recovery payments valid)
- `CANCELLED`: rejected (400) — treated as if loan never existed
- `CLOSED` / `WRITTEN_OFF`: rejected (400) — finalized

**Admin Approval (DB transaction):**
1. Lock transaction row (`SELECT ... FOR UPDATE`)
2. Verify `approval_status = PENDING`
3. Set `approval_status = APPROVED`, `approved_by`, `approved_at`
4. Execute side effects based on `transaction_type`:
   - `PRINCIPAL_RETURN`: decrement `remaining_principal`, insert `principal_returns` (with optimistic lock)
   - `DAILY_COLLECTION`: increment `total_collected` (with optimistic lock)
   - `GUARANTOR_PAYMENT`: increment `total_collected` for daily loans (with optimistic lock)
   - `PENALTY`: update `penalties.amount_collected` + status (with row lock)
   - `INTEREST_PAYMENT`: no loan-level side effect

**Admin Rejection:**
1. Set `approval_status = REJECTED`, `rejection_reason`
2. No side effects

**Admin Direct Recording:**
- When admin creates a transaction, `approval_status = APPROVED` immediately
- Side effects execute in the same DB transaction

**Bulk Collection:**
1. `Idempotency-Key` header required
2. Check `idempotency_keys` table for duplicate key
3. If duplicate: return cached response
4. If new: process each collection individually (own transaction per item)
5. Partial success: `{ created: N, failed: M, errors: [...] }`
6. Store idempotency key + response for 24 hours

**Collector Visibility:**
- Collectors can only see `ACTIVE` loans (filter enforced at query level)
- Collectors can see borrower details needed for collection (name, phone, address)
- Cannot see: closed, defaulted, written-off, cancelled loans
- Cannot access: fund data, expenses, reports, user management

### Acceptance Criteria

- [ ] Collector-submitted transaction has `approval_status = PENDING`
- [ ] Admin-submitted transaction has `approval_status = APPROVED` immediately
- [ ] Pending transaction does NOT affect `remaining_principal` or `total_collected`
- [ ] Approved transaction executes correct side effects atomically
- [ ] Rejected transaction has no side effects, stores reason
- [ ] Double-approval prevented (second attempt returns 409)
- [ ] Bulk submission with idempotency key: first call succeeds, replay returns cached response
- [ ] Partial failure in bulk: successful items saved, failed items reported
- [ ] Collector submitting for CANCELLED loan gets 400
- [ ] Collector submitting for DEFAULTED loan gets 200 (PENDING)
- [ ] Collector submitting for CLOSED/WRITTEN_OFF loan gets 400
- [ ] Collector cannot see non-ACTIVE loans via `GET /loans`
- [ ] Collector cannot access admin-only endpoints

### Technical Notes / Gotchas

- **Side effects are the critical path.** All side effects must run in the same DB transaction as the approval status change. If the side effect fails, the approval must roll back.
- **Optimistic locking on approval**: when the side effect updates the loan (e.g., `remaining_principal`), it must check `WHERE version = :expected`. If stale (409), the admin retries.
- **Idempotency key cleanup**: expired keys (> 24 hours) should be cleaned up. Use a periodic job or check on insert.
- **Bulk operations**: each collection is its own transaction. This means one failure doesn't roll back others. The response tells the admin which ones failed and why.

---

## Phase 7: Penalties & Waivers

**Depends on**: Phase 4, Phase 5

### What Gets Built

- Penalty imposition for overdue daily loans (auto-calculation + admin confirmation)
- Penalty payment recording
- Penalty waiver (full/partial)
- Interest waiver for monthly loans (full/partial)
- Billing cycle settlement computation
- Closure validation updates (penalties must be settled)

### Endpoints

| Method | Endpoint | Role |
|--------|----------|------|
| POST | `/api/v1/loans/:id/penalties` | ADMIN |
| GET | `/api/v1/loans/:id/penalties` | ADMIN |
| PATCH | `/api/v1/penalties/:id/waive` | ADMIN |
| POST | `/api/v1/loans/:id/waive-interest` | ADMIN |
| GET | `/api/v1/loans/:id/waivers` | ADMIN |

### Business Logic

**Penalty Auto-Calculation (incremental stacking):**
1. `days_overdue = today - term_end_date - grace_days` (must be > 0)
2. `total_months_owed = CEIL(days_overdue / 30)`
3. `months_already_penalised = SUM(months_charged)` from ALL penalties on this loan (includes PENDING, PARTIALLY_PAID, PAID, **and WAIVED**)
4. `incremental_months = total_months_owed - months_already_penalised`
5. If `incremental_months <= 0`: return "no new penalty needed"
6. `new_penalty_amount = principal_amount * interest_rate / 100 * incremental_months`
7. System presents calculated amount to admin; admin confirms or overrides
8. Create `penalties` record with `months_charged = incremental_months`

**Penalty Payment:**
- Transaction type `PENALTY` with `penalty_id` referencing the penalty
- If `penalty_id` omitted, system auto-selects oldest unpaid penalty
- On approval: increment `penalties.amount_collected`, update status:
  - `amount_collected == net_payable` -> `PAID`
  - `amount_collected > 0 && < net_payable` -> `PARTIALLY_PAID`

**Penalty Waiver:**
- Body: `{ waive_amount, notes }`
- Update `penalties.waived_amount += waive_amount`
- Recalculate `net_payable = penalty_amount - waived_amount`
- Update status: if `amount_collected >= net_payable` -> `PAID`; if full waiver -> `WAIVED`
- Create `PENALTY_WAIVER` transaction for audit

**Interest Waiver (Monthly):**
- Body: `{ effective_date, waive_amount, notes }`
- `effective_date` identifies the billing cycle
- Create `INTEREST_WAIVER` transaction
- No direct side effect on loan — settlement is computed on the fly

**Billing Cycle Settlement (computed, not stored):**
```
settled = SUM(INTEREST_PAYMENT for cycle) + SUM(INTEREST_WAIVER for cycle) >= interest_due
interest_due = billing_principal_for_that_cycle * interest_rate / 100
```

**Closure Update (Daily):**
- Add penalty check: all imposed penalties must be `PAID` or `WAIVED` before closure

### Acceptance Criteria

- [ ] Penalty auto-calculation: 45 days overdue, no prior penalties -> 2 months charged
- [ ] Stacking: 70 days overdue, 2 months already penalised -> 1 new month
- [ ] Stacking: 80 days overdue, 3 months already penalised -> 0 (no new penalty)
- [ ] Waived penalties count toward `months_already_penalised`
- [ ] Penalty payment updates `amount_collected` and status correctly
- [ ] Partial penalty payment: status = PARTIALLY_PAID
- [ ] Full penalty payment: status = PAID
- [ ] Penalty waiver: `waived_amount` increases, `net_payable` decreases
- [ ] Full waiver: status = WAIVED
- [ ] Interest waiver creates INTEREST_WAIVER transaction
- [ ] Billing cycle settlement computed from transactions (no stored flag)
- [ ] Partial interest waiver: cycle still unsettled if `payments + waivers < interest_due`
- [ ] Full interest waiver: cycle settled
- [ ] Daily loan closure blocked if penalties outstanding
- [ ] Monthly loan closure blocked if unsettled billing cycles exist
- [ ] Waivers are admin-only (collector gets 403)

### Technical Notes / Gotchas

- **Waived penalties still count** for incremental calculation. This prevents double-charging. If you impose 2 months, waive them, then re-impose, the system sees the 2 months already covered.
- **No stored "settled" flag** for billing cycles. Always compute from transactions. This avoids stale state but means settlement queries must be efficient.
- **Penalty payment via collector**: goes through approval flow (Phase 6). Side effects execute on approval.
- **Payment allocation** is explicit, not automatic. Admin specifies whether a payment is `PENALTY` or `DAILY_COLLECTION`. No auto-splitting between base loan and penalty.

---

## Phase 8: Defaults, Write-offs, Corrections & Cancellation

**Depends on**: Phase 6, Phase 7

### What Gets Built

- Loan default (marks borrower as defaulter)
- Loan write-off
- Guarantor payments against defaulted loans
- Corrective transactions (admin reversal of mistakes)
- Loan cancellation
- Guarantor warning on customer profile

### Endpoints

| Method | Endpoint | Role |
|--------|----------|------|
| PATCH | `/api/v1/loans/:id/default` | ADMIN |
| PATCH | `/api/v1/loans/:id/write-off` | ADMIN |
| PATCH | `/api/v1/loans/:id/cancel` | ADMIN |
| POST | `/api/v1/transactions` | ADMIN | Type: GUARANTOR_PAYMENT, or corrective (negative amount) |

### Business Logic

**Default (DB transaction):**
1. Validate loan status = `ACTIVE`
2. Set loan status = `DEFAULTED`, `defaulted_at = NOW()`, `defaulted_by = admin_id`
3. Set `customers.is_defaulter = true` for the borrower
4. If guarantor exists: guarantor's profile will show warning (computed query)
5. Increment loan `version`

**Write-Off:**
1. Validate loan status = `DEFAULTED`
2. Set loan status = `WRITTEN_OFF`, `written_off_at`, `written_off_by`

**Closing Defaulted Loans:**
1. Status = `DEFAULTED`, admin triggers close
2. No system-enforced recovery threshold — admin judgment
3. System shows outstanding amount to help admin decide
4. Set status = `CLOSED`, `closure_date`, `closed_by`
5. Does NOT auto-clear `is_defaulter` (admin does manually)

**Guarantor Payment:**
1. Transaction type `GUARANTOR_PAYMENT` on a `DEFAULTED` loan
2. On approval: increment `total_collected` (daily loans)
3. No effect on `remaining_principal` for monthly loans (loss is already locked in)

**Corrective Transaction (admin-only, DB transaction):**
1. Validate: `corrected_transaction_id` references an APPROVED transaction, same loan, same type
2. Validate: no existing correction for that transaction (one correction per original)
3. Amount is **negative** (only case where negative is allowed)
4. Auto-approved
5. Reversed side effects:
   - Corrective `PRINCIPAL_RETURN` (-X): increment `remaining_principal` by X, insert negative `principal_returns` record
   - Corrective `DAILY_COLLECTION` (-X): decrement `total_collected` by X
   - Corrective `GUARANTOR_PAYMENT` (-X): decrement `total_collected` by X (daily loans)
   - Corrective `PENALTY` (-X): decrement `penalties.amount_collected` by X, recalculate penalty status
   - Corrective `INTEREST_PAYMENT`: no loan-level side effect
6. Both original and corrective transactions remain in audit trail

**Cancellation:**
1. Validate: loan status = `ACTIVE`
2. Validate: no APPROVED transactions except DISBURSEMENT and ADVANCE_INTEREST
3. Validate: no PENDING transactions (admin must reject them first)
4. Set status = `CANCELLED`, `cancelled_at`, `cancelled_by`, `cancellation_reason`
5. Cancelled loans excluded from ALL financial calculations

### Acceptance Criteria

- [ ] Default sets loan to DEFAULTED, borrower to `is_defaulter = true`
- [ ] Default can happen on any ACTIVE loan at any time (no waiting period)
- [ ] Write-off only from DEFAULTED status
- [ ] Closing defaulted loan: no recovery threshold enforced
- [ ] Closing defaulted loan does NOT clear `is_defaulter`
- [ ] Guarantor payment accepted on DEFAULTED loans
- [ ] Guarantor warning appears on `GET /customers/:id` for guarantors of defaulted loans
- [ ] Corrective transaction: negative amount with `corrected_transaction_id`
- [ ] Corrective PRINCIPAL_RETURN restores `remaining_principal`
- [ ] Corrective DAILY_COLLECTION decreases `total_collected`
- [ ] Only one correction per original transaction
- [ ] Correction without `corrected_transaction_id` is rejected
- [ ] Cancellation: only ACTIVE loans with no approved payments (beyond disbursement)
- [ ] Cancellation: fails if PENDING transactions exist
- [ ] Cancellation: reason is required
- [ ] Cancelled loans excluded from fund calculations

### Technical Notes / Gotchas

- **Status transitions** are strictly enforced:
  - ACTIVE -> DEFAULTED, CLOSED, CANCELLED
  - DEFAULTED -> CLOSED, WRITTEN_OFF
  - No other transitions allowed
- **Corrective transactions** use the DB check constraint: `amount > 0 OR corrected_transaction_id IS NOT NULL`. Negative amounts without a correction link are rejected at DB level.
- **Cancellation race condition**: a collector might submit offline while the admin cancels. The stale data guard (Phase 6) rejects collector submissions for CANCELLED loans. If PENDING transactions exist, cancellation is blocked until admin rejects them.
- **Guarantor payment for monthly loans**: recorded as `GUARANTOR_PAYMENT` but does NOT decrement `remaining_principal` (the loss is the value of `remaining_principal` at default). The payment is tracked for reporting purposes only.

---

## Phase 9: Dashboard & Reports

**Depends on**: Phase 8

### What Gets Built

- Today's summary dashboard
- Overdue loans dashboard
- Defaulters dashboard
- Fund summary (capital overview with all financial metrics)
- P&L report (date range)
- Collector performance summary
- Loan book (full portfolio snapshot)
- Expenses CRUD
- Fund management (capital injections/withdrawals)

### Endpoints

| Method | Endpoint | Role |
|--------|----------|------|
| GET | `/api/v1/dashboard/today` | ADMIN |
| GET | `/api/v1/dashboard/overdue` | ADMIN |
| GET | `/api/v1/dashboard/defaulters` | ADMIN |
| GET | `/api/v1/dashboard/fund-summary` | ADMIN |
| GET | `/api/v1/reports/profit-loss?from=&to=` | ADMIN |
| GET | `/api/v1/reports/collector-summary?from=&to=` | ADMIN |
| GET | `/api/v1/reports/loan-book` | ADMIN |
| GET | `/api/v1/expenses` | ADMIN |
| POST | `/api/v1/expenses` | ADMIN |
| PUT | `/api/v1/expenses/:id` | ADMIN |
| PATCH | `/api/v1/expenses/:id/delete` | ADMIN |
| GET | `/api/v1/fund/entries` | ADMIN |
| POST | `/api/v1/fund/entries` | ADMIN |
| GET | `/api/v1/fund/summary` | ADMIN |
| GET | `/api/v1/fund/reconciliation` | ADMIN |

### Business Logic

**Today's Summary:**
- Active daily loan count
- Expected collections today (active daily loans within term, with amounts)
- Received collections today (approved DAILY_COLLECTION with `transaction_date = today`)
- Missed today (active daily loans within term, no approved collection today)
- Monthly interest due today (active monthly loans where today is due date of current cycle)
- Pending approvals count
- Total collected today (all approved money-in transactions)

**Overdue Loans:**
- Daily: `today > term_end_date + grace_days AND total_collected < total_repayment` (with days_overdue, remaining, guarantor, penalty applicable)
- Monthly: loans with unsettled past-due cycles (with months_overdue, interest_due, last payment)

**Defaulters:**
- All loans with status `DEFAULTED` or `WRITTEN_OFF`, with borrower details, guarantor info, outstanding amount

**Fund Summary (raw SQL via `prisma.$queryRaw`):**

| Metric | Calculation |
|--------|-------------|
| Total Capital Invested | `SUM(injections) - SUM(withdrawals)` from `fund_entries` |
| Money Deployed | Monthly: `SUM(remaining_principal)` of ACTIVE. Daily: `SUM(GREATEST(principal - total_collected, 0))` of ACTIVE |
| Money Lost to Defaults | `remaining_principal` (monthly) or `GREATEST(principal - total_collected, 0)` (daily) on DEFAULTED/WRITTEN_OFF, minus guarantor recoveries |
| Total Interest Earned | Monthly: `SUM(INTEREST_PAYMENT + ADVANCE_INTEREST)`. Daily: `SUM(GREATEST(total_collected - principal, 0))`. Plus penalties collected. |
| Total Expenses | `SUM(amount)` from expenses (where `is_deleted = false`) |
| Revenue Forgone | `SUM(INTEREST_WAIVER amounts) + SUM(penalties.waived_amount)` |
| Net Profit | Total Interest Earned - Money Lost to Defaults - Total Expenses |
| Cash in Hand | Capital invested - disbursements + all money-in collections - expenses. Excludes OPENING_BALANCE and waivers. |

**P&L Report:**
- Same metrics as fund summary but filtered to `from`/`to` date range on `transaction_date`
- For daily interest: only consider transactions within the date range

**Expenses:**
- Standard CRUD with soft-delete (`is_deleted`)
- Categories: TRAVEL, SALARY, OFFICE, LEGAL, MISC
- Filter by category and date range

**Fund Management:**
- Record INJECTION or WITHDRAWAL with amount, description, date
- List all entries

### Acceptance Criteria

- [ ] Today's summary shows correct expected/received/missed daily collections
- [ ] Today's summary shows monthly interest due today
- [ ] Overdue daily loans: correct `days_overdue` and remaining amount
- [ ] Overdue monthly loans: correct months overdue count
- [ ] Fund summary: all metrics match manual calculation
- [ ] Daily interest earned uses principal-first (zero until principal recovered)
- [ ] Cash in Hand excludes OPENING_BALANCE transactions
- [ ] Cash in Hand excludes waivers
- [ ] Cancelled loans excluded from all financial calculations
- [ ] P&L report filtered by date range
- [ ] Expenses CRUD with soft-delete works correctly
- [ ] Soft-deleted expenses excluded from totals
- [ ] Fund entries (inject/withdraw) correctly affect capital invested
- [ ] Dashboard queries use REPEATABLE READ isolation
- [ ] All dashboard/report queries use `prisma.$queryRaw` (not Prisma query API)
- [ ] Cash in Hand reconciliation: dual-method integration test passes with 50+ diverse transactions
- [ ] `GET /fund/reconciliation` returns matching `query_result` and `bottom_up_result`

### Technical Notes / Gotchas

- **All report/dashboard SQL** goes in `src/utils/sql/` as constants. These queries use `CASE WHEN`, `GREATEST`, `COALESCE`, subqueries, and cross-table aggregations that Prisma's query API cannot express.
- **REPEATABLE READ** isolation for dashboard aggregations to avoid inconsistent reads during concurrent writes.
- **Principal-first for daily interest**: `GREATEST(total_collected - principal_amount, 0)`. This means an active daily loan shows zero interest until total_collected exceeds principal.
- **Cash in Hand** is the most complex metric and the one most likely to drift over time due to edge cases (soft deletes, corrections, cancellations, migration exclusions). Mitigate with:
  1. **Dual-method reconciliation test**: Write an integration test that feeds the system ~50 diverse transactions (mix of daily collections, monthly interest, principal returns, corrections, waivers, opening balances, cancellations, expenses, fund entries) and computes Cash in Hand two ways:
     - **Bottom-up**: replay every money movement from raw data (fund entries - disbursements + collections - expenses, applying all exclusion rules manually)
     - **Query method**: the actual `prisma.$queryRaw` Cash in Hand query from `src/utils/sql/`
     - Both must produce the same result. This test acts as a regression safety net for any future changes to the query or the exclusion rules.
  2. **Reconciliation endpoint** (`GET /api/v1/fund/reconciliation`, admin-only): runs both methods and returns `{ query_result, bottom_up_result, matches: boolean }`. Use during QA and periodically in production to catch drift early.
- **Migrated daily loan interest**: fund summary includes lifetime earnings (even pre-migration). Date-range reports naturally exclude pre-migration because they filter by `transaction_date`.

---

## Phase 10: Migration (Day-One Import)

**Depends on**: Phase 8

### What Gets Built

- Monthly loan migration endpoint
- Daily loan migration endpoint
- Pre-existing penalty import for overdue migrated daily loans
- `is_migrated` flag handling
- Opening balance transactions (daily only)
- `last_interest_paid_through` support (monthly)

### Endpoints

| Method | Endpoint | Role |
|--------|----------|------|
| POST | `/api/v1/loans/migrate` | ADMIN |

### Business Logic

**Monthly Loan Migration:**
1. Admin provides: `principal_amount` (original), `remaining_principal` (current), `disbursement_date` (actual past date), `interest_rate`, `last_interest_paid_through`, `expected_months`, guarantor, collateral, notes
2. Generate loan number (same ML-{YEAR}-{SEQ} format)
3. Set `monthly_due_day` from `disbursement_date`
4. Set `billing_principal = remaining_principal` (both set to migrated value)
5. Set `is_migrated = true`, `last_interest_paid_through`
6. **No DISBURSEMENT transaction** (money was already given)
7. **No OPENING_BALANCE transaction** (state captured by `remaining_principal` + `last_interest_paid_through`)
8. All cycles up to `last_interest_paid_through` are considered settled without checking transactions
9. Next due cycle is the first one after `last_interest_paid_through`

**Daily Loan Migration:**
1. Admin provides: `principal_amount`, `interest_rate`, `term_days`, `grace_days`, `disbursement_date` (actual past date), `total_base_collected_so_far`, guarantor, collateral, notes, `pre_existing_penalties` (optional)
2. Compute: `total_repayment`, `daily_payment`, `term_end_date` (server-side)
3. Generate loan number
4. Set `is_migrated = true`, `total_collected = total_base_collected_so_far`
5. Create OPENING_BALANCE transaction for `total_base_collected_so_far`:
   - Counts toward loan-level tracking (total_collected, days_paid)
   - **Excluded from Cash in Hand** (money was collected before system existed)
6. If `pre_existing_penalties` provided: create `penalties` rows with given months_charged, amount, status
   - `PAID` status for penalties already collected before migration
   - `PENDING` for outstanding ones
   - This ensures incremental penalty auto-calculation works correctly going forward

**`total_base_collected_so_far` important note:**
- This is **base loan collections only** (daily installments toward principal + interest)
- **Do NOT include penalty payments** — penalty collections are tracked via `pre_existing_penalties` with status `PAID`
- Mixing penalty money here would skew principal-first profit calculation

### Acceptance Criteria

- [ ] Monthly migration: loan created with correct `remaining_principal`, `billing_principal`, `last_interest_paid_through`
- [ ] Monthly migration: no DISBURSEMENT or OPENING_BALANCE transaction created
- [ ] Monthly migration: cycles up to `last_interest_paid_through` skipped in overdue detection
- [ ] Monthly migration: next interest due computed from first cycle after `last_interest_paid_through`
- [ ] Daily migration: OPENING_BALANCE transaction created with correct amount
- [ ] Daily migration: `total_collected` set correctly
- [ ] Daily migration: OPENING_BALANCE excluded from Cash in Hand
- [ ] Daily migration: pre-existing penalties created as penalty records
- [ ] Daily migration: penalty auto-calculation accounts for pre-existing penalty months
- [ ] Migrated loans have `is_migrated = true`
- [ ] Migrated loans behave identically to native loans after import
- [ ] Fund summary includes migrated loan interest (lifetime, not just since migration)
- [ ] Reports can filter migrated vs native loans

### Technical Notes / Gotchas

- **Monthly migration is stateless** — no transactions needed because `remaining_principal` and `last_interest_paid_through` fully capture the loan state.
- **Daily migration interest recognition**: a migrated loan with Rs 1,10,000 collected on Rs 1,00,000 principal shows Rs 10,000 interest earned from day one. This is intentional (true financial position).
- **Pre-existing penalty `months_charged`**: admin must provide the correct value per penalty. The system doesn't back-calculate from dates since the history is unknown.
- **Date-range reports** naturally exclude pre-migration by filtering on `transaction_date`, which is set at import time (not the historical date).

---

## Phase 11: Platform Admin (Super Admin)

**Depends on**: Phase 2

### What Gets Built

- Tenant onboarding (create tenant + first admin account)
- Tenant listing and detail view
- Tenant suspension and reactivation
- Platform-wide statistics
- Super admin can NOT access any tenant's loan data

### Endpoints

| Method | Endpoint | Role |
|--------|----------|------|
| POST | `/api/v1/platform/tenants` | SUPER_ADMIN |
| GET | `/api/v1/platform/tenants` | SUPER_ADMIN |
| GET | `/api/v1/platform/tenants/:id` | SUPER_ADMIN |
| PATCH | `/api/v1/platform/tenants/:id/suspend` | SUPER_ADMIN |
| PATCH | `/api/v1/platform/tenants/:id/activate` | SUPER_ADMIN |
| GET | `/api/v1/platform/stats` | SUPER_ADMIN |

### Business Logic

**Tenant Onboarding:**
1. Create tenant: name, slug (unique), owner_name, owner_phone, owner_email, address
2. Create first admin user for the tenant: name, phone, initial password
3. Set tenant status = ACTIVE
4. Admin can then log in and set up their business

**Tenant Suspension:**
1. Set tenant status = SUSPENDED
2. All API calls for this tenant return 403 (enforced by tenant middleware)
3. No data is deleted — tenant can be reactivated

**Tenant Reactivation:**
1. Set tenant status = ACTIVE
2. Tenant users can access the system again

**Platform Stats:**
- Total tenant count (active, suspended, deactivated)
- Total loans across all tenants (aggregate counts by status)
- Total users across all tenants
- No access to individual tenant's financial data

### Acceptance Criteria

- [ ] Super admin can create a new tenant with admin account
- [ ] Tenant slug must be unique
- [ ] New tenant's admin can log in immediately
- [ ] Suspended tenant: all tenant-scoped API calls return 403
- [ ] Reactivated tenant: API access restored
- [ ] Platform stats return aggregate counts (not individual tenant data)
- [ ] Super admin cannot access `/api/v1/loans`, `/api/v1/customers`, etc.
- [ ] Tenant admin cannot access `/api/v1/platform/*` endpoints

### Technical Notes / Gotchas

- **Super admin has `tenant_id = NULL`** in the JWT. The tenant middleware must skip tenant validation for super admin routes.
- **Platform routes** must be registered on a separate path prefix (`/api/v1/platform/`) with `SUPER_ADMIN`-only role guard.
- **Slug generation**: suggest auto-generating from business name but allow admin to customize. Validate: lowercase, hyphens, alphanumeric only.
- **Suspension is immediate**: any in-flight requests will fail. This is acceptable — the admin of a suspended business should be notified outside the system.

---

## Phase 12: Hardening & Polish

**Depends on**: All previous phases

### What Gets Built

- Rate limiting per tenant
- Request logging (structured, not sensitive data)
- Input sanitization audit
- CORS configuration
- Swagger/OpenAPI documentation
- Performance optimization (query analysis, indexes)
- Edge case coverage
- Seed script for demo data
- Deployment configuration

### Deliverables

1. **Rate Limiting**
   - Per-tenant rate limiting (e.g., 100 req/min)
   - Per-IP rate limiting for auth endpoints (e.g., 10 login attempts / 5 min)

2. **Rounding Mode Audit**
   - Verify `Decimal.set({ rounding: Decimal.ROUND_HALF_UP })` is called exactly once at startup (Phase 0)
   - Grep the entire codebase for any `Math.round`, `Math.floor`, `Math.ceil`, `toFixed` on financial amounts — all are banned for money. Use `Decimal.js` methods instead.
   - Verify every financial calculation path (interest, penalty, auto-split, daily payment, total repayment) uses `Decimal` and not `number`
   - Test rounding edge cases explicitly:
     - Interest: `billing_principal=33333, rate=3%` -> `999.99` (HALF_UP), not `999.99` (FLOOR) or `1000.00` (CEIL)
     - Daily payment: `total_repayment=120001, term_days=120` -> `1000.01` (the extra paisa is correct; rounding doesn't eat it)
     - Auto-split: `amount=5000.01, interest_due=2000` -> INTEREST_PAYMENT=`2000.00`, PRINCIPAL_RETURN=`3000.01` (no rounding loss)

3. **Security Audit**
   - Verify all financial amounts use `DECIMAL`, never float
   - Verify all DB queries include `tenant_id` scope
   - Verify file uploads served via authenticated endpoints
   - Verify no SQL injection vectors (Prisma parameterizes, but check `$queryRaw` calls)
   - Verify JWT secrets are strong and configurable
   - Verify passwords are never logged or returned in responses

4. **API Documentation**
   - Swagger/OpenAPI spec generated from route definitions
   - All endpoints documented with request/response schemas
   - Error codes documented

5. **Performance**
   - Analyze slow queries with `EXPLAIN ANALYZE`
   - Verify all dashboard/report queries use appropriate indexes
   - Add database connection pooling config
   - Verify `total_collected` cache stays in sync (add reconciliation check)

6. **Edge Cases**
   - Concurrent loan creation: no duplicate loan numbers
   - Concurrent approval: no double side effects
   - Leap year handling in due date computation
   - Loans spanning year boundaries (loan number sequences)
   - Short month bounce-back (monthly_due_day = 31 in February)
   - Migrated loan with zero remaining principal

7. **Deployment**
   - Dockerfile
   - docker-compose (app + PostgreSQL)
   - Environment variable documentation
   - Database backup/restore notes

### Acceptance Criteria

- [ ] Rate limiting enforced and returns 429 on excess
- [ ] All `$queryRaw` calls use parameterized queries (no string interpolation)
- [ ] Swagger UI accessible at `/api-docs`
- [ ] All endpoints have OpenAPI documentation
- [ ] No floating-point arithmetic on financial amounts anywhere in codebase
- [ ] No `Math.round`, `Math.floor`, `Math.ceil`, or `.toFixed()` used on money values
- [ ] `ROUND_HALF_UP` verified for interest, penalty, auto-split, and daily payment edge cases
- [ ] Leap year: Feb 29 due date in 2028 works correctly
- [ ] `docker compose up` starts the full stack
- [ ] Seed script creates demo data for manual testing
- [ ] No sensitive data (passwords, tokens) in logs or error responses

---

## Testing Strategy

### Per-Phase Testing

Each phase must have both **unit** and **integration** tests before moving to the next phase.

| Test Type | What It Covers | Tools |
|-----------|---------------|-------|
| Unit tests | Business logic in services and utils (date computation, penalty calculation, auto-split, etc.) | Jest |
| Integration tests | API endpoints hitting a real test database. Full request -> response validation. | Jest + Supertest + test PostgreSQL |
| Edge case tests | Boundary conditions (zero amounts, max values, concurrent operations) | Jest |

### Test Database Setup

- Separate test database (e.g., `loantrack_test`)
- `beforeEach`: start DB transaction
- `afterEach`: rollback transaction (fast, isolated)
- Test factories for creating tenants, users, customers, loans with sensible defaults

### Critical Paths to Test

These business flows have the highest risk and must have thorough integration test coverage:

1. **Monthly interest overpayment auto-split** — exact amounts, correct transaction types
2. **Billing principal lifecycle** — mid-cycle return doesn't affect current cycle interest
3. **Penalty incremental stacking** — all status combinations (including WAIVED)
4. **Collector approval flow** — PENDING -> APPROVED with correct side effects
5. **Corrective transactions** — negative amounts, reversed side effects, one-per-original
6. **Concurrent operations** — parallel principal returns, parallel approvals
7. **Cash in Hand dual-method reconciliation** — feed 50+ diverse transactions (collections, corrections, waivers, opening balances, cancellations, expenses, fund entries) and verify the SQL query result matches a bottom-up replay of every money movement. This is the single most important financial integrity test.
8. **Fund summary math** — verify each metric against manual calculation with known data
9. **Loan closure validation** — all conditions checked (principal, interest cycles, penalties)
10. **Migration** — migrated loans behave identically to native loans post-import

### Test Data Patterns

Maintain a set of standard test scenarios:

- **Monthly loan**: Rs 1,00,000 at 2%, due day 15th, with 3 cycles of payments
- **Daily loan**: Rs 1,00,000 at 5% for 120 days (Rs 1,000/day)
- **Overdue daily loan**: 45 days past grace, with stacked penalties
- **Defaulted loan with guarantor**: partial recovery
- **Migrated monthly loan**: Rs 70,000 remaining, last_interest_paid_through set
- **Migrated daily loan**: Rs 35,000 collected, with pre-existing penalties

---

## Summary Table

| Phase | Name | Depends On | Can Parallel With |
|-------|------|------------|-------------------|
| 0 | Project Scaffolding & Infrastructure | — | — |
| 1 | Database Schema & Migrations | 0 | — |
| 2 | Auth & Multi-Tenancy Foundation | 1 | — |
| 3 | Customer Management | 2 | 11 |
| 4 | Monthly Loans (Core) | 3 | 5, 11 |
| 5 | Daily Loans (Core) | 3 | 4, 11 |
| 6 | Collector Workflow & Approvals | 4, 5 | — |
| 7 | Penalties & Waivers | 4, 5 | — |
| 8 | Defaults, Write-offs, Corrections & Cancellation | 6, 7 | — |
| 9 | Dashboard & Reports | 8 | — |
| 10 | Migration (Day-One Import) | 8 | — |
| 11 | Platform Admin (Super Admin) | 2 | 3-10 |
| 12 | Hardening & Polish | all | — |
