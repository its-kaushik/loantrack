# LoanTrack API - Technical Specification

> Business rules, calculations, and flows are in **BRD.md**. This document covers how the system is built.

---

## 1. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Runtime | Node.js (LTS) | JS ecosystem, async I/O for API server |
| Framework | Express.js or NestJS | Express for simplicity, NestJS if you want structure/DI |
| Language | TypeScript | Type safety for financial calculations |
| Database | PostgreSQL | ACID compliance essential for financial transactions, strong relational model |
| ORM | Prisma | Type-safe queries, excellent migrations, good DX |
| Auth | JWT (access + refresh tokens) | Stateless auth, works well for API |
| File Storage | Local disk (start), S3-compatible later | For ID proofs and photos |
| Validation | Zod or Joi | Request body validation |
| API Docs | Swagger/OpenAPI | Auto-generated from route definitions |

---

## 2. Multi-Tenancy Architecture

### Isolation Strategy

**Row-level isolation** with a `tenant_id` column on every data table.

- Every query is automatically scoped by `tenant_id` via Prisma middleware or a base repository class
- Composite unique constraints include `tenant_id` (e.g., Aadhaar is unique *per tenant*, not globally)
- All indexes include `tenant_id` as a leading column for query performance
- `tenant_id` is extracted from the JWT - **never** accepted from the client
- No cross-tenant joins or queries are ever permitted
- Foreign key references (e.g., loan.borrower_id) are validated to belong to the same tenant at the application layer
- File uploads stored in tenant-scoped paths: `uploads/{tenant_id}/...`
- If a tenant is suspended, all API calls for that tenant return 403

---

## 3. Database Schema

### 3.1 `tenants`

Each row represents one loan business using the platform.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | UUID | PK | |
| name | VARCHAR(200) | NOT NULL | Business name |
| slug | VARCHAR(50) | UNIQUE, NOT NULL | URL-friendly identifier (e.g., "sharma-finance") |
| owner_name | VARCHAR(200) | NOT NULL | Primary contact name |
| owner_phone | VARCHAR(15) | NOT NULL | |
| owner_email | VARCHAR(255) | NULLABLE | |
| address | TEXT | NULLABLE | Business address |
| status | ENUM('ACTIVE','SUSPENDED','DEACTIVATED') | DEFAULT 'ACTIVE' | |
| subscription_plan | VARCHAR(50) | NULLABLE | For future billing tiers |
| settings | JSONB | DEFAULT '{}' | Tenant-specific config (default interest rates, grace days, etc.) |
| created_at | TIMESTAMP | DEFAULT now() | |
| updated_at | TIMESTAMP | DEFAULT now() | |

---

### 3.2 `users`

App users. Super admins are platform-level (tenant_id = NULL). Admin and Collector are tenant-scoped.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | FK -> tenants.id, NULLABLE | NULL for SUPER_ADMIN |
| name | VARCHAR(100) | NOT NULL | |
| phone | VARCHAR(15) | NOT NULL | |
| email | VARCHAR(255) | NULLABLE | |
| password_hash | VARCHAR(255) | NOT NULL | |
| role | ENUM('SUPER_ADMIN','ADMIN','COLLECTOR') | NOT NULL | |
| is_active | BOOLEAN | DEFAULT true | Soft disable |
| created_at | TIMESTAMP | DEFAULT now() | |
| updated_at | TIMESTAMP | DEFAULT now() | |

**Unique Indexes**:
- `UNIQUE(tenant_id, phone) WHERE tenant_id IS NOT NULL` - phone unique within a tenant
- `UNIQUE(phone) WHERE tenant_id IS NULL` - phone unique among super admins

**Index**: `tenant_id`

---

### 3.3 `customers`

All people a tenant interacts with - borrowers AND guarantors.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | FK -> tenants.id, NOT NULL | |
| full_name | VARCHAR(200) | NOT NULL | |
| phone | VARCHAR(15) | NOT NULL | May not be unique (family members sharing numbers) |
| alternate_phone | VARCHAR(15) | NULLABLE | |
| address | TEXT | NULLABLE | May not be available immediately (e.g., guarantor added quickly) |
| aadhaar_number | VARCHAR(12) | NULLABLE | |
| pan_number | VARCHAR(10) | NULLABLE | |
| id_proof_type | VARCHAR(50) | NULLABLE | e.g., "Aadhaar", "PAN", "Voter ID", "Driving License" |
| id_proof_document_url | VARCHAR(500) | NULLABLE | Path/URL to uploaded document scan |
| photo_url | VARCHAR(500) | NULLABLE | Path/URL to customer photo |
| occupation | VARCHAR(200) | NULLABLE | |
| notes | TEXT | NULLABLE | Free-text notes |
| is_defaulter | BOOLEAN | DEFAULT false | Auto-set when loan is defaulted; admin can manually clear |
| created_by | UUID | FK -> users.id | |
| created_at | TIMESTAMP | DEFAULT now() | |
| updated_at | TIMESTAMP | DEFAULT now() | |

**Unique**: `(tenant_id, aadhaar_number)`, `(tenant_id, pan_number)`
**Index**: `(tenant_id, phone)`, `(tenant_id, is_defaulter)`

---

### 3.4 `loans`

Core table. One row per loan.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | FK -> tenants.id, NOT NULL | |
| loan_number | VARCHAR(20) | NOT NULL | Auto-generated human-readable ID |
| borrower_id | UUID | FK -> customers.id, NOT NULL | |
| loan_type | ENUM('MONTHLY','DAILY') | NOT NULL | |
| principal_amount | DECIMAL(12,2) | NOT NULL | Original principal |
| interest_rate | DECIMAL(5,2) | NOT NULL | Monthly interest rate in % |
| disbursement_date | DATE | NOT NULL | Date money was given |
| **Monthly loan fields** | | | |
| expected_months | INTEGER | NULLABLE | Informational only |
| monthly_due_day | INTEGER | NULLABLE | Day of month payment is due (from disbursement_date) |
| remaining_principal | DECIMAL(12,2) | NULLABLE | Current outstanding principal. Updated immediately on approval of PRINCIPAL_RETURN. |
| billing_principal | DECIMAL(12,2) | NULLABLE | The principal used for calculating the **current** billing cycle's interest. Updated only at billing cycle boundaries (when a due date passes), not mid-cycle. See Section 8 "Billing Principal Lifecycle". |
| advance_interest_amount | DECIMAL(12,2) | NULLABLE | First month's interest collected at disbursement |
| last_interest_paid_through | DATE | NULLABLE | For migrated loans: all billing cycles up to this date are considered settled. NULL for native loans. |
| **Daily loan fields** | | | |
| term_days | INTEGER | NULLABLE | 120, 60, etc. |
| total_repayment_amount | DECIMAL(12,2) | NULLABLE | Principal + total interest for the term |
| daily_payment_amount | DECIMAL(12,2) | NULLABLE | total_repayment / term_days |
| term_end_date | DATE | NULLABLE | disbursement_date + term_days |
| grace_days | INTEGER | DEFAULT 7 | Extra days allowed after term ends |
| total_collected | DECIMAL(12,2) | DEFAULT 0 | Cached sum of approved collections. Updated atomically on each approved DAILY_COLLECTION, GUARANTOR_PAYMENT, or OPENING_BALANCE. Avoids scanning transactions table for daily loan queries. |
| **Common fields** | | | |
| status | ENUM('ACTIVE','CLOSED','DEFAULTED','WRITTEN_OFF','CANCELLED') | DEFAULT 'ACTIVE' | |
| guarantor_id | UUID | FK -> customers.id, NULLABLE | |
| collateral_description | TEXT | NULLABLE | |
| collateral_estimated_value | DECIMAL(12,2) | NULLABLE | |
| closure_date | DATE | NULLABLE | Date loan was fully settled |
| is_migrated | BOOLEAN | DEFAULT false | True for loans imported before the system existed |
| notes | TEXT | NULLABLE | |
| cancellation_reason | TEXT | NULLABLE | Required when status set to CANCELLED |
| defaulted_at | TIMESTAMP | NULLABLE | When admin marked the loan as defaulted |
| defaulted_by | UUID | FK -> users.id, NULLABLE | Admin who marked the loan as defaulted |
| cancelled_at | TIMESTAMP | NULLABLE | When admin cancelled the loan |
| cancelled_by | UUID | FK -> users.id, NULLABLE | Admin who cancelled the loan |
| written_off_at | TIMESTAMP | NULLABLE | When admin wrote off the loan |
| written_off_by | UUID | FK -> users.id, NULLABLE | Admin who wrote off the loan |
| closed_by | UUID | FK -> users.id, NULLABLE | Admin who closed the loan |
| version | INTEGER | DEFAULT 1 | Optimistic locking — incremented on every state change |
| created_by | UUID | FK -> users.id | |
| created_at | TIMESTAMP | DEFAULT now() | |
| updated_at | TIMESTAMP | DEFAULT now() | |

**Unique**: `(tenant_id, loan_number)`
**Indexes**: `(tenant_id, borrower_id)`, `(tenant_id, guarantor_id)`, `(tenant_id, status)`, `(tenant_id, loan_type)`, `(tenant_id, term_end_date)`, `(tenant_id, disbursement_date)`

**Check Constraints:**
- `CONSTRAINT check_remaining_principal_non_negative CHECK (remaining_principal IS NULL OR remaining_principal >= 0)` — if a race condition bypasses optimistic locking, the DB throws a hard error rather than allowing a negative balance.
- `CONSTRAINT check_billing_principal_non_negative CHECK (billing_principal IS NULL OR billing_principal >= 0)` — same safety net for the billing cycle principal.
- `CONSTRAINT check_total_collected_non_negative CHECK (total_collected >= 0)` — same safety net for daily loan collections.

**Loan Number Generation:**
- Format: `{TYPE_PREFIX}-{YEAR}-{SEQUENCE}` (e.g., "ML-2026-0042", "DL-2026-0183")
- `TYPE_PREFIX`: "ML" for monthly, "DL" for daily
- `YEAR`: 4-digit disbursement year
- `SEQUENCE`: Auto-incrementing per tenant, per year, per type. Padded to 4 digits.
- Generated server-side. Uses a `loan_number_sequences` counter table or PostgreSQL sequence per tenant.

**Status Transitions:**
```
ACTIVE -> CLOSED       (fully repaid)
ACTIVE -> DEFAULTED    (borrower absconded)
ACTIVE -> CANCELLED    (admin error - only if no approved payments beyond initial disbursement/advance interest)
DEFAULTED -> CLOSED    (recovered via guarantor)
DEFAULTED -> WRITTEN_OFF (unrecoverable loss)
```

---

### 3.5 `transactions`

Every money movement. Single source of truth.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | FK -> tenants.id, NOT NULL | |
| loan_id | UUID | FK -> loans.id, NOT NULL | |
| penalty_id | UUID | FK -> penalties.id, NULLABLE | Only for PENALTY and PENALTY_WAIVER types |
| corrected_transaction_id | UUID | FK -> transactions.id, NULLABLE | Only for corrective transactions — references the original transaction being reversed |
| transaction_type | ENUM (see below) | NOT NULL | |
| amount | DECIMAL(12,2) | NOT NULL | Positive for normal transactions. **Negative for corrective transactions only** (admin reversal of a mistake — see Section 8 "Corrective Transactions"). |
| transaction_date | DATE | NOT NULL | Actual date money changed hands |
| effective_date | DATE | NULLABLE | Monthly: which billing cycle. Daily: not used. |
| collected_by | UUID | FK -> users.id, NULLABLE | Collector who received the money |
| approval_status | ENUM('PENDING','APPROVED','REJECTED') | DEFAULT 'APPROVED' | Collector submissions start as PENDING |
| approved_by | UUID | FK -> users.id, NULLABLE | Admin who approved |
| approved_at | TIMESTAMP | NULLABLE | |
| rejection_reason | TEXT | NULLABLE | |
| notes | TEXT | NULLABLE | |
| created_at | TIMESTAMP | DEFAULT now() | |
| updated_at | TIMESTAMP | DEFAULT now() | |

**Transaction Types:**

| Type | Direction | Description |
|---|---|---|
| `DISBURSEMENT` | Money Out | Principal given to borrower |
| `ADVANCE_INTEREST` | Money In | First month's interest at disbursement (monthly loans) |
| `INTEREST_PAYMENT` | Money In | Monthly interest payment |
| `PRINCIPAL_RETURN` | Money In | Partial or full principal return (monthly loans) |
| `DAILY_COLLECTION` | Money In | Daily installment payment |
| `PENALTY` | Money In | Late penalty collected |
| `GUARANTOR_PAYMENT` | Money In | Guarantor paying on behalf of defaulter |
| `INTEREST_WAIVER` | Waiver | Interest forgiven (monthly loans) |
| `PENALTY_WAIVER` | Waiver | Penalty forgiven (daily loans) |
| `OPENING_BALANCE` | Migration | Pre-existing collections at migration time |

**Indexes**: `(tenant_id, loan_id)`, `(tenant_id, transaction_date)`, `(tenant_id, transaction_type)`, `(tenant_id, approval_status)`, `(tenant_id, collected_by)`

**Check Constraints:**
- `CONSTRAINT check_txn_amount CHECK (amount > 0 OR corrected_transaction_id IS NOT NULL)` — prevents accidental negative amounts without an explicit correction link. Last-mile DB safety net regardless of application logic.

---

### 3.6 `principal_returns`

History of partial principal returns for monthly loans.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | FK -> tenants.id, NOT NULL | |
| loan_id | UUID | FK -> loans.id | |
| transaction_id | UUID | FK -> transactions.id | Links to the PRINCIPAL_RETURN transaction |
| amount_returned | DECIMAL(12,2) | NOT NULL | |
| remaining_principal_after | DECIMAL(12,2) | NOT NULL | Snapshot after this return |
| return_date | DATE | NOT NULL | |
| notes | TEXT | NULLABLE | |
| created_by | UUID | FK -> users.id | User who processed this return |
| created_at | TIMESTAMP | DEFAULT now() | |

---

### 3.7 `penalties`

Penalty records for overdue daily loans.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | FK -> tenants.id, NOT NULL | |
| loan_id | UUID | FK -> loans.id | |
| days_overdue | INTEGER | NOT NULL | Days past the grace period |
| months_charged | INTEGER | NOT NULL | **Incremental** months charged by this penalty. For the first penalty this equals `CEIL(days_overdue / 30)`. For stacked penalties, this is the incremental value: `CEIL(current_days_overdue / 30) - SUM(months_charged from prior penalties)`. |
| penalty_amount | DECIMAL(12,2) | NOT NULL | Full penalty amount |
| waived_amount | DECIMAL(12,2) | DEFAULT 0 | Portion forgiven |
| net_payable | DECIMAL(12,2) | NOT NULL | penalty_amount - waived_amount |
| imposed_date | DATE | NOT NULL | |
| status | ENUM('PENDING','PARTIALLY_PAID','PAID','WAIVED') | DEFAULT 'PENDING' | |
| amount_collected | DECIMAL(12,2) | DEFAULT 0 | Paid so far |
| notes | TEXT | NULLABLE | |
| created_by | UUID | FK -> users.id | Admin who imposed this penalty |
| created_at | TIMESTAMP | DEFAULT now() | |
| updated_at | TIMESTAMP | DEFAULT now() | |

---

### 3.8 `expenses`

Business operational expenses.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | FK -> tenants.id, NOT NULL | |
| category | ENUM('TRAVEL','SALARY','OFFICE','LEGAL','MISC') | NOT NULL | |
| amount | DECIMAL(12,2) | NOT NULL | |
| description | TEXT | NULLABLE | |
| expense_date | DATE | NOT NULL | |
| is_deleted | BOOLEAN | DEFAULT false | Soft-delete. Financial records are never hard-deleted. |
| created_by | UUID | FK -> users.id | |
| created_at | TIMESTAMP | DEFAULT now() | |
| updated_at | TIMESTAMP | DEFAULT now() | |

---

### 3.9 `fund_entries`

Capital injections and withdrawals.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | UUID | PK | |
| tenant_id | UUID | FK -> tenants.id, NOT NULL | |
| entry_type | ENUM('INJECTION','WITHDRAWAL') | NOT NULL | |
| amount | DECIMAL(12,2) | NOT NULL | |
| description | TEXT | NULLABLE | |
| entry_date | DATE | NOT NULL | |
| created_by | UUID | FK -> users.id | |
| created_at | TIMESTAMP | DEFAULT now() | |

---

### 3.10 `refresh_tokens`

Server-side storage for JWT refresh tokens. Enables logout, token rotation, and session revocation.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| id | UUID | PK | |
| user_id | UUID | FK -> users.id, NOT NULL | |
| token_hash | VARCHAR(255) | NOT NULL | SHA-256 hash of the refresh token (never store raw) |
| expires_at | TIMESTAMP | NOT NULL | 7 days from creation |
| is_revoked | BOOLEAN | DEFAULT false | Set to true on logout or token rotation |
| created_at | TIMESTAMP | DEFAULT now() | |

**Index**: `(user_id)`, `(token_hash)`

On login: create a new refresh_token row, return the raw token to client.
On refresh: validate token_hash + not revoked + not expired → issue new access token + new refresh token, revoke old one (rotation).
On logout: revoke all refresh tokens for the user.
On user deactivation: revoke all refresh tokens for the user.

---

### 3.11 `loan_number_sequences`

Counter table for generating human-readable loan numbers.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| tenant_id | UUID | FK -> tenants.id, NOT NULL | |
| year | INTEGER | NOT NULL | 4-digit year |
| loan_type | ENUM('MONTHLY','DAILY') | NOT NULL | |
| current_value | INTEGER | DEFAULT 0 | Last used sequence number |

**Primary Key**: `(tenant_id, year, loan_type)`

Accessed via `SELECT ... FOR UPDATE` during loan creation to prevent duplicate numbers.

---

## 4. Entity Relationship Diagram

```
tenants (1) ----< (many) users              [tenant_id]
tenants (1) ----< (many) customers          [tenant_id]
tenants (1) ----< (many) loans              [tenant_id]
tenants (1) ----< (many) transactions       [tenant_id]
tenants (1) ----< (many) principal_returns  [tenant_id]
tenants (1) ----< (many) penalties          [tenant_id]
tenants (1) ----< (many) expenses           [tenant_id]
tenants (1) ----< (many) fund_entries       [tenant_id]
tenants (1) ----< (many) loan_number_sequences [tenant_id]

users (1) ----< (many) loans               [created_by]
users (1) ----< (many) transactions        [collected_by, approved_by]
users (1) ----< (many) expenses            [created_by]
users (1) ----< (many) refresh_tokens      [user_id]

customers (1) ----< (many) loans           [borrower_id]
customers (1) ----< (many) loans           [guarantor_id]

loans (1) ----< (many) transactions
loans (1) ----< (many) principal_returns
loans (1) ----< (many) penalties

penalties (1) ----< (many) transactions     [penalty_id - PENALTY and PENALTY_WAIVER types]
transactions (1) ----< (1) transactions     [corrected_transaction_id - corrective txn references original]

users (1) ----< (many) loans              [defaulted_by, cancelled_by, written_off_by, closed_by]

idempotency_keys              [tenant_id, user_id - for bulk submission replay protection]

All data tables (except tenants and idempotency_keys) include tenant_id.
Every query is scoped to the authenticated user's tenant.
```

---

## 5. API Design

### 5.1 Conventions

**Pagination** - All list endpoints:
- Query params: `page` (default: 1), `limit` (default: 50, max: 100)
- Response:
```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total_count": 342,
    "total_pages": 7
  }
}
```

**Error Response** - All errors follow this format:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Amount exceeds remaining principal",
    "details": []
  }
}
```

Standard error codes:
| Code | HTTP Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Invalid request body, missing fields, business rule violation |
| `UNAUTHORIZED` | 401 | Missing or expired token |
| `FORBIDDEN` | 403 | Insufficient role, suspended tenant, wrong tenant |
| `NOT_FOUND` | 404 | Resource doesn't exist (within tenant scope) |
| `CONFLICT` | 409 | Optimistic locking failure, duplicate entry, invalid state transition |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

**Tenant Scoping** - All tenant-level endpoints are automatically scoped. `tenant_id` is extracted from the JWT, never from the client.

**Middleware chain:**
```
1. Auth middleware      -> Verify JWT, extract user_id, tenant_id, role
2. Tenant middleware    -> Inject tenant_id into request context, check tenant is ACTIVE
3. Role middleware      -> Check if user's role has access to this route
4. Route handler        -> All DB queries use req.tenantId
```

---

### 5.2 Platform Admin (SUPER_ADMIN only)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/platform/tenants` | Onboard new tenant + first admin user |
| GET | `/api/v1/platform/tenants` | List all tenants |
| GET | `/api/v1/platform/tenants/:id` | Tenant details + summary stats |
| PATCH | `/api/v1/platform/tenants/:id/suspend` | Suspend a tenant |
| PATCH | `/api/v1/platform/tenants/:id/activate` | Reactivate a tenant |
| GET | `/api/v1/platform/stats` | Platform-wide stats |

---

### 5.3 Authentication

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/auth/login` | Phone + password -> access token + refresh token |
| POST | `/api/v1/auth/refresh` | Exchange refresh token for new access + refresh token (rotation) |
| POST | `/api/v1/auth/logout` | Revoke all refresh tokens for the user |
| PATCH | `/api/v1/auth/change-password` | Change own password (requires current password) |
| GET | `/api/v1/auth/me` | Current user profile + tenant info |

**Login response:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "uuid-v4-token",
  "expires_in": 900,
  "user": { "id": "uuid", "name": "...", "role": "ADMIN", "tenant_id": "uuid" }
}
```
- Access token: JWT with `{ user_id, tenant_id, role }`, expires in 15 minutes
- Refresh token: opaque UUID stored as SHA-256 hash in `refresh_tokens` table, expires in 7 days

**Initial password setup:** When a tenant is onboarded or a collector account is created, the admin sets an initial password. The user changes it on first login via `change-password`.

---

### 5.4 Users (Tenant Admin only)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/users` | List all users in tenant |
| POST | `/api/v1/users` | Create collector account |
| PUT | `/api/v1/users/:id` | Update user |
| PATCH | `/api/v1/users/:id/deactivate` | Deactivate a collector (also revokes their refresh tokens) |
| POST | `/api/v1/users/:id/reset-password` | Admin resets a user's password |

---

### 5.5 Customers

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/customers` | List. Filters: `search`, `is_defaulter` |
| GET | `/api/v1/customers/:id` | Detail with loan summary |
| POST | `/api/v1/customers` | Create |
| PUT | `/api/v1/customers/:id` | Update |
| GET | `/api/v1/customers/:id/loans` | All loans for customer |
| PATCH | `/api/v1/customers/:id/clear-defaulter` | Clear defaulter flag (admin only) |
| POST | `/api/v1/customers/:id/upload-photo` | Upload photo |
| POST | `/api/v1/customers/:id/upload-id-proof` | Upload ID proof |

---

### 5.6 Loans

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/loans` | List. Filters: `type`, `status`, `borrower_id`, `overdue` |
| GET | `/api/v1/loans/:id` | Full detail with computed fields |
| POST | `/api/v1/loans` | Create and disburse new loan |
| POST | `/api/v1/loans/migrate` | Import pre-existing loan (admin only). See migration request body below. |
| PATCH | `/api/v1/loans/:id/close` | Close loan. ACTIVE: validates fully repaid + settled. DEFAULTED: no threshold enforced (admin judgment). |
| PATCH | `/api/v1/loans/:id/default` | Mark defaulted |
| PATCH | `/api/v1/loans/:id/write-off` | Write off defaulted loan |
| PATCH | `/api/v1/loans/:id/cancel` | Cancel mistaken loan (admin, no payments beyond disbursement) |
| GET | `/api/v1/loans/:id/transactions` | All transactions for loan |
| GET | `/api/v1/loans/:id/payment-status` | Day-by-day / month-by-month status |

**Computed fields on GET /api/v1/loans/:id:**

Monthly loans:
- `remaining_principal`, `monthly_interest_due`, `next_due_date`, `is_overdue`, `total_interest_collected`, `months_active`

Daily loans:
- `total_collected`, `total_remaining`, `days_paid` (= `FLOOR(total_collected / daily_payment_amount)`), `days_remaining`, `days_elapsed`, `is_overdue`, `days_overdue`, `penalty_amount`, `is_base_paid`

**Migration request body (`POST /api/v1/loans/migrate`):**

Monthly loan:
```json
{
  "loan_type": "MONTHLY",
  "borrower_id": "uuid",
  "principal_amount": 100000,
  "interest_rate": 5,
  "disbursement_date": "2025-11-15",
  "expected_months": 12,
  "remaining_principal": 70000,
  "last_interest_paid_through": "2026-02-15",
  "guarantor_id": "uuid (optional)",
  "collateral_description": "optional",
  "collateral_estimated_value": 50000,
  "notes": "optional"
}
```
- No transactions are created. State is captured by `remaining_principal` and `last_interest_paid_through`.
- `monthly_due_day` is derived from `disbursement_date`.

Daily loan:
```json
{
  "loan_type": "DAILY",
  "borrower_id": "uuid",
  "principal_amount": 100000,
  "interest_rate": 5,
  "term_days": 120,
  "grace_days": 7,
  "disbursement_date": "2025-12-20",
  "total_base_collected_so_far": 35000,
  "guarantor_id": "uuid (optional)",
  "collateral_description": "optional",
  "collateral_estimated_value": 50000,
  "notes": "optional",
  "pre_existing_penalties": [
    { "days_overdue": 45, "months_charged": 2, "penalty_amount": 10000, "status": "PENDING" }
  ]
}
```
- `total_base_collected_so_far`: **Base loan collections only** — payments toward the daily installments (principal + interest). **Do NOT include penalty payments** in this number. Penalty collections are tracked separately via `pre_existing_penalties` with status `PAID`. Mixing penalty money here would skew the principal-first profit calculation (the system would treat penalty revenue as principal recovery).
- An OPENING_BALANCE transaction is created for `total_base_collected_so_far` (excluded from Cash in Hand).
- `total_repayment_amount`, `daily_payment_amount`, and `term_end_date` are computed server-side from inputs.
- `pre_existing_penalties` is optional — only needed for overdue migrated loans. Each entry creates a `penalties` row so incremental penalty auto-calculation works correctly. Use status `PAID` for penalties already collected before migration, `PENDING` for outstanding ones.

---

### 5.7 Transactions / Payments

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/transactions` | Record a payment |
| POST | `/api/v1/transactions/bulk` | Record multiple daily collections in one request |
| GET | `/api/v1/transactions` | List. Filters: `loan_id`, `date`, `type`, `approval_status`, `collected_by` |
| GET | `/api/v1/transactions/pending` | All pending approvals (admin) |
| PATCH | `/api/v1/transactions/:id/approve` | Approve pending payment (admin) |
| PATCH | `/api/v1/transactions/:id/reject` | Reject pending payment with reason (admin) |

**Single payment POST body:**
```json
{
  "loan_id": "uuid",
  "amount": 1000,
  "transaction_type": "DAILY_COLLECTION",
  "transaction_date": "2026-01-30",
  "penalty_id": "uuid (optional — required for PENALTY type)",
  "effective_date": "2026-01-15 (optional — billing cycle date for INTEREST_PAYMENT)",
  "notes": "optional"
}
```
- `transaction_type`: Required. One of: `INTEREST_PAYMENT`, `PRINCIPAL_RETURN`, `DAILY_COLLECTION`, `PENALTY`, `GUARANTOR_PAYMENT`
- `penalty_id`: Required when `transaction_type = PENALTY`. If omitted, system auto-selects the oldest unpaid penalty for the loan.
- `effective_date`: Required when `transaction_type = INTEREST_PAYMENT` (identifies the billing cycle).
- Admin: auto-approved. Collector: PENDING.

**Loan status validation on payment submission:**
- `ACTIVE` loans: accepted.
- `DEFAULTED` loans: accepted (recovery/guarantor payments are valid).
- `CANCELLED` loans: **rejected** (400 — cancelled loans are treated as if they never existed).
- `CLOSED` / `WRITTEN_OFF` loans: **rejected** (400 — finalized loans accept no further payments).

**Corrective transaction POST body (admin only):**
```json
{
  "loan_id": "uuid",
  "amount": -1000,
  "transaction_type": "DAILY_COLLECTION",
  "transaction_date": "2026-01-30",
  "corrected_transaction_id": "uuid (required — the original transaction being reversed)",
  "notes": "Correction: wrong amount recorded"
}
```
- Negative `amount` signals a corrective transaction.
- `corrected_transaction_id` is required — must reference an existing APPROVED transaction of the same type on the same loan.
- Side effects are reversed (see Section 8 "Corrective Transactions").

**Bulk collection POST body:**
```
Header: Idempotency-Key: <client-generated UUID>
```
```json
{
  "collections": [
    { "loan_id": "uuid", "amount": 1000, "transaction_date": "2026-01-30", "notes": "" },
    { "loan_id": "uuid", "amount": 500, "transaction_date": "2026-01-30", "notes": "" }
  ]
}
```
- `Idempotency-Key` header required for bulk submissions. Duplicate keys return the cached original response.
- All entries get same `collected_by` (from JWT) and `approval_status`
- Partial success allowed: `{ "created": 18, "failed": 2, "errors": [...] }`

**Approval-gated side effects:**
State mutations (remaining_principal update, penalty amount_collected, principal_returns record) execute ONLY when a transaction is approved, not on creation. See BRD.md Section 6 for details.

---

### 5.8 Penalties

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/loans/:id/penalties` | Impose penalty (admin). System auto-calculates incremental months. |
| GET | `/api/v1/loans/:id/penalties` | List penalties for loan |
| PATCH | `/api/v1/penalties/:id/waive` | Waive fully or partially (admin). Body: `{ waive_amount, notes }` |

---

### 5.9 Waivers (Admin only)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/loans/:id/waive-interest` | Waive interest for a billing cycle. Body: `{ effective_date, waive_amount, notes }` |
| GET | `/api/v1/loans/:id/waivers` | List all waivers for loan |

---

### 5.10 Dashboard

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/dashboard/today` | Today's summary |
| GET | `/api/v1/dashboard/overdue` | All overdue loans |
| GET | `/api/v1/dashboard/defaulters` | All defaulted loans |
| GET | `/api/v1/dashboard/fund-summary` | Capital overview |

**GET /api/v1/dashboard/today response:**
```json
{
  "daily_loans_active_count": 45,
  "daily_collections_expected_today": { "count": 40, "total_amount": 32000 },
  "daily_collections_received_today": { "count": 38, "total_amount": 28000 },
  "daily_collections_missed_today": [
    { "loan_id": "uuid", "borrower_name": "...", "amount_due": 500 }
  ],
  "monthly_interest_due_today": [
    { "loan_id": "uuid", "borrower_name": "...", "amount": 2000, "due_date": "2026-01-30" }
  ],
  "pending_approvals_count": 12,
  "total_collected_today": 28000
}
// Note: "expected_today" only includes active daily loans within their term period
// (today <= term_end_date). Overdue loans are in the /overdue endpoint.
```

**GET /api/v1/dashboard/overdue response:**
```json
{
  "overdue_daily_loans": [
    { "loan_id": "uuid", "borrower": "...", "days_overdue": 15, "amount_remaining": 25000, "guarantor": "...", "penalty_applicable": 5000 }
  ],
  "overdue_monthly_loans": [
    { "loan_id": "uuid", "borrower": "...", "months_overdue": 2, "interest_due": 4000, "last_payment_date": "2025-11-15" }
  ]
}
```

---

### 5.11 Reports

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/reports/profit-loss?from=&to=` | P&L for date range |
| GET | `/api/v1/reports/collector-summary?from=&to=` | Per-collector performance |
| GET | `/api/v1/reports/loan-book` | Full portfolio snapshot |

---

### 5.12 Expenses

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/expenses` | List. Filters: `category`, `from`, `to` |
| POST | `/api/v1/expenses` | Record expense |
| PUT | `/api/v1/expenses/:id` | Update expense |
| PATCH | `/api/v1/expenses/:id/delete` | Soft-delete expense |

---

### 5.13 Fund Management

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/fund/entries` | List all injections and withdrawals |
| POST | `/api/v1/fund/entries` | Record injection or withdrawal |
| GET | `/api/v1/fund/summary` | Current fund status |

---

## 6. Security

### Tenant Isolation
- `tenant_id` derived from JWT, never from client
- Every DB query includes `WHERE tenant_id = ?` via ORM middleware
- FK references validated to belong to same tenant
- File uploads in tenant-scoped paths: `uploads/{tenant_id}/...`
- Suspended tenants: all API calls return 403

### Authentication & Authorization
- Passwords: bcrypt, min 12 rounds
- JWT: 15 min access token, 7 day refresh token
- JWT payload: `{ user_id, tenant_id, role }`
- Three-tier RBAC: SUPER_ADMIN, ADMIN, COLLECTOR
- Collector restrictions: cannot create loans, approve payments, mark defaults, issue waivers, access fund data, access expenses, manage users, view reports
- Collector data visibility: can only see ACTIVE loans and their borrower details (name, phone, address). Cannot see closed, defaulted, written-off, or cancelled loans.

### Data Safety
- All financial amounts: `DECIMAL(12,2)` - never floating point
- All state changes create audit trails (timestamps + user references)
- Financial records are never hard-deleted (soft-delete with `is_deleted`)
- Approved transactions are final - corrections via new transactions, not edits
- ID proof documents served through authenticated + tenant-scoped endpoints

### Infrastructure
- SQL injection: prevented by parameterized queries (Prisma)
- Rate limiting per tenant
- CORS: configure allowed origins per environment

---

## 7. Fund & Profit Calculation Queries

> These are the technical implementations of the formulas in BRD.md Section 9.

**Important — Prisma limitation:** The queries below use `CASE WHEN`, `GREATEST`, `COALESCE`, subqueries, and cross-table aggregations that Prisma's type-safe query API does not support natively. **Do not attempt to convert these into Prisma syntax.** Use `prisma.$queryRaw` for all report, dashboard, and fund summary queries. Store these SQL queries as constants or `.sql` files in the repository so the principal-first logic executes exactly as written by the database engine. Prisma's query builder should only be used for standard CRUD operations (create/read/update on single tables).

### Fund Summary

```sql
-- Total Capital Invested
SELECT COALESCE(SUM(CASE WHEN entry_type = 'INJECTION' THEN amount ELSE -amount END), 0)
FROM fund_entries WHERE tenant_id = ?;

-- Money Deployed (CANCELLED loans excluded by status filter)
-- Monthly: remaining_principal tracked directly on the loan
-- Daily: principal-first — every collection reduces deployed capital until principal recovered
SELECT
  COALESCE((SELECT SUM(remaining_principal) FROM loans WHERE tenant_id = ? AND status = 'ACTIVE' AND loan_type = 'MONTHLY'), 0)
  +
  COALESCE((
    SELECT SUM(GREATEST(principal_amount - total_collected, 0))
    FROM loans
    WHERE tenant_id = ? AND status = 'ACTIVE' AND loan_type = 'DAILY'
  ), 0);

-- Cash in Hand (excludes OPENING_BALANCE, waivers, and CANCELLED loan transactions)
SELECT
  (SELECT COALESCE(SUM(CASE WHEN entry_type = 'INJECTION' THEN amount ELSE -amount END), 0) FROM fund_entries WHERE tenant_id = ?)
  -
  (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t JOIN loans l ON t.loan_id = l.id WHERE t.tenant_id = ? AND t.transaction_type = 'DISBURSEMENT' AND t.approval_status = 'APPROVED' AND l.status != 'CANCELLED')
  +
  (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t JOIN loans l ON t.loan_id = l.id WHERE t.tenant_id = ? AND t.transaction_type IN ('ADVANCE_INTEREST','INTEREST_PAYMENT','PRINCIPAL_RETURN','DAILY_COLLECTION','PENALTY','GUARANTOR_PAYMENT') AND t.approval_status = 'APPROVED' AND l.status != 'CANCELLED')
  -
  (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE tenant_id = ? AND is_deleted = false);
```

### Total Interest Earned (Aggregate)

```sql
-- Monthly interest earned (across all monthly loans for the tenant)
SELECT COALESCE(SUM(t.amount), 0)
FROM transactions t
JOIN loans l ON t.loan_id = l.id
WHERE t.tenant_id = ? AND t.transaction_type IN ('INTEREST_PAYMENT', 'ADVANCE_INTEREST')
  AND t.approval_status = 'APPROVED' AND l.status != 'CANCELLED';

-- Daily interest earned (principal-first: interest recognized only after principal recovered)
SELECT COALESCE(SUM(GREATEST(l.total_collected - l.principal_amount, 0)), 0)
FROM loans l
WHERE l.tenant_id = ? AND l.loan_type = 'DAILY' AND l.status != 'CANCELLED';

-- Penalties collected
SELECT COALESCE(SUM(t.amount), 0)
FROM transactions t
JOIN loans l ON t.loan_id = l.id
WHERE t.tenant_id = ? AND t.transaction_type = 'PENALTY'
  AND t.approval_status = 'APPROVED' AND l.status != 'CANCELLED';

-- Total Interest Earned = monthly_interest + daily_interest + penalties_collected
```

### Money Lost to Defaults (Aggregate)

```sql
-- Monthly default losses
SELECT COALESCE(SUM(l.remaining_principal), 0)
  - COALESCE((
    SELECT SUM(t.amount) FROM transactions t
    WHERE t.tenant_id = ? AND t.transaction_type = 'GUARANTOR_PAYMENT'
      AND t.approval_status = 'APPROVED'
      AND t.loan_id IN (SELECT id FROM loans WHERE tenant_id = ? AND loan_type = 'MONTHLY' AND status IN ('DEFAULTED', 'WRITTEN_OFF'))
  ), 0)
FROM loans l
WHERE l.tenant_id = ? AND l.loan_type = 'MONTHLY' AND l.status IN ('DEFAULTED', 'WRITTEN_OFF');

-- Daily default losses
SELECT COALESCE(SUM(GREATEST(l.principal_amount - l.total_collected, 0)), 0)
  - COALESCE((
    SELECT SUM(t.amount) FROM transactions t
    WHERE t.tenant_id = ? AND t.transaction_type = 'GUARANTOR_PAYMENT'
      AND t.approval_status = 'APPROVED'
      AND t.loan_id IN (SELECT id FROM loans WHERE tenant_id = ? AND loan_type = 'DAILY' AND status IN ('DEFAULTED', 'WRITTEN_OFF'))
  ), 0)
FROM loans l
WHERE l.tenant_id = ? AND l.loan_type = 'DAILY' AND l.status IN ('DEFAULTED', 'WRITTEN_OFF');
```

### Revenue Forgone

```sql
-- Interest waived
SELECT COALESCE(SUM(t.amount), 0)
FROM transactions t
JOIN loans l ON t.loan_id = l.id
WHERE t.tenant_id = ? AND t.transaction_type = 'INTEREST_WAIVER'
  AND t.approval_status = 'APPROVED' AND l.status != 'CANCELLED';

-- Penalties waived
SELECT COALESCE(SUM(p.waived_amount), 0)
FROM penalties p
JOIN loans l ON p.loan_id = l.id
WHERE p.tenant_id = ? AND l.status != 'CANCELLED';

-- Revenue Forgone = interest_waived + penalties_waived
```

### Net Profit

```sql
-- Net Profit = Total Interest Earned - Money Lost to Defaults - Total Expenses
-- Computed from the above queries. Not stored.
```

---

### Per-Loan Profit (Monthly)

```sql
-- Profit for a monthly loan = all interest payments + advance interest
SELECT COALESCE(SUM(t.amount), 0) AS interest_earned
FROM transactions t
WHERE t.loan_id = ? AND t.transaction_type IN ('INTEREST_PAYMENT', 'ADVANCE_INTEREST')
  AND t.approval_status = 'APPROVED';

-- If defaulted: loss = remaining_principal minus guarantor recoveries
SELECT
  l.remaining_principal - COALESCE(SUM(t.amount), 0) AS principal_loss
FROM loans l
LEFT JOIN transactions t ON t.loan_id = l.id
  AND t.transaction_type = 'GUARANTOR_PAYMENT' AND t.approval_status = 'APPROVED'
WHERE l.id = ? AND l.status IN ('DEFAULTED', 'WRITTEN_OFF')
GROUP BY l.remaining_principal;
```

### Per-Loan Profit (Daily) — Principal-First

```sql
-- Interest earned for a closed daily loan (total_collected >= total_repayment)
SELECT total_collected - principal_amount AS interest_earned
FROM loans WHERE id = ? AND status = 'CLOSED' AND loan_type = 'DAILY';

-- Interest earned for an active daily loan (zero until principal recovered)
SELECT GREATEST(total_collected - principal_amount, 0) AS interest_earned
FROM loans WHERE id = ? AND status = 'ACTIVE' AND loan_type = 'DAILY';

-- Principal loss for a defaulted daily loan
SELECT
  GREATEST(l.principal_amount - l.total_collected, 0)
  - COALESCE(SUM(t.amount), 0) AS principal_loss
FROM loans l
LEFT JOIN transactions t ON t.loan_id = l.id
  AND t.transaction_type = 'GUARANTOR_PAYMENT' AND t.approval_status = 'APPROVED'
WHERE l.id = ? AND l.status IN ('DEFAULTED', 'WRITTEN_OFF') AND l.loan_type = 'DAILY'
GROUP BY l.principal_amount, l.total_collected;
```

---

## 8. Key Implementation Notes

### Database Transactions (Atomicity)

All multi-step financial operations MUST run inside a database transaction (`Prisma.$transaction()` or `BEGIN/COMMIT`). If any step fails, everything rolls back.

**Operations requiring transactions:**

| Operation | Steps (all-or-nothing) |
|---|---|
| Monthly loan disbursement | Insert loan (set `remaining_principal` and `billing_principal` = `principal_amount`) → insert DISBURSEMENT txn → insert ADVANCE_INTEREST txn → insert loan_number_sequence update |
| Daily loan disbursement | Insert loan → insert DISBURSEMENT txn → insert loan_number_sequence update |
| Transaction approval | Update txn to APPROVED → execute side effects (see Approval State Machine below) |
| Transaction rejection | Update txn to REJECTED (single step, but still wrap for consistency) |
| Penalty imposition | Insert penalty → (no side effects until payment) |
| Penalty waiver | Update penalty (waived_amount, net_payable, status) → insert PENALTY_WAIVER txn |
| Interest waiver | Insert INTEREST_WAIVER txn |
| Loan closure | Validate closure conditions → update loan status + closure_date |
| Loan default | Update loan status + `defaulted_at`/`defaulted_by` → set `customers.is_defaulter = true` on borrower |
| Loan cancellation | Validate no payments → update loan status + cancellation fields |
| Corrective transaction | Insert corrective txn → execute reversed side effects (same scope as approval side effects but in reverse) |
| Bulk collection | Each collection in its own transaction. Partial success allowed — failures don't roll back successes. |

### Concurrency & Locking

Financial mutations must prevent race conditions. Two strategies used:

**1. Optimistic locking for loan state changes:**
Add `version INTEGER DEFAULT 1` to the `loans` table. Every update includes `WHERE version = :expected_version` and increments version. If the row was modified by another request, the WHERE clause matches 0 rows → return 409 Conflict → client retries.

Prevents: two simultaneous PRINCIPAL_RETURN approvals that each pass validation individually but together exceed remaining_principal.

**2. SELECT ... FOR UPDATE for critical sections:**
Used where optimistic locking isn't practical (counter tables, penalty updates).

| Scenario | Lock Target |
|---|---|
| Loan number generation | `loan_number_sequences` row — already documented |
| Penalty payment approval | `penalties` row — prevents two payments exceeding net_payable |
| Transaction approval | `transactions` row — prevents double-approval |

**3. Transaction isolation levels:**
- Default: `READ COMMITTED` (PostgreSQL default) — sufficient for most operations
- Fund summary / dashboard aggregations: use `REPEATABLE READ` to avoid inconsistent reads during concurrent writes (e.g., a payment being approved while the dashboard query runs)
- Loan number generation: handled by `SELECT ... FOR UPDATE` within `READ COMMITTED`

**4. Idempotency for collector bulk submissions:**
Each bulk collection request includes a client-generated `idempotency_key` (header: `Idempotency-Key`). Server stores it in a dedicated table and rejects duplicate submissions. Prevents double-recording from network retries.

**`idempotency_keys` table:**

| Column | Type | Constraints | Notes |
|---|---|---|---|
| key | VARCHAR(255) | PK | Client-generated unique key |
| tenant_id | UUID | FK -> tenants.id, NOT NULL | |
| user_id | UUID | FK -> users.id, NOT NULL | |
| response_status | INTEGER | NOT NULL | HTTP status of the original response |
| response_body | JSONB | NOT NULL | Cached response to return on replay |
| created_at | TIMESTAMP | DEFAULT now() | |
| expires_at | TIMESTAMP | NOT NULL | Auto-expire after 24 hours. Periodic cleanup via scheduled job or TTL index. |

### Approval State Machine
```
Transaction created (by collector) -> PENDING
  -> Admin approves -> APPROVED -> side effects execute atomically
  -> Admin rejects  -> REJECTED -> no side effects
Transaction created (by admin) -> APPROVED immediately -> side effects execute
```

**Side effects per transaction type (on approval):**
| Type | Side Effect |
|---|---|
| PRINCIPAL_RETURN | Decrement `loans.remaining_principal`, insert `principal_returns`. **Does NOT update `billing_principal`** — that syncs at cycle boundary. |
| PENALTY | Update `penalties.amount_collected` and `penalties.status` |
| PENALTY_WAIVER | Update `penalties.waived_amount`, `net_payable`, `status` |
| DAILY_COLLECTION, GUARANTOR_PAYMENT | Increment `loans.total_collected` (daily loans only) |

**Side effects per loan status change:**
| Status Change | Side Effect |
|---|---|
| ACTIVE → DEFAULTED | Set `customers.is_defaulter = true` for the borrower. Record `defaulted_at`, `defaulted_by`. |
| DEFAULTED → CLOSED | Record `closure_date`, `closed_by`. (Does NOT auto-clear `is_defaulter` — admin must do this manually via the clear-defaulter endpoint.) |
| DEFAULTED → WRITTEN_OFF | Record `written_off_at`, `written_off_by`. |
| ACTIVE → CLOSED | Record `closure_date`, `closed_by`. |
| ACTIVE → CANCELLED | Record `cancelled_at`, `cancelled_by`, `cancellation_reason`. |

### Billing Principal Lifecycle

The `billing_principal` column stores the principal amount used for the current billing cycle's interest calculation. Unlike `remaining_principal` (which updates immediately on any principal return), `billing_principal` only updates at cycle boundaries.

```
Lifecycle:
1. On DISBURSEMENT:
   billing_principal = principal_amount
   remaining_principal = principal_amount

2. On PRINCIPAL_RETURN (mid-cycle):
   remaining_principal -= return_amount   (immediate)
   billing_principal   = unchanged        (holds the old value until the cycle ends)

3. On billing cycle boundary (when due date passes and cycle is settled):
   billing_principal = remaining_principal  (sync)
   This runs when:
   - The first payment/waiver for a new cycle is recorded, OR
   - The overdue detection job iterates past a due date

4. On MIGRATION:
   billing_principal = remaining_principal  (both set to the migrated value)
```

**Why this matters:** Without `billing_principal`, calculating interest due requires a fragile reverse-query: `remaining_principal + SUM(mid-cycle returns)`. With it, interest due is a deterministic lookup: `billing_principal × interest_rate / 100`.

### Monthly Interest Overpayment Auto-Split
When recording an INTEREST_PAYMENT for a monthly loan, interest due = `billing_principal × interest_rate / 100`. This is always correct because `billing_principal` holds the principal from the start of the current cycle (BRD Section 2.1 — mid-cycle returns take effect next cycle).

```
If amount <= interest_due:
  -> Create single INTEREST_PAYMENT transaction
If amount > interest_due:
  -> Create INTEREST_PAYMENT for interest_due amount
  -> Create PRINCIPAL_RETURN for (amount - interest_due)
  -> Execute PRINCIPAL_RETURN side effects (decrement remaining_principal, insert principal_returns)
  -> billing_principal is NOT updated (stays at cycle-start value)
Both transactions are created atomically within a single DB transaction.
```

### Corrective Transactions
Admin-only. Used to reverse a mistake after approval. A corrective transaction:
- Has the same `transaction_type` as the original
- Has a **negative `amount`** (the only case where amount can be negative)
- References the original via `corrected_transaction_id` (FK to `transactions.id`)
- Is auto-approved (admin action)
- Triggers **reversed side effects**:
  - Corrective PRINCIPAL_RETURN of -5,000 → increments `remaining_principal` by 5,000 (does NOT touch `billing_principal`), inserts a `principal_returns` record with negative `amount_returned`
  - Corrective DAILY_COLLECTION of -1,000 → decrements `loans.total_collected` by 1,000
  - Corrective GUARANTOR_PAYMENT of -2,000 → decrements `loans.total_collected` by 2,000 (daily loans)
  - Corrective PENALTY of -500 → decrements `penalties.amount_collected` by 500, recalculates penalty status
  - Corrective INTEREST_PAYMENT → no loan-level side effect (interest payments don't mutate loan state)
- Both original and corrective transactions remain in the audit trail
- **Validation**: the corrected transaction must be APPROVED, same loan, same type. Only one correction per transaction.

### Guarantor Warning (Computed)
On `GET /api/v1/customers/:id`, include a computed field:
```json
{
  "guarantor_warnings": [
    { "loan_id": "uuid", "loan_number": "DL-2026-0042", "borrower_name": "...", "status": "DEFAULTED" }
  ]
}
```
Query: find all loans where `guarantor_id = customer.id` AND `status IN ('DEFAULTED', 'WRITTEN_OFF')`. This is informational — does not set `is_defaulter`.

### Monthly Billing Cycle Settlement (Computed)

A billing cycle is identified by its due date (the `effective_date` on transactions). A cycle is **settled** when:
```
SUM(INTEREST_PAYMENT amounts for this cycle) + SUM(INTEREST_WAIVER amounts for this cycle)
  >= interest_due for this cycle
```

Interest due for a cycle = `billing_principal × interest_rate / 100` (see "Billing Principal Lifecycle" above).

**There is no stored "settled" flag.** Settlement is always computed on the fly from transactions. This avoids stale state and is the source of truth for:
- **Overdue detection** (BRD 7.5): iterate from the cycle after `last_interest_paid_through` (migrated) or the first cycle after disbursement (native) up to the current month. Any unsettled cycle = overdue.
- **Closure validation** (BRD 7.4): all cycles from disbursement through the final cycle must be settled.
- **Dashboard overdue list**: count of unsettled cycles = months overdue.

**For migrated loans**: all cycles up to and including `last_interest_paid_through` are considered settled without checking transactions. Only cycles after that date are computed from transactions.

---

### Monthly Due Date Computation
`monthly_due_day` is **immutable** — set once at disbursement (extracted from `disbursement_date`), stored on the loan, never changed. The computed due date adapts per month but always "bounces back" to the original day when the month is long enough (e.g., 31 → Feb 28 → Mar 31).

```typescript
function getDueDate(monthly_due_day: number, year: number, month: number): Date {
  const lastDay = new Date(year, month, 0).getDate(); // last day of month
  const day = Math.min(monthly_due_day, lastDay);
  return new Date(year, month - 1, day);
}
// Examples with monthly_due_day = 31:
//   getDueDate(31, 2026, 1) -> Jan 31
//   getDueDate(31, 2026, 2) -> Feb 28
//   getDueDate(31, 2026, 3) -> Mar 31  (reverts back)
```

### Loan Number Generation
```
Counter table: loan_number_sequences (tenant_id, year, loan_type, current_value)
On loan creation:
  1. SELECT ... FOR UPDATE (lock the row)
  2. Increment current_value
  3. Format: "{ML|DL}-{YEAR}-{padded sequence}"
```

### Penalty Auto-Calculation (Incremental Stacking)
When admin triggers "impose penalty" on an overdue daily loan:
```
1. total_months_owed = CEIL(days_overdue / 30)
2. months_already_penalised = SUM(months_charged) from ALL penalties on this loan
   (includes PENDING, PARTIALLY_PAID, PAID, and WAIVED — waived penalties still count)
3. incremental_months = total_months_owed - months_already_penalised
4. If incremental_months <= 0 -> no new penalty needed
5. new_penalty_amount = principal_amount x interest_rate / 100 x incremental_months
6. System presents this to admin for confirmation (admin can override amount)
7. Create penalty record with months_charged = incremental_months
```

### Loan Cancellation
```
1. Validate loan status = ACTIVE
2. Validate no APPROVED transactions exist for this loan
   EXCEPT: DISBURSEMENT and ADVANCE_INTEREST (the initial creation transactions)
3. Validate no PENDING transactions exist for this loan
   (prevents race condition: collector submitted offline, admin cancels before sync)
   If PENDING transactions exist, admin must reject them first, then cancel.
4. Set status = CANCELLED, record reason and who cancelled
5. CANCELLED loans are excluded from ALL financial calculations
   (fund summary, profit, cash in hand, reports)
```

**Offline collector edge case:** If a collector is offline and has cash for a loan that gets cancelled before they sync, their submission will be rejected (CANCELLED loans reject all payments). The admin and collector reconcile manually — the money is returned to the borrower or re-allocated to the correct loan. This is the correct behavior since cancellation means the loan was a mistake.

### Migration
- No DISBURSEMENT transaction for migrated loans
- `is_migrated = true` on the loan record
- **Monthly loans**: No OPENING_BALANCE transaction. State is set directly:
  - `principal_amount` = original amount given
  - `remaining_principal` = current outstanding amount
  - `last_interest_paid_through` = last billing cycle already settled. Overdue detection skips all cycles <= this date.
- **Daily loans**: An OPENING_BALANCE transaction records `total_base_collected_so_far` (base loan collections only, excluding penalty payments).
  - Included in loan-level `total_collected` (drives days_paid, total_remaining, closure condition)
  - Excluded from `Cash in Hand` calculation (money was collected before the system)
  - If the loan is already overdue, admin can optionally enter pre-existing penalty records (months_charged, penalty_amount, status). These are standard `penalties` rows — no schema changes needed. The penalty auto-calculation then correctly computes incremental months.
