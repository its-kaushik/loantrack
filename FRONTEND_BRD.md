# LoanTrack Frontend - Business Requirements Document

---

## 1. Product Overview

A **mobile-first Progressive Web App (PWA)** that serves as the primary interface for LoanTrack. The app consumes the existing REST API (58 endpoints) and provides role-specific experiences for three user types: Platform Super Admin, Tenant Admin, and Collector.

- **Mobile-first**: Designed for smartphones first, responsive up to desktop
- **PWA**: Installable, works offline for critical read flows, "Add to Home Screen" capable
- **Three distinct experiences**: Super Admin console, Admin dashboard, Collector field app
- **No business logic in the frontend**: All calculations, validations, and state changes happen via the API

---

## 2. User Personas & Primary Goals

### 2.1 Admin (Primary - Build First)

The business owner or trusted partner who runs the loan operation.

**Daily routine:**
1. Morning: Check dashboard — who owes today, what's overdue, pending approvals
2. Throughout day: Disburse new loans, record payments, approve collector submissions
3. Evening: Review fund summary, check daily totals, record expenses

**Key frustrations to solve:**
- Forgetting to collect monthly interest (needs proactive reminders)
- Losing track of which daily loans are falling behind
- Not knowing the real-time profit/loss picture
- Manually calculating penalties

**Device:** Primarily smartphone (Android), occasionally desktop/tablet

### 2.2 Collector (Build Second)

The field agent who visits borrowers to collect daily payments.

**Daily routine:**
1. Morning: See assigned/active daily loans with borrower addresses
2. Field visits: Record each collection as it happens
3. End of day: Submit bulk collections, hand over cash to admin

**Key frustrations to solve:**
- Entering 20-30 collections one by one (needs bulk entry)
- Forgetting which borrowers they already visited today
- Not having borrower contact info readily available

**Device:** Smartphone only (Android), often on spotty network

### 2.3 Super Admin (Build Last)

The platform operator who onboards tenants.

**Routine:** Infrequent — onboard new tenants, suspend/reactivate, monitor platform health.

**Device:** Desktop or tablet

---

## 3. Screen Inventory

### 3.1 Shared Screens (All Roles)

| # | Screen | Purpose |
|---|--------|---------|
| S1 | **Login** | Phone + password authentication |
| S2 | **Change Password** | Current + new password form |
| S3 | **Profile** | View own details (name, phone, role, tenant) |

### 3.2 Admin Screens

| # | Screen | Purpose | API Endpoints |
|---|--------|---------|---------------|
| A1 | **Dashboard - Today** | Today's summary: collections expected/received, missed payments, monthly interest due, pending approvals | `GET /dashboard/today` |
| A2 | **Dashboard - Overdue** | Overdue daily and monthly loans | `GET /dashboard/overdue` |
| A3 | **Dashboard - Defaulters** | Defaulted and written-off loans with borrower/guarantor details | `GET /dashboard/defaulters` |
| A4 | **Dashboard - Fund Summary** | 8 financial KPIs (capital, deployed, interest, losses, expenses, profit, cash) | `GET /dashboard/fund-summary` |
| A5 | **Loan List** | Paginated, filterable list of all loans (type, status, borrower, search by number) | `GET /loans` |
| A6 | **Loan Detail - Monthly** | Full loan view: principal, remaining, billing principal (with info tooltip: "Interest is calculated on billing principal, which equals principal minus any principal returned"), interest rate, payment status cycles, transactions, penalties, waivers | `GET /loans/:id`, `GET /loans/:id/payment-status`, `GET /loans/:id/transactions` |
| A7 | **Loan Detail - Daily** | Full loan view: principal, total repayment, daily amount, days paid, progress bar, overdue status, collection history | `GET /loans/:id`, `GET /loans/:id/payment-status`, `GET /loans/:id/transactions` |
| A8 | **Create Loan** | Form: loan type toggle, borrower picker, principal, rate, term/dates, guarantor, collateral, notes. Shows calculated values (advance interest / daily amount) before confirmation | `POST /loans` |
| A9 | **Migrate Loan** | Similar to Create Loan but with migration-specific fields (remaining principal, last interest paid through, total collected so far, pre-existing penalties) | `POST /loans/migrate` |
| A10 | **Record Payment** | Select loan, choose transaction type, enter amount, date, effective date. Shows interest due / daily amount as reference | `POST /transactions` |
| A11 | **Pending Approvals** | List of collector-submitted payments awaiting approval. Approve or reject (with reason) | `GET /transactions/pending`, `PATCH /transactions/:id/approve`, `PATCH /transactions/:id/reject` |
| A12 | **Transaction History** | Paginated, filterable list of all transactions across loans. Each approved transaction row has a "Reverse" action that opens the correction flow (see Flow 4.10) | `GET /transactions`, `POST /transactions` (corrective) |
| A13 | **Customer List** | Paginated, searchable list of customers (name, phone, defaulter flag) | `GET /customers` |
| A14 | **Customer Detail** | Customer info, guarantor warnings, list of their loans | `GET /customers/:id`, `GET /customers/:id/loans` |
| A15 | **Create/Edit Customer** | Form: name, phone, address, ID docs, occupation, notes | `POST /customers`, `PUT /customers/:id` |
| A16 | **Impose Penalty** | Shows calculated penalty (incremental months, amount). Admin confirms or overrides | `POST /loans/:id/penalties` |
| A17 | **Waive Penalty** | Enter waive amount, optional notes | `PATCH /penalties/:id/waive` |
| A18 | **Waive Interest** | Select billing cycle, enter waive amount, optional notes | `POST /loans/:id/waive-interest` |
| A19 | **Penalty List** | Penalties for a loan: status, amount, waived, net payable, collected | `GET /loans/:id/penalties` |
| A20 | **User Management** | List users, create collector accounts, deactivate, reset passwords | `GET /users`, `POST /users`, `PUT /users/:id`, `PATCH /users/:id/deactivate`, `POST /users/:id/reset-password` |
| A21 | **Expenses** | List, create, edit, delete expenses by category and date | `GET /expenses`, `POST /expenses`, `PUT /expenses/:id`, `PATCH /expenses/:id/delete` |
| A22 | **Fund Management** | List fund entries (injections/withdrawals), create new, view fund summary and reconciliation | `GET /fund/entries`, `POST /fund/entries`, `GET /fund/summary`, `GET /fund/reconciliation` |
| A23 | **Reports - Profit & Loss** | Date range selector, shows P&L breakdown | `GET /reports/profit-loss` |
| A24 | **Reports - Collector Summary** | Date range, per-collector stats (collections, approvals, rejections) | `GET /reports/collector-summary` |
| A25 | **Reports - Loan Book** | Full loan book: all loans with outstanding amounts and interest earned | `GET /reports/loan-book` |

### 3.3 Collector Screens

| # | Screen | Purpose | API Endpoints |
|---|--------|---------|---------------|
| C1 | **My Collections Today** | Active daily loans assigned/available, who is due today, one-tap to record. Includes a **Cash Handover** summary card at top showing total cash collected today (count + amount) for end-of-day handover to admin | `GET /loans` (filtered) |
| C2 | **Record Collection** | Quick entry: select loan, amount, date | `POST /transactions` |
| C3 | **Bulk Collection** | Multi-loan entry form (20-30 at once), single submit with idempotency | `POST /transactions/bulk` |
| C4 | **Loan List** | View active loans (read-only, no closed/defaulted) | `GET /loans` (status=ACTIVE) |
| C5 | **Loan Detail** | Read-only view of loan details and collection progress | `GET /loans/:id` |
| C6 | **Customer List** | Search/browse customers for contact info | `GET /customers` |
| C7 | **Customer Detail** | Read-only customer info | `GET /customers/:id` |

### 3.4 Super Admin Screens

| # | Screen | Purpose | API Endpoints |
|---|--------|---------|---------------|
| P1 | **Platform Dashboard** | Tenant counts (active/suspended/deactivated), loan stats, total users | `GET /platform/stats` |
| P2 | **Tenant List** | Paginated, filterable list of tenants | `GET /platform/tenants` |
| P3 | **Tenant Detail** | Tenant info with active loans, users, customers count | `GET /platform/tenants/:id` |
| P4 | **Onboard Tenant** | Create tenant + first admin account in one form | `POST /platform/tenants` |
| P5 | **Suspend/Activate Tenant** | Toggle tenant status with confirmation | `PATCH /platform/tenants/:id/suspend`, `PATCH /platform/tenants/:id/activate` |

---

## 4. User Flows

### 4.1 Authentication Flow

```
Login Screen
  ├─ Enter phone + password
  ├─ On success → store access_token + refresh_token
  ├─ Route by role:
  │   ├─ SUPER_ADMIN → Platform Dashboard (P1)
  │   ├─ ADMIN → Dashboard Today (A1)
  │   └─ COLLECTOR → My Collections Today (C1)
  └─ On failure → show error, stay on login
```

**Token refresh:** Silently refresh access token before expiry (at ~80% of `expires_in`). If refresh fails → redirect to login.

**Logout:** Clear tokens, redirect to login.

### 4.2 Admin - Morning Review Flow

```
Dashboard Today (A1)
  ├─ Pending Approvals badge (count) → tap → Pending Approvals (A11)
  │   ├─ Review each → Approve or Reject
  │   └─ Back to Dashboard
  ├─ Missed Collections list → tap borrower → Loan Detail Daily (A7)
  │   └─ Record Collection → Record Payment (A10)
  ├─ Monthly Interest Due list → tap loan → Loan Detail Monthly (A6)
  │   └─ Record Interest → Record Payment (A10)
  └─ Overdue tab → Dashboard Overdue (A2)
      ├─ Tap overdue loan → Loan Detail (A6/A7)
      └─ Impose Penalty if applicable (A16)
```

### 4.3 Admin - Disburse New Loan Flow

```
Loan List (A5) → "New Loan" button → Create Loan (A8)
  ├─ Select loan type (Monthly / Daily toggle)
  ├─ Search & select borrower (or create new → A15 → back)
  ├─ Enter: principal, interest rate
  ├─ Monthly: expected months (optional)
  │   └─ System shows: advance interest amount, monthly due day
  ├─ Daily: term days, grace days
  │   └─ System shows: total repayment, daily payment amount
  │   └─ If daily amount not round → admin adjusts principal → recalculates live
  ├─ Optional: guarantor picker, collateral, notes
  ├─ Review summary → Confirm
  └─ Success → Loan Detail (A6/A7)
```

### 4.4 Admin - Record Payment Flow (Monthly Interest)

```
Loan Detail Monthly (A6)
  ├─ Shows: current billing cycle, interest due, remaining principal
  ├─ "Record Payment" → Record Payment (A10)
  │   ├─ Pre-filled: loan, INTEREST_PAYMENT type, interest due amount
  │   ├─ Admin can enter different amount:
  │   │   ├─ Less than interest due → partial payment
  │   │   └─ More than interest due → auto-splits (shown as preview)
  │   ├─ Set transaction date and effective date
  │   └─ Confirm → API creates 1 or 2 transactions
  └─ Refreshed loan detail shows updated payment status
```

### 4.5 Admin - Penalty Flow (Daily Loan)

```
Loan Detail Daily (A7) → loan is overdue
  ├─ "Impose Penalty" → Impose Penalty (A16)
  │   ├─ System shows: days overdue, incremental months, calculated amount
  │   ├─ Admin confirms or enters override amount
  │   └─ Confirm → penalty created
  ├─ "Waive Penalty" → Waive Penalty (A17)
  │   ├─ Enter waive amount (full or partial)
  │   └─ Confirm
  └─ Penalty collection → Record Payment (A10, PENALTY type)
```

### 4.6 Admin - Loan Closure Flow

```
Loan Detail (A6/A7) → all conditions met
  ├─ Monthly: remaining principal = 0, all cycles settled
  ├─ Daily: total collected >= total repayment, all penalties settled
  ├─ "Close Loan" button becomes active
  ├─ Confirmation dialog
  └─ Loan status → CLOSED
```

### 4.7 Admin - Default & Write-off Flow

```
Loan Detail (A6/A7)
  ├─ "Mark as Defaulted" → confirmation dialog
  │   └─ Loan status → DEFAULTED, customer flagged as defaulter
  ├─ On defaulted loan: "Record Guarantor Payment" → Record Payment (A10, GUARANTOR_PAYMENT)
  ├─ If recovered → "Close Loan"
  └─ If unrecoverable → "Write Off" → confirmation → WRITTEN_OFF
```

### 4.8 Collector - Daily Collection Flow

```
My Collections Today (C1)
  ├─ Cash Handover card at top:
  │   └─ "Today's Collections: X items, Rs Y total" (running tally for handover)
  ├─ List of active daily loans with: borrower name, phone, daily amount, address
  ├─ Tap loan → Record Collection (C2)
  │   ├─ Pre-filled: loan, DAILY_COLLECTION, daily amount
  │   ├─ Adjust amount if needed
  │   ├─ Confirm → status = PENDING (awaits admin approval)
  │   └─ Loan card shows "submitted" indicator
  └─ Or: "Bulk Submit" → Bulk Collection (C3)
      ├─ Multi-row form: each row = loan picker + amount
      ├─ Add/remove rows
      ├─ Single submit with idempotency key
      └─ Submission Result modal (see Section 8.5)
```

### 4.9 Super Admin - Tenant Onboarding Flow

```
Tenant List (P2) → "New Tenant" → Onboard Tenant (P4)
  ├─ Enter: business name, slug, owner details
  ├─ Enter: first admin name, phone, password
  ├─ Confirm
  └─ Success → Tenant Detail (P3)
```

### 4.10 Admin - Correction / Reversal Flow

```
Transaction History (A12)
  ├─ Each APPROVED transaction row shows "Reverse" action (icon button or swipe)
  │   └─ Disabled for transactions that already have a correction
  ├─ Tap "Reverse" → Confirmation bottom sheet:
  │   ├─ Shows: original transaction details (type, amount, date, loan number)
  │   ├─ Pre-filled: same loan, same type, negative amount, today's date
  │   ├─ Editable: transaction date, notes (reason for reversal is required)
  │   ├─ Warning text: "This will create a corrective transaction that reverses
  │   │   the original. Loan balances will be adjusted automatically."
  │   └─ "Confirm Reversal" button
  ├─ On success:
  │   ├─ Toast: "Transaction reversed successfully"
  │   ├─ Original row shows "Corrected" badge (greyed out)
  │   └─ New corrective transaction appears in list (negative amount, auto-approved)
  └─ On Loan Detail (A6/A7):
      └─ Corrective transactions shown inline with strikethrough on the original
```

**API details:** Corrections use `POST /transactions` with `corrected_transaction_id` pointing to the original and a negative `amount`. The API validates same-loan, same-type, original must be APPROVED, and no prior correction exists. Corrective transactions are auto-approved.

---

## 5. Navigation Structure

### 5.1 Admin Navigation (Bottom Tab Bar - Mobile)

| Tab | Icon | Default Screen | Badge | Accessible Screens |
|-----|------|----------------|-------|--------------------|
| **Home** | Dashboard | Dashboard Today (A1) | Pending approvals count | A1, A2, A3, A4 (swipe tabs within dashboard) |
| **Loans** | Briefcase | Loan List (A5) | — | A5 → A6/A7 (detail) → A8 (create), A9 (migrate), A10 (record payment), A16-A19 (penalties) |
| **Customers** | People | Customer List (A13) | — | A13 → A14 (detail) → A15 (create/edit) |
| **Money** | Wallet | Fund Summary (A22) | — | A22, A21 (expenses), A23-A25 (reports) |
| **More** | Menu | Settings menu | — | A11, A12, A20, S2, S3 |

**"More" menu items:**
- Pending Approvals (A11) — with badge count
- Transaction History (A12)
- User Management (A20)
- Profile (S3)
- Change Password (S2)
- Logout

**Floating Action Button (FAB):**
- Context-sensitive: "New Loan" on Loans tab, "New Customer" on Customers tab, "New Entry" on Money tab

### 5.2 Collector Navigation (Bottom Tab Bar - Mobile)

| Tab | Icon | Default Screen | Accessible Screens |
|-----|------|----------------|--------------------|
| **Today** | Calendar | My Collections Today (C1) | C1 → C2 (record) → C3 (bulk) |
| **Loans** | Briefcase | Loan List (C4) | C4 → C5 (detail, read-only) |
| **Customers** | People | Customer List (C6) | C6 → C7 (detail, read-only) |
| **Profile** | User | Profile (S3) | S3, S2 (change password) |

**FAB:** "Bulk Submit" on Today tab

### 5.3 Super Admin Navigation (Sidebar - Desktop/Tablet)

| Item | Icon | Default Screen | Accessible Screens |
|------|------|----------------|--------------------|
| Dashboard | Chart | Platform Dashboard (P1) | P1 |
| Tenants | Building | Tenant List (P2) | P2 → P3 (detail) → P4 (onboard), P5 (suspend/activate) |
| Profile | User | Profile (S3) | S3, S2 (change password) |
| Logout | Exit | — | — |

---

## 6. Key UX Requirements

### 6.1 Mobile-First Design Principles

- **Touch targets**: Minimum 44x44px for all interactive elements
- **One-hand operation**: Primary actions reachable with thumb (bottom of screen)
- **Swipe gestures**: Swipe on list items for quick actions (approve/reject on pending list)
- **Pull to refresh**: On all list screens and dashboard
- **Sticky headers**: Table/list headers remain visible when scrolling
- **Bottom sheet modals**: For secondary forms and confirmations (not full-page navigations)

### 6.2 Data Entry Optimizations

- **Numeric keypad**: Auto-open numeric keyboard for amount fields (`inputMode="numeric"`)
- **Pre-filled defaults**: Daily amount pre-filled on collection forms, interest due pre-filled on payment forms
- **Loan picker with search**: Type-ahead search by loan number or borrower name
- **Customer picker with search**: Type-ahead search by name or phone
- **Date picker**: Calendar widget with "today" shortcut. Default to today for transaction dates. **Date pickers must strip time and timezone information and submit strictly as `YYYY-MM-DD` string literals** (e.g., `"2025-11-15"`, never an ISO datetime). This prevents timezone-induced date shifts where a midnight UTC conversion moves the date forward or backward.
- **Live calculations**: Show computed values as the admin types (e.g., advance interest updates as principal changes)

### 6.3 Currency Formatting

- Indian Rupee format: `Rs 1,00,000.00` (lakhs/crores grouping)
- Always show 2 decimal places for money amounts
- Use `Rs` prefix (not the Unicode rupee symbol) for clarity on all devices

### 6.4 Status Indicators

**Loan statuses** (color-coded):
- ACTIVE: Green
- CLOSED: Grey
- DEFAULTED: Red
- WRITTEN_OFF: Dark red
- CANCELLED: Orange

**Transaction approval statuses**:
- PENDING: Yellow/amber badge
- APPROVED: Green badge
- REJECTED: Red badge

**Penalty statuses**:
- PENDING: Yellow
- PARTIALLY_PAID: Blue
- PAID: Green
- WAIVED: Grey

### 6.5 Empty States

Every list screen must have a meaningful empty state:
- Loan List: "No loans yet. Create your first loan to get started."
- Pending Approvals: "All caught up! No pending approvals."
- Today's Missed: "Great! All daily collections received today."
- Customer List: "No customers yet. Add your first customer."

### 6.6 Loading States

- Skeleton screens for lists and dashboards (not spinners)
- Inline loading indicators for form submissions
- Optimistic updates for approve/reject actions (show change immediately, revert on error)

### 6.7 Error Handling

- Toast notifications for transient errors (network failures, rate limits)
- Inline field errors for validation failures (mapped from API `details` array)
- Full-screen error state for critical failures (auth expired, tenant suspended)
- "Retry" button on failed data loads

---

## 7. PWA Requirements

### 7.1 Installability

- Web app manifest with app name, icons (192px, 512px), theme color
- "Add to Home Screen" prompt after 2nd visit
- Splash screen on launch

### 7.2 Offline Support

**Strategy: Read-only offline via IndexedDB + Service Worker**

The app uses IndexedDB (via a lightweight wrapper like `idb`) to cache API responses locally. The service worker handles cache-first reads when offline.

**What is cached (read-only):**
- Dashboard data (today summary, overdue, defaulters, fund summary)
- Loan list (last-viewed page and filters) and last 20 viewed loan details
- Customer list (last-viewed page) and last 20 viewed customer details
- User profile and role information

**Cache update strategy:**
- Stale-while-revalidate: Serve cached data immediately, then refresh from network in background
- Cache invalidation: Clear relevant cache entries after successful write operations
- Max cache age: 24 hours — entries older than this are purged on next app open

**Offline UX:**
- **Orange indicator bar** pinned at top of screen: "You are offline. Data may be outdated." — persists until connection restored
- **All submit/action buttons disabled** when offline: greyed out with tooltip "Requires network connection"
- **Specifically disabled:** Record Payment, Create Loan, Approve/Reject, Bulk Submit, Create Customer, Impose Penalty, all write actions
- **Still functional:** Browsing cached lists, viewing cached loan/customer details, viewing dashboard, navigating between cached screens
- **Network restored:** Orange bar dismisses automatically, buttons re-enable, background revalidation triggers

**Not offline:** All write operations (payments, loan creation, approvals) require network. No offline queue or sync in V1 — this avoids conflict resolution complexity.

### 7.3 Performance Targets

- First Contentful Paint: < 2s on 3G
- Time to Interactive: < 4s on 3G
- Lighthouse PWA score: > 90

---

## 8. Data Display Specifications

### 8.1 Dashboard Today (A1)

**Layout:** Card-based, single column on mobile

| Card | Data | Visual |
|------|------|--------|
| **Collection Progress** | Expected vs received today (count + amount) | Progress bar (received/expected) |
| **Pending Approvals** | Count of pending transactions | Tappable badge → navigates to A11 |
| **Missed Today** | List of daily loans with no collection today: borrower name, daily amount, phone (tap-to-call) | Scrollable list, max 5 visible, "See all" link |
| **Monthly Interest Due** | Monthly loans with interest due today: borrower name, interest amount, loan number | Scrollable list |
| **Today's Total** | Total amount collected today | Large number, prominent |

### 8.2 Loan Detail - Monthly (A6)

**Sections (scrollable):**

1. **Header**: Loan number, status badge, borrower name (tappable → customer detail)
2. **Key Metrics**: Principal, remaining principal, billing principal (with ℹ️ tooltip: "Billing principal = Original principal − Principal returned. Monthly interest is calculated on this amount."), interest rate, advance interest, monthly due day
3. **Quick Actions**: Record Payment, Close Loan (if eligible), Mark Default, Cancel (if eligible)
4. **Payment Status**: Table of billing cycles — month, interest due, interest paid, waived, settled (checkmark). Current cycle highlighted.
5. **Transaction History**: Chronological list of all transactions on this loan. Corrected transactions shown with strikethrough and "Corrected" badge. Corrective transactions shown with negative amount in red and link to original.
6. **Loan Info**: Disbursement date, guarantor, collateral, notes, created by, migrated flag

### 8.3 Loan Detail - Daily (A7)

**Sections (scrollable):**

1. **Header**: Loan number, status badge, borrower name
2. **Progress Bar**: Total collected / total repayment (visual percentage)
3. **Key Metrics**: Principal, total repayment, daily amount, term days, days elapsed, days paid, days remaining, total collected, total remaining, grace days
4. **Overdue Alert**: If overdue — days overdue, penalty applicable (red banner)
5. **Quick Actions**: Record Collection, Impose Penalty (if overdue), Close Loan (if eligible), Mark Default
6. **Collection Calendar**: Grid view of term days — green (paid), red (missed), grey (future). Tap day for detail.
7. **Transaction History**: Chronological list
8. **Loan Info**: Disbursement date, term end date, guarantor, collateral, notes

### 8.4 Create Loan Form (A8)

**Step-by-step or single scrollable form:**

1. **Loan Type Toggle**: Monthly / Daily (switches form fields)
2. **Borrower**: Search picker (type-ahead). "Create New" shortcut.
3. **Principal Amount**: Numeric input. For daily: live preview of daily amount.
4. **Interest Rate**: Numeric input (% per month)
5. **Monthly-specific**: Expected months (optional)
6. **Daily-specific**: Term days (120/60 picker or custom), Grace days
7. **Disbursement Date**: Date picker (default today)
8. **Calculated Preview**:
   - Monthly: "Advance interest: Rs X. Monthly interest: Rs Y. Due day: Nth."
   - Daily: "Total repayment: Rs X. Daily payment: Rs Y. Term ends: Date."
9. **Optional Section** (collapsible): Guarantor picker, collateral description, collateral value, notes
10. **Confirm Button**: Disabled until required fields filled

### 8.5 Bulk Collection Form (C3)

**Layout:**

- Header: "Bulk Collection" with date picker (default today)
- Rows: Each row = Loan picker (search by number/borrower) + Amount (pre-filled with daily amount) + Remove button
- "Add Row" button at bottom
- Footer: Total count, total amount, Submit button
- Submit sends with idempotency key to prevent duplicates

**Submission Result Modal:**

After submit, display a bottom-sheet modal with:
- Summary header: "X of Y collections submitted" (green if all succeeded, amber if partial, red if all failed)
- Scrollable list of per-item results:
  - Success items: Green checkmark, loan number, borrower name, amount — status "Pending Approval"
  - Failed items: Red X, loan number, borrower name, amount, error reason (e.g. "Loan not active", "Duplicate collection")
- Footer actions:
  - "Done" — dismiss modal, return to C1 with refreshed state
  - "Retry Failed" (if any failures) — keep only failed rows in the form for re-submission

---

## 9. Role-Based Access Control (Frontend)

The frontend must enforce visibility rules, even though the API also enforces them.

### 9.1 Admin Can See

Everything within their tenant. All screens A1-A25.

### 9.2 Collector Can See

| Can Access | Cannot Access |
|-----------|---------------|
| Active loan list (status=ACTIVE only) | Closed, defaulted, written-off, cancelled loans |
| Loan detail (read-only) | Create/edit loans |
| Customer list and detail (read-only) | Create/edit customers |
| Record individual collection | Approve/reject transactions |
| Bulk collection submission | Dashboard, reports, expenses |
| Own profile | Fund management, user management |
| | Penalties, waivers |
| | Loan status changes (default, close, cancel, write-off) |

### 9.3 Super Admin Can See

Only platform screens P1-P5. Cannot access any tenant's loan/customer/financial data.

### 9.4 Route Protection

- Unauthenticated users → redirect to Login
- Wrong role accessing a screen → redirect to their home screen
- Suspended tenant users → show "Tenant Suspended" screen, only allow logout

---

## 10. Notifications & Alerts

### 10.1 In-App Alerts (No Push Notifications in V1)

| Alert | Where | Trigger |
|-------|-------|---------|
| Pending approvals | Dashboard badge + tab badge | Count > 0 |
| Overdue loans | Dashboard overdue section | Any loan overdue |
| Defaulter warning | Customer detail | Customer is guarantor for defaulted loan |
| Loan eligible for closure | Loan detail | All closure conditions met |
| Payment submitted | Collector toast | After successful collection submission |

### 10.2 Confirmation Dialogs

Required before destructive/irreversible actions:
- Reverse Transaction (correction)
- Mark as Defaulted
- Write Off
- Cancel Loan
- Deactivate User
- Suspend/Activate Tenant

---

## 11. Search & Filtering

### 11.1 Global Search (Future)

Not in V1. Each list has its own search/filter.

### 11.2 Loan List Filters

- **Type**: All / Monthly / Daily (toggle)
- **Status**: All / Active / Closed / Defaulted / Written Off / Cancelled (chips)
- **Search**: By loan number or borrower name (text input)
- **Pagination**: Infinite scroll or "Load More" button

### 11.3 Customer List Filters

- **Search**: By name or phone (text input)
- **Defaulter**: All / Defaulters Only / Non-Defaulters (toggle)
- **Pagination**: Infinite scroll or "Load More"

### 11.4 Transaction List Filters

- **Status**: All / Pending / Approved / Rejected
- **Type**: All / Interest / Principal / Collection / Penalty / Guarantor
- **Collector**: Dropdown of collectors (admin view)
- **Date range**: From/To date pickers

---

## 12. Pagination Strategy

- **Mobile default**: Infinite scroll with "loading more" skeleton at bottom
- **Page size**: 20 items per page (matches API default)
- **Max per request**: 100 (API limit)
- **Total count**: Shown at top of list ("142 loans")
- **Scroll position preservation**: Maintained when navigating back from detail views

---

## 13. Phased Build Plan

### Phase 1: Foundation + Auth
- Project setup (Next.js, Tailwind, PWA config)
- Login, logout, token management, auto-refresh
- Role-based routing and route protection
- Shared layout (tab bars, navigation)
- Profile, change password

### Phase 2: Admin Dashboard
- Dashboard Today (A1)
- Dashboard Overdue (A2)
- Dashboard Defaulters (A3)
- Dashboard Fund Summary (A4)

### Phase 3: Loan Management
- Loan List (A5) with filters
- Loan Detail Monthly (A6) with payment status
- Loan Detail Daily (A7) with collection calendar
- Create Loan (A8)

### Phase 4: Payments & Transactions
- Record Payment (A10)
- Pending Approvals (A11)
- Transaction History (A12) with Correction/Reversal flow
- Approve/Reject workflow

### Phase 5: Customer Management
- Customer List (A13)
- Customer Detail (A14) with guarantor warnings
- Create/Edit Customer (A15)

### Phase 6: Penalties & Waivers
- Impose Penalty (A16)
- Waive Penalty (A17)
- Waive Interest (A18)
- Penalty List (A19)

### Phase 7: Collector Experience
- My Collections Today (C1)
- Record Collection (C2)
- Bulk Collection (C3)
- Collector loan/customer views (C4-C7)

### Phase 8: Financial Management
- Expenses CRUD (A21)
- Fund Management (A22)
- Reports: P&L, Collector Summary, Loan Book (A23-A25)

### Phase 9: Admin Features
- User Management (A20)
- Migrate Loan (A9)
- Loan status actions (default, write-off, cancel, close)

### Phase 10: Super Admin
- Platform Dashboard (P1)
- Tenant CRUD (P2-P5)

### Phase 11: PWA & Polish
- Service worker, offline caching
- Install prompt
- Performance optimization
- Empty states, loading skeletons, error boundaries

---

## 14. Out of Scope (V1)

- Push notifications (SMS/WhatsApp reminders)
- Offline write operations (queue and sync)
- Real-time updates (WebSockets)
- Charts and trend graphs on dashboard
- Export to Excel/PDF
- Dark mode
- Multi-language / i18n
- Biometric login
- Camera integration (for ID proof capture)
- Global search across all entities
