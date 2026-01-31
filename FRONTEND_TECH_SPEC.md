# LoanTrack Frontend — Technical Specification

This document is the **deliverable** itself (saved as `FRONTEND_TECH_SPEC.md` in the repo root). Business requirements are in `FRONTEND_BRD.md`. Backend technical details are in `TECHNICAL_SPEC.md`. This spec covers the "how" — architecture, patterns, types, and conventions for the Next.js frontend.

---

## 1. Tech Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Framework | Next.js (App Router) | 15.x | File-based routing, SSR/SSG, middleware |
| UI Library | React | 19.x | Component model |
| Language | TypeScript | 5.x | Type safety |
| Styling | Tailwind CSS | 4.x | Utility-first CSS |
| Component Kit | shadcn/ui (Radix + Tailwind) | latest | Accessible, copy-paste primitives |
| Server State | TanStack Query v5 | 5.x | Caching, pagination, mutations |
| Client State | Zustand | 5.x | Auth tokens, UI state |
| Forms | React Hook Form | 7.x | Performant form management |
| Validation | Zod | 3.x | Schema validation (mirrors backend) |
| HTTP Client | Axios | 1.x | Interceptors, transforms |
| PWA | next-pwa (Workbox) | 5.x | Service worker, offline caching |
| Dates | date-fns | 4.x | Lightweight, tree-shakeable |
| Offline Storage | idb (IndexedDB wrapper) | 8.x | Typed IndexedDB for offline reads |
| Testing | Vitest + React Testing Library | latest | Unit + component tests |
| API Mocking | MSW v2 | 2.x | Network-level mocking for tests |
| E2E Testing | Playwright | latest | Browser tests (Phase 11) |
| Linting | ESLint + Prettier | latest | Code quality |
| Deployment | Vercel | — | Edge network, preview deploys |

---

## 2. Project Structure

```
loantrack-web/                          # Separate repo from loantrack-api
├── public/
│   ├── icons/                          # PWA icons (192px, 512px, maskable)
│   └── manifest.json                   # Web app manifest
├── src/
│   ├── app/                            # Next.js App Router
│   │   ├── (auth)/                     # Public layout (no nav shell)
│   │   │   ├── login/page.tsx          # S1: Login
│   │   │   └── layout.tsx
│   │   ├── (app)/                      # Authenticated layout (auth guard)
│   │   │   ├── (admin)/               # Admin shell (bottom tab bar)
│   │   │   │   ├── dashboard/
│   │   │   │   │   ├── page.tsx        # A1: Today
│   │   │   │   │   ├── overdue/page.tsx       # A2
│   │   │   │   │   ├── defaulters/page.tsx    # A3
│   │   │   │   │   └── fund-summary/page.tsx  # A4
│   │   │   │   ├── loans/
│   │   │   │   │   ├── page.tsx        # A5: Loan List
│   │   │   │   │   ├── [id]/page.tsx   # A6/A7: Loan Detail (type-branch)
│   │   │   │   │   ├── new/page.tsx    # A8: Create Loan
│   │   │   │   │   └── migrate/page.tsx # A9: Migrate Loan
│   │   │   │   ├── customers/
│   │   │   │   │   ├── page.tsx        # A13: Customer List
│   │   │   │   │   ├── [id]/page.tsx   # A14: Customer Detail
│   │   │   │   │   └── new/page.tsx    # A15: Create Customer
│   │   │   │   ├── money/
│   │   │   │   │   ├── page.tsx        # A22: Fund Management
│   │   │   │   │   ├── expenses/page.tsx      # A21
│   │   │   │   │   └── reports/
│   │   │   │   │       ├── profit-loss/page.tsx        # A23
│   │   │   │   │       ├── collector-summary/page.tsx  # A24
│   │   │   │   │       └── loan-book/page.tsx          # A25
│   │   │   │   ├── more/
│   │   │   │   │   ├── page.tsx        # More menu
│   │   │   │   │   ├── approvals/page.tsx      # A11
│   │   │   │   │   ├── transactions/page.tsx   # A12
│   │   │   │   │   └── users/page.tsx          # A20
│   │   │   │   ├── layout.tsx          # Admin shell: bottom tab bar + FAB
│   │   │   │   └── loading.tsx         # Skeleton screen
│   │   │   ├── (collector)/           # Collector shell (bottom tab bar)
│   │   │   │   ├── today/
│   │   │   │   │   ├── page.tsx        # C1: My Collections Today
│   │   │   │   │   ├── record/page.tsx # C2: Record Collection
│   │   │   │   │   └── bulk/page.tsx   # C3: Bulk Collection
│   │   │   │   ├── loans/
│   │   │   │   │   ├── page.tsx        # C4: Loan List
│   │   │   │   │   └── [id]/page.tsx   # C5: Loan Detail
│   │   │   │   ├── customers/
│   │   │   │   │   ├── page.tsx        # C6: Customer List
│   │   │   │   │   └── [id]/page.tsx   # C7: Customer Detail
│   │   │   │   ├── profile/page.tsx    # S3: Profile
│   │   │   │   ├── layout.tsx          # Collector shell
│   │   │   │   └── loading.tsx
│   │   │   ├── (platform)/            # Super Admin shell (sidebar)
│   │   │   │   ├── platform/
│   │   │   │   │   ├── page.tsx        # P1: Platform Dashboard
│   │   │   │   │   ├── tenants/
│   │   │   │   │   │   ├── page.tsx    # P2: Tenant List
│   │   │   │   │   │   ├── [id]/page.tsx # P3: Tenant Detail
│   │   │   │   │   │   └── new/page.tsx  # P4: Onboard Tenant
│   │   │   │   ├── layout.tsx
│   │   │   │   └── loading.tsx
│   │   │   ├── shared/                # Shared authenticated pages
│   │   │   │   ├── profile/page.tsx   # S3: Profile (admin)
│   │   │   │   └── change-password/page.tsx # S2
│   │   │   └── layout.tsx             # Auth guard wrapper
│   │   ├── layout.tsx                 # Root (html, body, providers)
│   │   ├── not-found.tsx
│   │   └── error.tsx                  # Global error boundary
│   ├── components/
│   │   ├── ui/                        # shadcn/ui (auto-generated)
│   │   │   ├── button.tsx, input.tsx, select.tsx, dialog.tsx,
│   │   │   │   sheet.tsx, tabs.tsx, badge.tsx, skeleton.tsx,
│   │   │   │   toast.tsx, card.tsx, dropdown-menu.tsx,
│   │   │   │   tooltip.tsx, switch.tsx, label.tsx, textarea.tsx,
│   │   │   │   popover.tsx, calendar.tsx, command.tsx,
│   │   │   │   scroll-area.tsx, progress.tsx, alert-dialog.tsx
│   │   │   └── ...
│   │   └── shared/                    # Custom shared components
│   │       ├── currency-display.tsx
│   │       ├── currency-input.tsx
│   │       ├── date-picker.tsx
│   │       ├── loan-picker.tsx
│   │       ├── customer-picker.tsx
│   │       ├── status-badge.tsx
│   │       ├── empty-state.tsx
│   │       ├── pull-to-refresh.tsx
│   │       ├── infinite-list.tsx
│   │       ├── offline-banner.tsx
│   │       ├── page-header.tsx
│   │       ├── confirmation-dialog.tsx
│   │       ├── fab.tsx
│   │       ├── bottom-tab-bar.tsx
│   │       └── sidebar-nav.tsx
│   ├── features/                      # Feature modules
│   │   ├── auth/
│   │   │   ├── components/            # login-form.tsx, change-password-form.tsx
│   │   │   ├── hooks/                 # use-login.ts, use-logout.ts, use-auth.ts
│   │   │   ├── schemas.ts
│   │   │   └── types.ts
│   │   ├── dashboard/
│   │   │   ├── components/            # today-summary.tsx, collection-progress-card.tsx, ...
│   │   │   ├── hooks/                 # use-today-summary.ts, use-overdue.ts, ...
│   │   │   └── types.ts
│   │   ├── loans/
│   │   │   ├── components/            # loan-card.tsx, monthly-loan-detail.tsx, ...
│   │   │   ├── hooks/                 # use-loans.ts, use-loan-detail.ts, ...
│   │   │   ├── schemas.ts
│   │   │   └── types.ts
│   │   ├── transactions/
│   │   │   ├── components/            # record-payment-form.tsx, bulk-collection-form.tsx, ...
│   │   │   ├── hooks/                 # use-create-transaction.ts, use-bulk-collection.ts, ...
│   │   │   ├── schemas.ts
│   │   │   └── types.ts
│   │   ├── customers/
│   │   │   ├── components/            # customer-card.tsx, customer-form.tsx, ...
│   │   │   ├── hooks/                 # use-customers.ts, use-customer-detail.ts, ...
│   │   │   ├── schemas.ts
│   │   │   └── types.ts
│   │   ├── penalties/
│   │   │   ├── components/            # impose-penalty-form.tsx, waive-penalty-form.tsx, ...
│   │   │   ├── hooks/                 # use-penalties.ts, use-impose-penalty.ts, ...
│   │   │   ├── schemas.ts
│   │   │   └── types.ts
│   │   ├── expenses/                  # components/, hooks/, schemas.ts, types.ts
│   │   ├── fund/                      # components/, hooks/, schemas.ts, types.ts
│   │   ├── reports/                   # components/, hooks/, types.ts
│   │   ├── users/                     # components/, hooks/, schemas.ts, types.ts
│   │   ├── platform/                  # components/, hooks/, schemas.ts, types.ts
│   │   └── collector/
│   │       ├── components/            # collections-today.tsx, cash-handover-card.tsx
│   │       ├── hooks/                 # use-collections-today.ts
│   │       └── types.ts
│   ├── lib/
│   │   ├── api/
│   │   │   ├── client.ts             # Axios instance + interceptors
│   │   │   ├── auth.api.ts           # Auth endpoints
│   │   │   ├── loans.api.ts          # Loan endpoints
│   │   │   ├── transactions.api.ts   # Transaction endpoints
│   │   │   ├── customers.api.ts      # Customer endpoints
│   │   │   ├── penalties.api.ts      # Penalty endpoints
│   │   │   ├── expenses.api.ts       # Expense endpoints
│   │   │   ├── fund.api.ts           # Fund endpoints
│   │   │   ├── dashboard.api.ts      # Dashboard endpoints
│   │   │   ├── reports.api.ts        # Reports endpoints
│   │   │   ├── users.api.ts          # User management endpoints
│   │   │   └── platform.api.ts       # Super Admin endpoints
│   │   ├── query-keys.ts             # TanStack Query key factory
│   │   ├── query-client.ts           # QueryClient config
│   │   └── providers.tsx             # React Query + Zustand providers
│   ├── stores/
│   │   ├── auth-store.ts             # Zustand: tokens, user, tenant
│   │   └── ui-store.ts              # Zustand: sidebar, active tab, filters
│   ├── types/
│   │   ├── api.ts                    # ApiResponse<T>, PaginatedResponse<T>, ApiError
│   │   ├── entities.ts              # Customer, Loan, Transaction, Penalty, etc.
│   │   ├── enums.ts                 # LoanType, LoanStatus, TransactionType, etc.
│   │   └── requests.ts             # CreateCustomerRequest, CreateLoanRequest, etc.
│   ├── utils/
│   │   ├── currency.ts              # Indian currency formatter
│   │   ├── date.ts                  # Date formatting with date-fns
│   │   ├── case-transform.ts        # camelCase <-> snake_case
│   │   └── idempotency.ts           # UUID generation for Idempotency-Key header
│   ├── hooks/
│   │   ├── use-online-status.ts     # navigator.onLine observer
│   │   ├── use-pull-to-refresh.ts   # Touch gesture handler
│   │   └── use-debounce.ts          # Input debounce
│   └── styles/
│       └── globals.css              # Tailwind directives + CSS vars
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── .env.local                        # NEXT_PUBLIC_API_URL=http://localhost:3000
├── .env.example
├── vitest.config.ts
└── package.json
```

---

## 3. Authentication Architecture

### 3.1 Token Storage

The frontend is on a different origin than the API, so `httpOnly` cookies are not practical without a BFF proxy. Strategy:

| Token | Storage | Rationale |
|-------|---------|-----------|
| `access_token` | In-memory (Zustand) | Not accessible to XSS via localStorage. Cleared on tab close. |
| `refresh_token` | `localStorage` (via Zustand persist) | Survives page refresh. Rotated on use, server-revokable. |
| `user` object | Zustand (persisted) | Role + tenantId needed for route guards before API call. |
| `expiresAt` | Zustand (persisted) | Tracks when access_token expires for proactive refresh. |

### 3.2 Auth Store

```typescript
// src/stores/auth-store.ts
interface AuthUser {
  id: string;
  name: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'COLLECTOR';
  tenantId: string | null;
}

interface AuthState {
  accessToken: string | null;     // NOT persisted (in-memory only)
  refreshToken: string | null;    // Persisted
  expiresAt: number | null;       // Persisted (Unix ms)
  user: AuthUser | null;          // Persisted

  setAuth: (data: { accessToken: string; refreshToken: string;
    expiresIn: number; user: AuthUser }) => void;
  setTokens: (accessToken: string, refreshToken: string, expiresIn: number) => void;
  clearAuth: () => void;
}
```

Zustand `persist` middleware with `partialize` to exclude `accessToken` from localStorage.

### 3.3 Proactive Token Refresh

Schedule refresh at **80% of `expires_in`** (12 min into 15 min TTL):

```typescript
const refreshAt = expiresIn * 0.8 * 1000; // ms
setTimeout(() => performTokenRefresh(), refreshAt);
```

### 3.4 Auth Bootstrap (Page Load)

1. Zustand hydrates `refreshToken` + `user` from localStorage
2. If `refreshToken` exists → call `POST /api/v1/auth/refresh`
3. On success → `setTokens()` + schedule next refresh
4. On failure → `clearAuth()` → redirect to `/login`

### 3.5 Route Protection

**Client-side auth guard** in `src/app/(app)/layout.tsx`:
- No `refreshToken` → redirect `/login`
- Role mismatch with route group → redirect to role's home:
  - ADMIN → `/dashboard`
  - COLLECTOR → `/today`
  - SUPER_ADMIN → `/platform`
- Suspended tenant → show "Tenant Suspended" screen

---

## 4. API Client Layer

### 4.1 Axios Instance

```typescript
// src/lib/api/client.ts
const apiClient = axios.create({
  baseURL: `${process.env.NEXT_PUBLIC_API_URL}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});
```

### 4.2 Request Interceptor

1. Attach `Authorization: Bearer <accessToken>` from Zustand
2. Transform request body keys: **camelCase → snake_case** (the API expects snake_case)
3. Transform query params: **camelCase → snake_case**

### 4.3 Response Interceptor

1. **Unwrap envelope**: `{ success: true, data: T }` → return `T`. For paginated: return `{ data: T[], pagination }`.
2. **Handle 401 (concurrent-safe refresh)**: Uses an `isRefreshing` mutex + `failedQueue` promise array to guarantee exactly one refresh call regardless of how many requests fail with 401 simultaneously (e.g., dashboard fires 5 parallel GETs on mount, all return 401 because the access token expired). Implementation:

```typescript
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach(({ resolve, reject }) => {
    error ? reject(error) : resolve(token!);
  });
  failedQueue = [];
}

// In response error interceptor (status === 401):
if (isRefreshing) {
  // Another refresh is already in-flight — park this request
  return new Promise((resolve, reject) => {
    failedQueue.push({ resolve, reject });
  }).then((newToken) => {
    // CRITICAL: Each queued request MUST update its own Authorization header
    // with the new token before retrying. Without this line, the retry would
    // reuse the stale token from the original request and 401 again, causing
    // an infinite refresh loop.
    originalRequest.headers.Authorization = `Bearer ${newToken}`;
    return apiClient(originalRequest);
  });
}

isRefreshing = true;
try {
  const { accessToken, refreshToken, expiresIn } = await refreshTokenApi(currentRefreshToken);
  useAuthStore.getState().setTokens(accessToken, refreshToken, expiresIn);
  processQueue(null, accessToken);
  // Retry the original request that triggered the refresh
  originalRequest.headers.Authorization = `Bearer ${accessToken}`;
  return apiClient(originalRequest);
} catch (err) {
  processQueue(err, null);
  useAuthStore.getState().clearAuth();
  window.location.href = '/login';
  return Promise.reject(err);
} finally {
  isRefreshing = false;
}
```

Key invariants:
- The **first** 401 sets `isRefreshing = true` and calls `/auth/refresh`.
- All **subsequent** 401s while `isRefreshing` is true push onto `failedQueue` and await the same refresh promise.
- On refresh success: `processQueue` resolves all parked promises with the new token, each retries its original request.
- **Each queued request updates its own `Authorization` header** in the `.then()` callback before retrying. This is critical — without it, retries reuse the stale token and trigger another 401, causing an infinite refresh loop. Do not refactor the `.then((newToken) => { ... })` chain away from the queue consumer.
- On refresh failure: `processQueue` rejects all parked promises, auth is cleared, user is redirected to `/login`.
- `finally` resets `isRefreshing` so a future expiry triggers a fresh cycle.

3. **Normalize errors**: Extract `{ code, message, details, status }` from error envelope.

### 4.4 Case Transforms

The API returns responses in **camelCase** (confirmed: `borrowerName`, `loanNumber`, `transactionType`). No response transformation needed.

The API accepts requests in **snake_case** (`borrower_id`, `loan_type`, `principal_amount`). The request interceptor transforms outgoing bodies.

Exception: Login response uses snake_case for top-level keys (`access_token`, `refresh_token`, `expires_in`, `user.tenant_id`). These are mapped manually in the login handler.

### 4.5 Type-Safe API Functions

Each resource gets its own module with typed functions:

```typescript
// src/lib/api/loans.api.ts
export async function listLoans(params: ListLoansParams): Promise<PaginatedResponse<Loan>>
export async function getLoan(id: string): Promise<MonthlyLoanDetail | DailyLoanDetail>
export async function createLoan(body: CreateLoanRequest): Promise<MonthlyLoanDetail | DailyLoanDetail>
// ... closeLoan, defaultLoan, writeOffLoan, cancelLoan, etc.
```

### 4.6 Idempotency Keys

Generated via `crypto.randomUUID()` on form mount, stored in `useRef`. Included as `Idempotency-Key` header on all POST mutations. The backend CORS config already allows this header.

---

## 5. Data Fetching (TanStack Query)

### 5.1 Query Key Factory

```typescript
// src/lib/query-keys.ts
export const queryKeys = {
  dashboard: {
    today:       () => ['dashboard', 'today'] as const,
    overdue:     () => ['dashboard', 'overdue'] as const,
    defaulters:  () => ['dashboard', 'defaulters'] as const,
    fundSummary: () => ['dashboard', 'fund-summary'] as const,
  },
  loans: {
    all:            () => ['loans'] as const,
    list:           (filters: Record<string, unknown>) => ['loans', 'list', filters] as const,
    detail:         (id: string) => ['loans', 'detail', id] as const,
    transactions:   (id: string, f?: Record<string, unknown>) => ['loans', id, 'transactions', f] as const,
    paymentStatus:  (id: string) => ['loans', id, 'payment-status'] as const,
    penalties:      (id: string) => ['loans', id, 'penalties'] as const,
  },
  transactions: {
    all:     () => ['transactions'] as const,
    list:    (filters: Record<string, unknown>) => ['transactions', 'list', filters] as const,
    pending: (f?: Record<string, unknown>) => ['transactions', 'pending', f] as const,
  },
  customers: {
    all:    () => ['customers'] as const,
    list:   (filters: Record<string, unknown>) => ['customers', 'list', filters] as const,
    detail: (id: string) => ['customers', 'detail', id] as const,
    loans:  (id: string) => ['customers', id, 'loans'] as const,
  },
  expenses: { list: (f: Record<string, unknown>) => ['expenses', 'list', f] as const },
  fund:     { entries: (f?: Record<string, unknown>) => ['fund', 'entries', f] as const,
              summary: () => ['fund', 'summary'] as const },
  reports:  { profitLoss: (from: string, to: string) => ['reports', 'pl', from, to] as const,
              collectorSummary: (from: string, to: string) => ['reports', 'cs', from, to] as const,
              loanBook: () => ['reports', 'loan-book'] as const },
  users:    { list: () => ['users', 'list'] as const },
  platform: { stats: () => ['platform', 'stats'] as const,
              tenants: { list: (f?: Record<string, unknown>) => ['platform', 'tenants', f] as const,
                         detail: (id: string) => ['platform', 'tenants', id] as const } },
} as const;
```

### 5.2 QueryClient Defaults

```typescript
staleTime: 2 * 60 * 1000,     // 2 min — data fresh
gcTime:    10 * 60 * 1000,    // 10 min — cache retained
retry: 2,                      // Retry failed queries twice
refetchOnWindowFocus: true,    // Re-fetch when user returns to tab
refetchOnReconnect: true,      // Re-fetch when network returns
mutations: { retry: 0 },       // Never retry mutations
```

### 5.3 Infinite Scroll for Lists

All list pages (loans, customers, transactions, expenses, fund entries) use `useInfiniteQuery`:

```typescript
export function useLoans(filters: Omit<ListLoansParams, 'page'>) {
  return useInfiniteQuery({
    queryKey: queryKeys.loans.list(filters),
    queryFn: ({ pageParam = 1 }) => listLoans({ ...filters, page: pageParam, limit: 20 }),
    getNextPageParam: (lastPage) => {
      const { page, totalPages } = lastPage.pagination;
      return page < totalPages ? page + 1 : undefined;
    },
    initialPageParam: 1,
  });
}
```

### 5.4 Mutation Patterns

**Standard mutation** (create, update, delete):
```typescript
useMutation({
  mutationFn: ...,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ... }),
});
```

**Optimistic updates** (approve/reject):
```typescript
onMutate: async (id) => {
  await queryClient.cancelQueries({ queryKey: ... });
  const previous = queryClient.getQueryData(...);
  queryClient.setQueryData(..., (old) => /* remove item from list */);
  return { previous };
},
onError: (_err, _id, ctx) => queryClient.setQueryData(..., ctx?.previous),
onSettled: () => queryClient.invalidateQueries({ queryKey: ... }),
```

---

## 6. Form Patterns

### 6.1 Stack: React Hook Form + Zod

Each feature defines Zod schemas in `schemas.ts`. Forms use `useForm({ resolver: zodResolver(schema) })`.

### 6.2 Date Rule

**Date pickers output `YYYY-MM-DD` strings. Forms store strings. API receives strings. Never pass `Date` objects across boundaries.** This prevents timezone-induced date shifts.

```typescript
const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
```

### 6.3 API Error → Form Mapping

The backend returns validation errors as:
```json
{ "field": "borrower_id", "message": "Borrower not found", "source": "body" }
```

Mapped to React Hook Form:
```typescript
function mapApiErrorsToForm<T extends FieldValues>(details: unknown[], setError: UseFormSetError<T>) {
  (details as ApiValidationDetail[]).forEach((d) => {
    if (d.field && d.source === 'body') {
      setError(snakeToCamel(d.field) as Path<T>, { type: 'server', message: d.message });
    }
  });
}
```

### 6.4 Live Calculations

On the Create Loan form, preview values update as the user types:
- Monthly: advance interest = `principal * rate / 100`
- Daily: total repayment = `principal * (1 + rate/100 * termDays/30)`, daily payment = `total / termDays`

These are preview-only. The actual values are computed server-side on submission.

---

## 7. Routing & Layouts

### 7.1 Layout Groups

| Group | Path Prefix | Shell | Role |
|-------|-------------|-------|------|
| `(auth)` | `/login` | No nav, centered card | Unauthenticated |
| `(app)/(admin)` | `/dashboard`, `/loans`, `/customers`, `/money`, `/more` | Bottom tab bar (5 tabs) + FAB | Admin |
| `(app)/(collector)` | `/today`, `/loans`, `/customers`, `/profile` | Bottom tab bar (4 tabs) + FAB | Collector |
| `(app)/(platform)` | `/platform` | Sidebar | Super Admin |
| `(app)/shared` | `/shared/profile`, `/shared/change-password` | Inherits parent | All |

### 7.2 Tab Definitions

**Admin tabs:**

| Tab | Icon | Path | Badge |
|-----|------|------|-------|
| Home | LayoutDashboard | `/dashboard` | Pending approvals count |
| Loans | Briefcase | `/loans` | — |
| Customers | Users | `/customers` | — |
| Money | Wallet | `/money` | — |
| More | Menu | `/more` | — |

**Collector tabs:**

| Tab | Icon | Path |
|-----|------|------|
| Today | Calendar | `/today` |
| Loans | Briefcase | `/loans` |
| Customers | Users | `/customers` |
| Profile | UserCircle | `/profile` |

### 7.3 Loading & Error Boundaries

Every layout group gets `loading.tsx` (skeleton screens) and `error.tsx` (error UI with retry button).

---

## 8. Component Architecture

### 8.1 shadcn/ui Primitives

Installed via `npx shadcn-ui@latest add <name>`:

`button`, `input`, `select`, `dialog`, `sheet`, `tabs`, `badge`, `skeleton`, `card`, `dropdown-menu`, `tooltip`, `switch`, `label`, `textarea`, `popover`, `calendar`, `command`, `scroll-area`, `progress`, `alert-dialog`

Toast: using `sonner` (shadcn/ui's recommended toast).

### 8.2 Custom Shared Components

| Component | Purpose | Key Props |
|-----------|---------|-----------|
| `CurrencyDisplay` | Renders `Rs 1,00,000.00` | `amount: number` |
| `CurrencyInput` | Numeric input with Rs prefix + live format preview | `value, onValueChange` |
| `DatePicker` | Calendar popover returning `YYYY-MM-DD` string | `value: string, onChange` |
| `LoanPicker` | Type-ahead search by loan number or borrower name | `value, onChange` |
| `CustomerPicker` | Type-ahead search by name or phone | `value, onChange` |
| `StatusBadge` | Color-coded badge for loan/transaction/penalty status | `status, variant` |
| `EmptyState` | Illustration + message + optional CTA | `title, description, action?` |
| `PullToRefresh` | Touch gesture handler for mobile | `onRefresh, children` |
| `InfiniteList` | Scroll-triggered pagination | `query result, renderItem` |
| `OfflineBanner` | Orange bar: "You are offline. Data may be outdated." | Uses `useOnlineStatus` |
| `PageHeader` | Title + back button + action | `title, backHref?, action?` |
| `ConfirmationDialog` | Alert dialog for destructive actions | `title, description, onConfirm` |
| `FAB` | Floating action button | `icon, label, onClick` |
| `BottomTabBar` | Fixed bottom navigation | `tabs, activeTab` |
| `SidebarNav` | Desktop sidebar for Super Admin | `items, activeItem` |

### 8.3 Status Color Mapping

```typescript
// Loans: ACTIVE=green, CLOSED=grey, DEFAULTED=red, WRITTEN_OFF=dark-red, CANCELLED=orange
// Approval: PENDING=amber, APPROVED=green, REJECTED=red
// Penalties: PENDING=amber, PARTIALLY_PAID=blue, PAID=green, WAIVED=grey
```

### 8.4 Theme

**Light mode only. No dark mode. No per-tenant customization.** One fixed set of brand colors defined as CSS custom properties, consumed by Tailwind and shadcn/ui.

```css
/* src/styles/globals.css */
@layer base {
  :root {
    --background:        0 0% 100%;        /* #ffffff */
    --foreground:        222 47% 11%;      /* #1e293b (slate-800) */

    --primary:           217 91% 40%;      /* #1e40af (blue-800) — brand */
    --primary-foreground: 0 0% 100%;

    --secondary:         210 40% 96%;      /* #f1f5f9 (slate-100) */
    --secondary-foreground: 215 25% 27%;

    --muted:             210 40% 96%;
    --muted-foreground:  215 16% 47%;

    --accent:            210 40% 96%;
    --accent-foreground: 215 25% 27%;

    --destructive:       0 84% 60%;        /* #ef4444 (red-500) */
    --destructive-foreground: 0 0% 100%;

    --card:              0 0% 100%;
    --card-foreground:   222 47% 11%;

    --popover:           0 0% 100%;
    --popover-foreground: 222 47% 11%;

    --border:            214 32% 91%;      /* #e2e8f0 (slate-200) */
    --input:             214 32% 91%;
    --ring:              217 91% 40%;      /* matches primary */

    --radius:            0.5rem;

    /* Semantic tokens (non-shadcn) */
    --success:           142 71% 45%;      /* #22c55e (green-500) */
    --warning:           38 92% 50%;       /* #f59e0b (amber-500) */
    --info:              199 89% 48%;      /* #0ea5e9 (sky-500) */
  }
}
```

These variables follow the **shadcn/ui HSL convention** (`H S% L%` without commas) so Tailwind's `hsl(var(--primary))` pattern works out of the box. All shadcn/ui components reference these variables — no component-level color overrides needed.

**Design rationale:**
- `--primary` (`#1e40af`) matches the PWA `theme_color` and is used for buttons, links, active tab indicators, and the FAB.
- `--destructive` is reserved for delete/cancel/write-off actions.
- `--success`, `--warning`, `--info` are used by `StatusBadge` and toast notifications (not part of shadcn/ui defaults, added as semantic extensions).

---

## 9. State Management

| Category | Solution | Scope |
|----------|----------|-------|
| Server state | TanStack Query | All API data (loans, customers, dashboard, etc.) |
| Auth state | Zustand (persisted) | `accessToken`, `refreshToken`, `user`, `expiresAt` |
| UI state | Zustand | `sidebarOpen`, `activeFilters`, `selectedTab` |
| Form state | React Hook Form | Local to each form |
| Offline cache | IndexedDB (via `idb`) | Last-viewed data for offline reads |

No Redux. No Context API for state.

---

## 10. PWA Configuration

### 10.1 Service Worker (next-pwa + Workbox)

```typescript
// next.config.ts
runtimeCaching: [
  // Static assets: StaleWhileRevalidate
  { urlPattern: /\.(js|css|woff2?)$/i, handler: 'StaleWhileRevalidate' },
  // API GETs: NetworkFirst with 5s timeout, fallback to cache
  { urlPattern: /\/api\/v1\/(dashboard|loans|customers|fund|reports)/,
    handler: 'NetworkFirst', method: 'GET',
    options: { cacheName: 'api-cache', networkTimeoutSeconds: 5,
               expiration: { maxEntries: 100, maxAgeSeconds: 86400 } } },
]
```

### 10.2 Web App Manifest

```json
{
  "name": "LoanTrack",
  "short_name": "LoanTrack",
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#1e40af",
  "background_color": "#ffffff",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable.png", "sizes": "512x512", "purpose": "maskable" }
  ]
}
```

### 10.3 IndexedDB Offline Cache

```typescript
// src/lib/offline-db.ts
interface LoanTrackDB extends DBSchema {
  dashboardCache: { key: string; value: { data: unknown; cachedAt: number } };
  loanCache:      { key: string; value: { data: unknown; cachedAt: number } };
  customerCache:  { key: string; value: { data: unknown; cachedAt: number } };
}
// Max age: 24 hours. Stale-while-revalidate pattern.
```

### 10.4 Offline Detection

```typescript
// src/hooks/use-online-status.ts
// Uses useSyncExternalStore with window 'online'/'offline' events
// Returns boolean. SSR snapshot: true (assume online).
```

**Offline UX:** Orange bar at top, all submit buttons disabled with tooltip "Requires network connection", cached lists/details still browsable.

---

## 11. Environment Variables

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | Yes | `https://api.loantrack.app` | Backend API base URL |
| `NEXT_PUBLIC_APP_NAME` | No | `LoanTrack` | Display name in UI and manifest |

---

## 12. Type System

### 12.1 API Envelope Types

```typescript
// src/types/api.ts
export interface PaginatedResponse<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface ApiError {
  code: 'VALIDATION_ERROR' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' |
        'CONFLICT' | 'RATE_LIMIT_EXCEEDED' | 'INTERNAL_ERROR';
  message: string;
  details: Array<{ field: string; message: string; source: string }>;
  status: number;
}
```

### 12.2 Enum Types

```typescript
// src/types/enums.ts
export type LoanType = 'MONTHLY' | 'DAILY';
export type LoanStatus = 'ACTIVE' | 'CLOSED' | 'DEFAULTED' | 'WRITTEN_OFF' | 'CANCELLED';
export type TransactionType =
  | 'DISBURSEMENT' | 'ADVANCE_INTEREST' | 'INTEREST_PAYMENT' | 'PRINCIPAL_RETURN'
  | 'DAILY_COLLECTION' | 'PENALTY' | 'GUARANTOR_PAYMENT' | 'INTEREST_WAIVER'
  | 'PENALTY_WAIVER' | 'OPENING_BALANCE';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type PenaltyStatus = 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'WAIVED';
export type ExpenseCategory = 'TRAVEL' | 'SALARY' | 'OFFICE' | 'LEGAL' | 'MISC';
export type FundEntryType = 'INJECTION' | 'WITHDRAWAL';
export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'COLLECTOR';
```

### 12.3 Entity Types

Derived from backend response schemas. Key entities:

```typescript
// src/types/entities.ts

interface Customer {
  id: string; fullName: string; phone: string; alternatePhone: string | null;
  address: string | null; aadhaarNumber: string | null; panNumber: string | null;
  idProofType: string | null; occupation: string | null; notes: string | null;
  isDefaulter: boolean; createdAt: string;
}

interface Loan {
  id: string; loanNumber: string; loanType: LoanType; borrowerId: string;
  borrowerName: string; principalAmount: number; interestRate: number;
  disbursementDate: string; status: LoanStatus; guarantorId: string | null;
  guarantorName: string | null; isMigrated: boolean; createdAt: string;
}

interface MonthlyLoanDetail extends Loan {
  remainingPrincipal: number; billingPrincipal: number; advanceInterestAmount: number;
  lastInterestPaidThrough: string | null; expectedMonths: number | null;
  monthlyDueDay: number; monthlyInterestDue: number; nextDueDate: string | null;
  isOverdue: boolean; totalInterestCollected: number; monthsActive: number;
  collateralDescription: string | null; collateralEstimatedValue: number | null;
  notes: string | null; closureDate: string | null; closedById: string | null;
}

interface DailyLoanDetail extends Loan {
  termDays: number; totalRepaymentAmount: number; dailyPaymentAmount: number;
  termEndDate: string; graceDays: number; totalCollected: number;
  totalRemaining: number; daysPaid: number; daysRemaining: number;
  daysElapsed: number; isOverdue: boolean; daysOverdue: number; isBasePaid: boolean;
  collateralDescription: string | null; collateralEstimatedValue: number | null;
  notes: string | null; closureDate: string | null; closedById: string | null;
}

interface Transaction {
  id: string; loanId: string; transactionType: TransactionType; amount: number;
  transactionDate: string; effectiveDate: string | null;
  approvalStatus: ApprovalStatus; notes: string | null; createdAt: string;
}

interface TransactionDetail extends Transaction {
  loanNumber: string; borrowerName: string; collectedById: string | null;
  collectorName: string | null; approvedById: string | null;
  approvedAt: string | null; rejectionReason: string | null;
}

interface BulkCollectionResult {
  created: number; failed: number;
  results: Array<{ success: boolean; transaction?: Transaction; error?: string }>;
}

interface Penalty {
  id: string; loanId: string; daysOverdue: number; monthsCharged: number;
  penaltyAmount: number; waivedAmount: number; netPayable: number;
  imposedDate: string; status: PenaltyStatus; amountCollected: number;
  notes: string | null; createdById: string; createdAt: string;
}

interface Expense {
  id: string; category: ExpenseCategory; amount: number;
  description: string | null; expenseDate: string; isDeleted: boolean;
  createdById: string; createdAt: string;
}

interface FundEntry {
  id: string; entryType: FundEntryType; amount: number;
  description: string | null; entryDate: string;
  createdById: string; createdAt: string;
}

interface FundSummary {
  totalCapitalInvested: string; moneyDeployed: string;
  totalInterestEarned: string; moneyLostToDefaults: string;
  totalExpenses: string; revenueForgone: string;
  netProfit: string; cashInHand: string;
}
// Note: FundSummary returns money as strings (from raw SQL). Parse with parseFloat().

interface User {
  id: string; name: string; phone: string; email: string | null;
  role: UserRole; isActive: boolean; createdAt: string;
}

interface Tenant {
  id: string; name: string; slug: string; ownerName: string;
  ownerPhone: string; status: TenantStatus; createdAt: string;
}
```

### 12.4 Request Types

```typescript
// src/types/requests.ts

interface CreateCustomerRequest {
  fullName: string; phone: string; alternatePhone?: string;
  address?: string; aadhaarNumber?: string; panNumber?: string;
  idProofType?: string; occupation?: string; notes?: string;
}

interface CreateMonthlyLoanRequest {
  loanType: 'MONTHLY'; borrowerId: string; principalAmount: number;
  interestRate: number; disbursementDate: string; expectedMonths?: number;
  guarantorId?: string; collateralDescription?: string;
  collateralEstimatedValue?: number; notes?: string;
}

interface CreateDailyLoanRequest {
  loanType: 'DAILY'; borrowerId: string; principalAmount: number;
  interestRate: number; disbursementDate: string; termDays: number;
  graceDays?: number; guarantorId?: string; collateralDescription?: string;
  collateralEstimatedValue?: number; notes?: string;
}

type CreateLoanRequest = CreateMonthlyLoanRequest | CreateDailyLoanRequest;

interface CreateTransactionRequest {
  loanId: string;
  transactionType: 'INTEREST_PAYMENT' | 'PRINCIPAL_RETURN' | 'DAILY_COLLECTION' | 'PENALTY' | 'GUARANTOR_PAYMENT';
  amount: number; transactionDate: string; effectiveDate?: string;
  penaltyId?: string; correctedTransactionId?: string; notes?: string;
}

interface BulkCollectionRequest {
  collections: Array<{ loanId: string; amount: number; transactionDate: string; notes?: string }>;
}

interface CreateExpenseRequest {
  category: ExpenseCategory; amount: number;
  description?: string; expenseDate: string;
}

interface CreateFundEntryRequest {
  entryType: FundEntryType; amount: number;
  description?: string; entryDate: string;
}

interface CreateUserRequest {
  name: string; phone: string; email?: string;
  password: string; role: 'COLLECTOR';
}

interface CreateTenantRequest {
  name: string; slug: string; ownerName: string; ownerPhone: string;
  ownerEmail?: string; address?: string; adminName: string;
  adminPhone: string; adminPassword: string;
}
```

---

## 13. Code Conventions

### 13.1 Formatting

```json
// .prettierrc (matches backend)
{ "semi": true, "trailingComma": "all", "singleQuote": true, "printWidth": 100, "tabWidth": 2 }
```

ESLint: `@typescript-eslint` + `prettier` plugin + `eslint-plugin-react-hooks`.

### 13.2 Import Alias

```json
// tsconfig.json
{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }
```

### 13.3 File Naming

| Type | Convention | Example |
|------|-----------|---------|
| Route pages | `page.tsx` | `loans/page.tsx` |
| Components | kebab-case file, PascalCase export | `loan-card.tsx` → `LoanCard` |
| Hooks | kebab-case, camelCase export | `use-loans.ts` → `useLoans` |
| API modules | `.api.ts` suffix | `loans.api.ts` |
| Stores | `-store.ts` suffix | `auth-store.ts` |
| Schemas | `schemas.ts` per feature | `src/features/loans/schemas.ts` |

### 13.4 "use client" Directive

Only on components that use: React hooks, browser APIs, event handlers. Pages that just render server components omit it.

---

## 14. Key Implementation Notes

### 14.1 Currency Formatting

```typescript
// src/utils/currency.ts
const formatter = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR',
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function formatCurrency(amount: number): string {
  return formatter.format(amount).replace('₹', 'Rs ');
}
// formatCurrency(100000) → "Rs 1,00,000.00"
```

Dashboard/fund endpoints return money as **strings** (from raw SQL). Parse with `parseFloat()` before `formatCurrency()`.

### 14.2 Date Utilities

```typescript
// src/utils/date.ts
import { format, parseISO } from 'date-fns';

export function formatDate(dateStr: string): string {
  return format(parseISO(dateStr), 'dd MMM yyyy');        // "15 Jan 2026"
}

export function formatTimestamp(isoStr: string): string {
  return format(parseISO(isoStr), 'dd MMM yyyy, hh:mm a'); // "15 Jan 2026, 10:30 AM"
}

export function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
```

### 14.3 No Frontend Arithmetic

Never do financial arithmetic in the frontend. All calculations are backend-side. The only exception is live previews on the Create Loan form (advance interest, daily amount), which are display-only approximations.

### 14.4 Responsive Breakpoints

| Breakpoint | Width | Target |
|-----------|-------|--------|
| default | < 640px | Smartphone (primary) |
| `sm` | >= 640px | Large phone |
| `md` | >= 768px | Tablet |
| `lg` | >= 1024px | Desktop |

Mobile-first: all styles default to mobile. Admin/Collector optimized for mobile. Super Admin targets tablet/desktop.

---

## 15. Testing Strategy

### Unit Tests (Vitest)
- Utility functions: `currency.ts`, `date.ts`, `case-transform.ts`
- Zod schemas: valid/invalid input cases
- Query key factory: deterministic keys

### Component Tests (React Testing Library)
- Form submission + validation + API error mapping
- Status badges: correct colors per status
- Empty states: correct messages
- Conditional rendering: loan type branching, role-based visibility

### API Mocking (MSW v2)
- Mock all endpoints at network level
- Used in both component tests and Storybook (if added later)

### E2E Tests (Playwright — Phase 11)
- Login → dashboard flow
- Create loan → appears in list
- Record payment → shows in transactions
- Approve/reject workflow
- Bulk collection → result modal
- Offline banner when disconnected

---

## 16. API Endpoint Mapping (59 usages across 42 screens)

| Feature | Endpoints | Screens |
|---------|-----------|---------|
| Auth | 5 (login, refresh, logout, change-password, me) | S1, S2, S3 |
| Dashboard | 4 (today, overdue, defaulters, fund-summary) | A1-A4 |
| Loans | 10 (list, detail, create, migrate, close, default, write-off, cancel, transactions, payment-status) | A5-A9, C1, C4, C5 |
| Transactions | 6 (create, bulk, list, pending, approve, reject) | A10-A12, C2, C3 |
| Customers | 5 (list, detail, create, update, loans) | A13-A15, C6, C7 |
| Penalties | 5 (impose, list, waive, waive-interest, waivers) | A16-A19 |
| Users | 5 (list, create, update, deactivate, reset-password) | A20 |
| Expenses | 4 (list, create, update, delete) | A21 |
| Fund | 3 (entries, create, summary) | A22, A4 |
| Reports | 3 (profit-loss, collector-summary, loan-book) | A23-A25 |
| Platform | 6 (stats, tenants list/detail, create, suspend, activate) | P1-P5 |
