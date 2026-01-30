# LoanTrack - Business Requirements Document

---

## 1. Product Overview

LoanTrack is a **multi-tenant SaaS platform** for loan businesses to manage and track their loans, daily/monthly collections, profits, and defaulters.

- Each tenant = one independent loan business
- Tenants have **fully isolated data** - no business can see another's data
- A platform super-admin manages tenant onboarding and suspension

---

## 2. Loan Types

### 2.1 Monthly Loans (Interest-Only)

- Borrower pays **monthly interest** on the remaining principal
- Interest collected **in advance** - first month's interest is taken at the time of giving the loan
- Payment is due on the **same calendar date** each month (derived from disbursement date)
  - The `monthly_due_day` is **immutable** — it is set once at disbursement and never changes, even if a shorter month temporarily adjusts the actual due date
  - If the due day is 31st and the month has 30 days, due date becomes the last day of that month: `MIN(due_day, last_day_of_month)`
  - Example: due day = 31, February -> Feb 28 (or 29 in leap year), but **March reverts back to 31**. The stored due day is always 31; only the computed date adapts per month.
  - Example: due day = 30, February -> Feb 28. March -> 30. April -> 30. The due day "bounces back" after short months.
- Principal can be returned in **parts** at any time
- Monthly interest **recalculates** on the remaining principal, but only from the **next billing cycle** - not mid-cycle. "Next billing cycle" strictly means the cycle **after** the one currently in progress, regardless of how close the return is to the due date.
  - Example: Due date is the 15th. Borrower returns Rs 40,000 on Feb 5. The Feb 15 interest still uses the old principal. New principal takes effect from March 15 onward.
  - **Edge case**: Even if the borrower returns principal on the **14th** (one day before the due date), the 15th interest still uses the old principal. The rule is absolute — any return within a billing cycle takes effect from the next cycle, with no exceptions based on proximity to the due date. This avoids timing disputes and keeps the calculation unambiguous.
- "Expected months" is noted at disbursement but not enforced - borrower can keep the loan as long as they keep paying interest
- Interest rate: configurable per loan (e.g., 2%, 5% per month)

**Example:**
- Loan: Rs 1,00,000 at 2% per month
- Monthly interest: Rs 2,000
- Borrower returns Rs 40,000 principal after 6 months
- New remaining principal: Rs 60,000
- New monthly interest: Rs 1,200

### 2.2 Daily Loans (Fixed-Term)

- Fixed repayment period: typically **120 days** or **60 days**
- Interest rate: configurable, typically 5% per month
- Total repayment is calculated upfront:
  ```
  total_repayment = principal x (1 + interest_rate/100 x term_days/30)
  ```
  - Example: Rs 1,00,000 at 5%/month for 120 days (4 months)
  - Total = 1,00,000 x (1 + 0.05 x 4) = 1,00,000 x 1.20 = **Rs 1,20,000**
- Daily payment: total_repayment / term_days
  - Rs 1,20,000 / 120 = **Rs 1,000/day**
- In practice, principals are chosen so the daily payment is a **round number** (100, 150, 250, 500, 1000, etc.)
- Equal daily installments covering both principal and interest (blended)
- Missed days are tolerated as long as borrower catches up within the term
- A **physical card** with boxes is given (120 or 60 boxes); tracked digitally as payment history
- **Grace period**: ~5-7 days (configurable per loan) after term ends before penalties apply

**More examples:**
- Rs 10,000 for 120 days at 5% -> Rs 12,000 total -> Rs 100/day
- Rs 50,000 for 120 days at 5% -> Rs 60,000 total -> Rs 500/day

---

## 3. Penalty Rules (Daily Loans)

Penalties apply when a daily loan exceeds its term + grace period and is not fully paid.

- `days_overdue = today - term_end_date - grace_days` (only when > 0)
- `months_charged = CEIL(days_overdue / 30)` - rounds up to the nearest month
- `penalty = principal_amount x interest_rate / 100 x months_charged`

**Examples:**
- 10 days late -> 1 month penalty -> Rs 1,00,000 x 5% x 1 = Rs 5,000
- 20 days late -> 1 month penalty -> Rs 5,000
- 35 days late -> 2 months penalty -> Rs 1,00,000 x 5% x 2 = Rs 10,000
- 60 days late -> 2 months penalty -> Rs 10,000

Penalties are:
- Manually imposed by the admin (not automatic)
- Can be **waived** fully or partially
- Must be settled (paid or waived) before the loan can be closed
- **Stacking**: If the borrower stays overdue longer, the admin imposes a **new separate penalty** each time. Each penalty is a separate record tracked independently.
  - **Auto-calculation**: When the admin triggers "impose penalty", the system auto-calculates the **incremental** months by looking at previously imposed penalties on the same loan.
  - Formula: `incremental_months = CEIL(days_overdue / 30) - SUM(months_charged from all existing penalties on this loan)`
  - **Important**: The SUM includes **all** penalty records regardless of their status — PENDING, PARTIALLY_PAID, PAID, and **WAIVED**. A waived penalty still "counts" toward months already penalised. Otherwise, the borrower would be double-charged for months that were already forgiven.
  - If `incremental_months <= 0`, no new penalty is needed (the borrower hasn't crossed into a new penalty month since the last penalty was imposed).
  - Example: Borrower is 45 days overdue. No penalties yet. System calculates `CEIL(45/30) - 0 = 2 months`. First penalty = 2 months charge.
  - Later, borrower is now 70 days overdue. System calculates `CEIL(70/30) - 2 = 1 month`. New penalty = **1 month** (incremental).
  - Even later, borrower is 80 days overdue. System calculates `CEIL(80/30) - 3 = 0 months`. No new penalty — still within the same penalty month window.
  - The admin confirms the system-calculated amount before it is imposed. The admin can also override the amount if needed.

---

## 4. People & Relationships

### 4.1 Customers
- Anyone the business interacts with: borrowers and guarantors
- A person can have **multiple active loans** simultaneously
- Customer details: name, phone, alternate phone, address, Aadhaar number, PAN number, ID proof document, photo, occupation, free-text notes
- Address is optional (a guarantor may be added quickly with just name and phone)
- **Data isolation**: Each tenant maintains its own customer records. The same real-world person appearing in two different tenants' systems is stored as two separate, unrelated rows with different `tenant_id` values. There is no cross-tenant customer linking or data sharing. Aadhaar/PAN uniqueness is enforced **within a tenant** only — not globally.

### 4.2 Guarantors
- Any person - not necessarily an existing borrower
- Optional per loan, but common for new borrowers
- If a borrower defaults, the guarantor is expected to pay back
- Stored in the same customer table - if they later take a loan, they're already in the system
- **Guarantor warning**: If a loan defaults, the guarantor's profile shows a warning: "Guarantor for defaulted Loan #XYZ." This is informational — it does **not** flag them as a defaulter (only borrowers get the defaulter flag). It helps the admin make informed decisions before giving the guarantor a new loan.

### 4.3 Collateral
- Rare, but details should be stored: description and estimated value
- Tracked per loan

### 4.4 Defaulters
- A borrower who has absconded with the money
- When a loan is marked as defaulted, the customer is **automatically flagged** as a defaulter
- The admin can **manually clear** the defaulter flag if the situation resolves
- The flag is a trust/reputation indicator - it does **not block** any system action (admin can still give them a new loan if they choose)

---

## 5. Users & Roles

### 5.1 Super Admin (Platform Level)
- Manages tenants: onboarding, suspension, reactivation
- Sees platform-wide statistics (tenant count, total loans, etc.)
- Does **NOT** access any tenant's loan data, customers, or finances

### 5.2 Admin (Tenant Level - Business Owner)
- A tenant can have **multiple admins** (e.g., business partner, trusted family member). All admins have equal access.
- Full access within their tenant
- Disburses loans
- Records payments (auto-approved)
- Approves or rejects collector-submitted payments
- Manages customers, collectors, expenses, fund entries
- Imposes penalties, issues waivers
- Marks loans as defaulted or written-off
- Views all reports and dashboard

### 5.3 Collector (Tenant Level)
- Goes out to collect daily payments (and occasionally monthly payments)
- Records payments in the system - these start as **PENDING** until the admin approves
- Can record payments individually or in **bulk** (20-30 collections per trip)
- **Data visibility**: Collectors can see **active loans** and their borrower details (name, phone, address) - enough to do their job. They **cannot** see closed, defaulted, or written-off loans.
- **Cannot**: create loans, approve payments, mark defaults, issue waivers, access fund data, access expenses, manage users, view reports

---

## 6. Collector Approval Workflow

Since collectors handle cash and the admin needs oversight:

1. Collector collects payment(s) from borrower(s)
2. Collector records the payment(s) in the app -> status = **PENDING**
3. Admin reviews pending payments on the dashboard
4. Admin **approves** (payment counts toward the loan) or **rejects** with a reason (payment is discarded)
5. **All loan state changes** (remaining principal updates, penalty payments, etc.) only happen **on approval**, not when the collector submits
6. Audit trail: who collected, who approved, when

**Why approval-gating matters:** If a collector submits a Rs 50,000 principal return and the system immediately updates the loan balance, but the admin later rejects it (wrong amount, wrong loan), the loan data would be corrupted. So state changes are deferred until approval.

**Exception:** When the admin records a payment directly, it is auto-approved.

**Stale data guard:** If a collector's app is out of sync and they submit a payment for a loan that is no longer ACTIVE:
- **CANCELLED loans**: Submission is **rejected** immediately. Cancelled loans are treated as if they never existed.
- **DEFAULTED loans**: Submission is **accepted** (as PENDING). Recovery payments from guarantors or the borrower are a valid flow on defaulted loans (see Section 7.11).
- **CLOSED / WRITTEN_OFF loans**: Submission is **rejected**. These loans are finalized.

**Corrections:** Once approved, a transaction cannot be un-approved. If a mistake is found after approval, a corrective transaction is created instead. This preserves the audit trail.
- **Admin-only** — collectors cannot create corrective transactions
- A corrective transaction has the same type as the original but a **negative amount**, effectively reversing its financial impact
- The corrective transaction references the original transaction it corrects (via notes or a linked field)
- Side effects are reversed: e.g., a corrective PRINCIPAL_RETURN of -Rs 5,000 increments remaining_principal back by Rs 5,000
- Example: Admin approved a Rs 5,000 PRINCIPAL_RETURN by mistake. Admin creates a corrective transaction: PRINCIPAL_RETURN of -Rs 5,000. Remaining principal is restored. Both transactions are in the audit trail.

---

## 7. Business Flows

### 7.1 Monthly Loan - Disbursement

1. Select or create customer
2. Set: principal amount, interest rate (% per month), expected months (optional), guarantor (optional), collateral (optional)
3. System calculates advance interest = principal x rate / 100
4. Two transactions are created:
   - **DISBURSEMENT**: principal amount (money out)
   - **ADVANCE_INTEREST**: first month's interest (money in)
5. Net cash outflow = principal - advance interest
6. Loan is now **ACTIVE**

### 7.2 Monthly Loan - Interest Collection

- Each month, on the due date, the borrower pays: `remaining_principal x interest_rate / 100`
- Payment is recorded with which billing cycle it covers
- If the admin forgets to collect, the dashboard flags it as overdue
- **Overpayment auto-split**: If the borrower pays **more** than the interest due, the system automatically splits the payment:
  - Interest due amount → recorded as **INTEREST_PAYMENT**
  - Excess amount → recorded as **PRINCIPAL_RETURN** (reduces remaining principal immediately)
  - Example: Interest due = Rs 2,000. Borrower pays Rs 5,000. System creates: Rs 2,000 INTEREST_PAYMENT + Rs 3,000 PRINCIPAL_RETURN.
  - This prevents inflating "Total Interest Earned" and correctly reduces the outstanding principal.
  - **No manual override**: The auto-split is the only mode. There is no option to bypass it and treat an entire overpayment as principal-only. Interest must always be settled first. If the borrower explicitly wants to reduce principal without paying current interest, the admin records a separate PRINCIPAL_RETURN transaction (not through the interest collection flow).
- **Underpayment**: If the borrower pays less than interest due (e.g., Rs 1,800 of Rs 2,000), the full amount is recorded as an INTEREST_PAYMENT. The billing cycle remains unsettled until the remaining Rs 200 is collected or waived.

### 7.3 Monthly Loan - Principal Return

1. Borrower returns part or all of the principal
2. System validates: return amount <= remaining principal
3. Remaining principal is decremented
4. Future interest recalculates on the new remaining principal
5. If remaining principal reaches 0, the admin is prompted to close the loan

### 7.4 Monthly Loan - Closure

A monthly loan can be closed when:
1. Remaining principal = 0 (all principal returned)
2. All interest cycles are settled (paid or waived) - including the current month and any missed past months
3. **Full month interest is owed** even if principal is returned mid-cycle. If the borrower returns all principal on Feb 25 (10 days into the Feb 15 - Mar 15 cycle), they still owe the full month's interest for that cycle.

Admin explicitly triggers closure.

### 7.5 Monthly Loan - Overdue Detection

For each active monthly loan:
- Compute expected due date for the current month
- If today is past the due date and no payment or waiver exists for this cycle -> **overdue**
- Shows on the dashboard so the admin doesn't forget to collect

### 7.6 Daily Loan - Disbursement

1. Select or create customer
2. Set: principal, interest rate (%), term days (120/60), grace days (default 7), guarantor (optional), collateral (optional)
3. System calculates total repayment and daily payment amount
4. **System displays the daily amount for admin confirmation** - in practice, amounts are chosen so this is a round number
5. If not round, admin adjusts the principal
6. One transaction is created: **DISBURSEMENT** (money out)
7. Term end date = disbursement date + term days
8. Loan is now **ACTIVE**

### 7.7 Daily Loan - Daily Collection

- Collector or admin records the day's payment
- Amount is typically the daily_payment_amount but can vary (catch-up payments, partial payments)
- What matters is **total collected vs total repayment amount**, not day-by-day matching
- Days paid = `FLOOR(total_collected / daily_payment_amount)` - one large payment can count as multiple days

### 7.8 Daily Loan - Missed Payment Detection

For each active daily loan within its term period:
- If no approved collection exists for today -> **flag as missed today**
- Shows on the dashboard

### 7.9 Daily Loan - Overdue & Penalty

- If today > term_end_date + grace_days AND total_collected < total_repayment_amount -> **overdue**
- Admin manually imposes a penalty (see Section 3 for calculation)
- Penalty can be paid in full or in parts
- Penalty can be waived fully or partially

**Payment allocation (waterfall):** When a borrower has both an outstanding penalty and a remaining base loan balance, payments are recorded as **separate, explicit transactions** — the collector/admin specifies the type:
- `PENALTY` transaction → applied to the oldest unpaid penalty first
- `DAILY_COLLECTION` transaction → applied to the base loan balance
- The system does **not** auto-split a single payment across penalty and base loan. If the borrower hands over Rs 2,000 and Rs 1,000 is for the penalty and Rs 1,000 is for the loan, the admin records two transactions.
- **At closure**, both conditions must be met: base loan fully paid AND all penalties settled (paid or waived).

### 7.10 Daily Loan - Closure

A daily loan can be closed when:
1. Total collected >= total repayment amount (base loan fully paid)
2. All imposed penalties are either paid or waived

If the base loan is paid but penalties are outstanding, the loan stays **ACTIVE** but is flagged as "base paid, penalty pending" in the system.

Admin explicitly triggers closure.

### 7.11 Defaulter Handling

1. Admin marks a loan as **DEFAULTED** (borrower absconded). This can be done **at any time** on any ACTIVE loan - there's no requirement to wait for the term or grace period to end. If the borrower clearly disappears on day 40 of a 120-day loan, the admin can default immediately.
2. Customer is automatically flagged as a defaulter (admin can clear this later)
3. If a guarantor exists, they are expected to pay (notified manually/outside the system)
4. Guarantor payments are recorded against the original loan
5. If recovered via guarantor -> admin can move the loan to **CLOSED**. There is **no system-enforced recovery threshold** - the admin decides when enough has been recovered. The system shows the outstanding amount (total owed minus all collections and guarantor payments) to help the admin decide, but closing a defaulted loan is a business judgment call.
6. If unrecoverable -> loan is marked **WRITTEN_OFF** (counted as a loss)

### 7.12 Loan Cancellation

If a loan is created by mistake (wrong customer, wrong amount, etc.), the admin can **cancel** it.

- Only **ACTIVE** loans with **no approved transactions** (other than the initial DISBURSEMENT and ADVANCE_INTEREST) can be cancelled
- A cancelled loan is treated as if it never happened - it does **not** count toward any financial calculations
- The admin must record a reason for cancellation
- Cancellation is **irreversible**

**Loan Status Transitions:**
```
ACTIVE -> CLOSED         (fully repaid)
ACTIVE -> DEFAULTED      (borrower absconded)
ACTIVE -> CANCELLED      (admin error - no payments made)
DEFAULTED -> CLOSED      (recovered via guarantor)
DEFAULTED -> WRITTEN_OFF (unrecoverable loss)
```

---

## 8. Waivers

Waivers allow the admin to forgive interest or penalties, fully or partially.

### 8.1 Interest Waiver (Monthly Loans)

1. Admin selects a loan and the billing cycle to waive
2. Can waive fully (entire month's interest) or partially (e.g., waive Rs 500 of Rs 2,000)
3. If partial: borrower still owes the remainder
4. A billing cycle is "settled" when waiver + payment >= interest due
5. Waived amounts show in reports as "revenue forgone"

### 8.2 Penalty Waiver (Daily Loans)

1. Admin selects a penalty to waive
2. Can waive fully or partially
3. If fully waived, the penalty is considered settled
4. Waived penalties show in reports as "penalties forgone"

### 8.3 Waiver Rules

- **Admin-only** - collectors cannot issue waivers
- All waivers are recorded with who issued them and when (audit trail)
- Waived amounts are **excluded** from "Total Interest Earned" and "Penalties Collected"
- Waivers do **not** affect Cash in Hand (no money moved)

---

## 9. Financial Tracking & Calculations

**Accounting policy (Daily Loans):** Daily loan collections are blended (principal + interest in a single payment). The system uses **principal-first recognition** — every Rupee collected is treated as recovering principal first. Only after the full principal is recovered do subsequent collections count as interest/profit.

- Example: Rs 1,00,000 principal, Rs 1,20,000 total repayment, Rs 1,000/day for 120 days.
  - Days 1–100: Each Rs 1,000 recovers principal. After day 100, principal is fully recovered.
  - Days 101–120: Each Rs 1,000 is pure interest. Total interest earned = Rs 20,000.
- This is a **conservative, de-risking approach** — no profit is recognized until the business's capital is safe.

### 9.1 Fund Summary

| Metric | Calculation |
|---|---|
| Total Capital Invested | Capital injections - capital withdrawals |
| Money Deployed | Monthly: sum of `remaining_principal`. Daily: sum of `MAX(principal_amount - total_collected, 0)` — principal-first means every collection reduces deployed capital until principal is recovered. Both for ACTIVE loans only. |
| Money Lost to Defaults | Monthly: `remaining_principal` on DEFAULTED/WRITTEN_OFF loans, minus guarantor recoveries. Daily: `MAX(principal_amount - total_collected, 0)` on DEFAULTED/WRITTEN_OFF loans, minus guarantor recoveries. |
| Total Interest Earned | Monthly: sum of interest payments + advance interest. Daily: `SUM(MAX(total_collected - principal_amount, 0))` across all daily loans (principal-first — interest recognized only after principal is fully recovered). Plus penalties collected. |
| Total Expenses | Sum of all operational expenses (excluding soft-deleted) |
| Revenue Forgone | Interest waived + penalties waived |
| Net Profit | Total Interest Earned - Money Lost to Defaults - Total Expenses |
| Cash in Hand | Capital invested - disbursements + all money-in collections - expenses. **Excludes** opening balances from migrated loans and waivers. |

### 9.2 Per-Loan Profit

**Monthly Loan:**
- Profit = all interest payments + advance interest
- If defaulted: loss = remaining principal at time of default minus guarantor recoveries

**Daily Loan (principal-first):**
- If closed: profit = `total_collected - principal_amount` + penalties collected (since total_collected >= total_repayment, this equals the interest component)
- If active: interest earned so far = `MAX(total_collected - principal_amount, 0)` — zero until principal is recovered
- If defaulted: loss = `MAX(principal_amount - total_collected, 0)` minus guarantor recoveries

---

## 10. Dashboard & Alerts

| View | What It Shows |
|---|---|
| **Today's Summary** | Active daily loan count, expected collections today, received today, missed today (list with borrower names), monthly interest due today, pending approvals count, total collected today |
| **Overdue Loans** | Daily loans past term + grace (with days overdue, remaining amount, guarantor, penalty applicable). Monthly loans with missed due dates (with months overdue, interest due, last payment date). |
| **Defaulters** | All defaulted/written-off loans with borrower details, guarantor info, outstanding amount |
| **Fund Summary** | Capital overview as described in Section 9.1 |

---

## 11. Existing Loan Migration (Day-One Import)

When a business first adopts LoanTrack, they need to enter their existing active loans.

### 11.1 Monthly Loan Migration

Example: Rs 1,00,000 given 3 months ago (Nov 15) at 5%. Rs 30,000 principal already returned. 3 months of interest already collected (through Feb 15 cycle). Migrating on Feb 20.

1. Admin enters the loan with actual past disbursement date (Nov 15)
2. Sets **principal amount** to the original amount (Rs 1,00,000)
3. Sets **remaining principal** to the current outstanding amount (Rs 70,000)
4. Sets **last_interest_paid_through** date (Feb 15) - tells the system that all billing cycles up to and including this date are already settled
5. **No OPENING_BALANCE transaction** is created for monthly loans - the loan state is fully captured by `remaining_principal` and `last_interest_paid_through`
6. System treats the next billing cycle (Feb 15 - Mar 15) as the first cycle to track natively. Since it's past Feb 15 and `last_interest_paid_through` covers it, this cycle is considered settled. The **next due cycle** is Mar 15.
7. From this point, everything is tracked natively. Next month's interest = Rs 70,000 x 5% = Rs 3,500

### 11.2 Daily Loan Migration

Example: Rs 1,00,000 for 120 days given 40 days ago. 35 of 40 days paid (Rs 35,000 collected).

1. Admin enters the loan with actual past disbursement date
2. Provides total collected so far (Rs 35,000)
3. System records it as an opening balance
4. From this point, daily collections are tracked natively
5. Total remaining = Rs 1,20,000 - Rs 35,000 = Rs 85,000
6. **If the loan is already overdue** (past term + grace), the admin can optionally enter pre-existing penalty records — each with months charged, amount, and status (PAID/PENDING/WAIVED). This ensures the penalty auto-calculation correctly computes incremental months going forward, rather than double-counting penalties already imposed before migration.

### 11.3 Migration Rules

- Migrated loans are flagged (`is_migrated = true`) and behave identically to native loans after import
- **No DISBURSEMENT transaction** is recorded (the money was already given out before the system)
- **Monthly loans**: No OPENING_BALANCE transaction needed. State is captured directly by `remaining_principal` and `last_interest_paid_through`.
- **Daily loans**: An OPENING_BALANCE transaction records the total collected so far. This counts toward loan-level tracking (total_collected, days_paid) but is **excluded from Cash in Hand** (the money was already collected before the system existed).
- **Interest Earned on migrated daily loans**: The Fund Summary's "Total Interest Earned" reflects **lifetime** earnings, including interest collected before migration. For example, a migrated loan with Rs 1,10,000 collected on a Rs 1,00,000 principal will show Rs 10,000 as interest earned from day one. This is intentional — the Fund Summary represents the true financial position of the business, not just activity since migration. For **date-range reports** (e.g., monthly P&L), only transactions created within the date range are counted, so pre-migration earnings are naturally excluded.
- Reports can filter migrated vs native loans

---

## 12. Tenant Onboarding

1. Platform super-admin creates a new tenant with business details
2. An initial admin account is created for the business owner
3. Owner logs in and can:
   - Create collector accounts
   - Add customers
   - Configure defaults (interest rates, grace days, etc.)
   - Start disbursing loans or migrate existing ones

---

## 13. Future Considerations (Not in Scope Now)

- **Cash Handover / Reconciliation Workflow**: Currently, collectors record payments in the app and the admin approves/rejects them. However, there is no explicit "cash handover" step where the collector physically hands collected cash to the admin and both parties confirm the amount. A future version could add a cash reconciliation flow: collector submits a "handover summary" (total cash for the day), admin confirms receipt, and discrepancies are flagged. For V1, cash reconciliation happens outside the system (manually).
- **Early Closure / Foreclosure for Daily Loans**: Currently, a daily loan's total repayment is fixed at disbursement and the borrower pays it in full over the term. There is no mechanism for a borrower to "close early" with a recalculated (lower) interest amount. A future version could support early closure with pro-rated interest: e.g., if a 120-day loan is paid off by day 60, interest could be recalculated for 60 days instead of 120. For V1, daily loans always owe the full `total_repayment_amount` regardless of when they finish paying.
- **Reverse Calculator for Daily Loans**: Currently, the admin enters principal → system calculates daily amount → admin adjusts if not round. A "reverse calculator" mode would let the admin enter the desired daily amount + term → system back-calculates the exact principal. This eliminates trial-and-error during disbursement.
- SMS/WhatsApp reminders to borrowers for upcoming payments
- Mobile app for collectors in the field
- Interest rate changes mid-loan
- Automated penalty calculation via scheduled jobs
- Export to Excel/PDF for accounting
- Dashboard analytics with charts and trends
- Subscription billing for tenants
- Tenant self-registration
- Audit log for compliance
