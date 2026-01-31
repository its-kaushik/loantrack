-- Check constraints: financial safety nets at DB level

-- Loans: remaining_principal must never go negative
ALTER TABLE "loans"
  ADD CONSTRAINT "chk_loans_remaining_principal_non_negative"
  CHECK ("remaining_principal" >= 0);

-- Loans: billing_principal must never go negative
ALTER TABLE "loans"
  ADD CONSTRAINT "chk_loans_billing_principal_non_negative"
  CHECK ("billing_principal" >= 0);

-- Loans: total_collected must never go negative
ALTER TABLE "loans"
  ADD CONSTRAINT "chk_loans_total_collected_non_negative"
  CHECK ("total_collected" >= 0);

-- Transactions: amount must be positive, unless it's a correction (corrected_transaction_id is set)
ALTER TABLE "transactions"
  ADD CONSTRAINT "chk_transactions_amount_positive_or_correction"
  CHECK ("amount" > 0 OR "corrected_transaction_id" IS NOT NULL);

-- Partial unique indexes: phone uniqueness for users
-- Tenant-scoped users: phone unique per tenant
CREATE UNIQUE INDEX "uq_users_tenant_phone"
  ON "users" ("tenant_id", "phone")
  WHERE "tenant_id" IS NOT NULL;

-- Super admins (no tenant): phone globally unique
CREATE UNIQUE INDEX "uq_users_global_phone"
  ON "users" ("phone")
  WHERE "tenant_id" IS NULL;
