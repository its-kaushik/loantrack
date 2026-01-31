-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'COLLECTOR');

-- CreateEnum
CREATE TYPE "LoanType" AS ENUM ('MONTHLY', 'DAILY');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'CLOSED', 'DEFAULTED', 'WRITTEN_OFF', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DISBURSEMENT', 'ADVANCE_INTEREST', 'INTEREST_PAYMENT', 'PRINCIPAL_RETURN', 'DAILY_COLLECTION', 'PENALTY', 'GUARANTOR_PAYMENT', 'INTEREST_WAIVER', 'PENALTY_WAIVER', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PenaltyStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('TRAVEL', 'SALARY', 'OFFICE', 'LEGAL', 'MISC');

-- CreateEnum
CREATE TYPE "FundEntryType" AS ENUM ('INJECTION', 'WITHDRAWAL');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(50) NOT NULL,
    "owner_name" VARCHAR(200) NOT NULL,
    "owner_phone" VARCHAR(15) NOT NULL,
    "owner_email" VARCHAR(255),
    "address" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "subscription_plan" VARCHAR(50),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "email" VARCHAR(255),
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "alternate_phone" VARCHAR(15),
    "address" TEXT,
    "aadhaar_number" VARCHAR(12),
    "pan_number" VARCHAR(10),
    "id_proof_type" VARCHAR(50),
    "id_proof_document_url" VARCHAR(500),
    "photo_url" VARCHAR(500),
    "occupation" VARCHAR(200),
    "notes" TEXT,
    "is_defaulter" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "loan_number" VARCHAR(20) NOT NULL,
    "borrower_id" UUID NOT NULL,
    "loan_type" "LoanType" NOT NULL,
    "principal_amount" DECIMAL(12,2) NOT NULL,
    "interest_rate" DECIMAL(5,2) NOT NULL,
    "disbursement_date" DATE NOT NULL,
    "expected_months" INTEGER,
    "monthly_due_day" INTEGER,
    "remaining_principal" DECIMAL(12,2),
    "billing_principal" DECIMAL(12,2),
    "advance_interest_amount" DECIMAL(12,2),
    "last_interest_paid_through" DATE,
    "term_days" INTEGER,
    "total_repayment_amount" DECIMAL(12,2),
    "daily_payment_amount" DECIMAL(12,2),
    "term_end_date" DATE,
    "grace_days" INTEGER NOT NULL DEFAULT 7,
    "total_collected" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "guarantor_id" UUID,
    "collateral_description" TEXT,
    "collateral_estimated_value" DECIMAL(12,2),
    "closure_date" DATE,
    "is_migrated" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "cancellation_reason" TEXT,
    "defaulted_at" TIMESTAMPTZ,
    "defaulted_by" UUID,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by" UUID,
    "written_off_at" TIMESTAMPTZ,
    "written_off_by" UUID,
    "closed_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "penalty_id" UUID,
    "corrected_transaction_id" UUID,
    "transaction_type" "TransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "transaction_date" DATE NOT NULL,
    "effective_date" DATE,
    "collected_by" UUID,
    "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ,
    "rejection_reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "principal_returns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "amount_returned" DECIMAL(12,2) NOT NULL,
    "remaining_principal_after" DECIMAL(12,2) NOT NULL,
    "return_date" DATE NOT NULL,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "principal_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "penalties" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "days_overdue" INTEGER NOT NULL,
    "months_charged" INTEGER NOT NULL,
    "penalty_amount" DECIMAL(12,2) NOT NULL,
    "waived_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_payable" DECIMAL(12,2) NOT NULL,
    "imposed_date" DATE NOT NULL,
    "status" "PenaltyStatus" NOT NULL DEFAULT 'PENDING',
    "amount_collected" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "penalties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "expense_date" DATE NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fund_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entry_type" "FundEntryType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "entry_date" DATE NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fund_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_number_sequences" (
    "tenant_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "loan_type" "LoanType" NOT NULL,
    "current_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "loan_number_sequences_pkey" PRIMARY KEY ("tenant_id","year","loan_type")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" VARCHAR(255) NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "idx_users_tenant_id" ON "users"("tenant_id");

-- CreateIndex
CREATE INDEX "idx_customers_tenant_phone" ON "customers"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "idx_customers_tenant_defaulter" ON "customers"("tenant_id", "is_defaulter");

-- CreateIndex
CREATE UNIQUE INDEX "uq_customers_tenant_aadhaar" ON "customers"("tenant_id", "aadhaar_number");

-- CreateIndex
CREATE UNIQUE INDEX "uq_customers_tenant_pan" ON "customers"("tenant_id", "pan_number");

-- CreateIndex
CREATE INDEX "idx_loans_tenant_borrower" ON "loans"("tenant_id", "borrower_id");

-- CreateIndex
CREATE INDEX "idx_loans_tenant_guarantor" ON "loans"("tenant_id", "guarantor_id");

-- CreateIndex
CREATE INDEX "idx_loans_tenant_status" ON "loans"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "idx_loans_tenant_type" ON "loans"("tenant_id", "loan_type");

-- CreateIndex
CREATE INDEX "idx_loans_tenant_term_end" ON "loans"("tenant_id", "term_end_date");

-- CreateIndex
CREATE INDEX "idx_loans_tenant_disbursement" ON "loans"("tenant_id", "disbursement_date");

-- CreateIndex
CREATE UNIQUE INDEX "uq_loans_tenant_loan_number" ON "loans"("tenant_id", "loan_number");

-- CreateIndex
CREATE INDEX "idx_txn_tenant_loan" ON "transactions"("tenant_id", "loan_id");

-- CreateIndex
CREATE INDEX "idx_txn_tenant_date" ON "transactions"("tenant_id", "transaction_date");

-- CreateIndex
CREATE INDEX "idx_txn_tenant_type" ON "transactions"("tenant_id", "transaction_type");

-- CreateIndex
CREATE INDEX "idx_txn_tenant_approval" ON "transactions"("tenant_id", "approval_status");

-- CreateIndex
CREATE INDEX "idx_txn_tenant_collector" ON "transactions"("tenant_id", "collected_by");

-- CreateIndex
CREATE UNIQUE INDEX "principal_returns_transaction_id_key" ON "principal_returns"("transaction_id");

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_hash" ON "refresh_tokens"("token_hash");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_borrower_id_fkey" FOREIGN KEY ("borrower_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_guarantor_id_fkey" FOREIGN KEY ("guarantor_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_defaulted_by_fkey" FOREIGN KEY ("defaulted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_written_off_by_fkey" FOREIGN KEY ("written_off_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_penalty_id_fkey" FOREIGN KEY ("penalty_id") REFERENCES "penalties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_corrected_transaction_id_fkey" FOREIGN KEY ("corrected_transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_collected_by_fkey" FOREIGN KEY ("collected_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "principal_returns" ADD CONSTRAINT "principal_returns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "principal_returns" ADD CONSTRAINT "principal_returns_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "principal_returns" ADD CONSTRAINT "principal_returns_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "principal_returns" ADD CONSTRAINT "principal_returns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_entries" ADD CONSTRAINT "fund_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_entries" ADD CONSTRAINT "fund_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_number_sequences" ADD CONSTRAINT "loan_number_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

