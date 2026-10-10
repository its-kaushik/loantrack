-- Daily loan settlement: when a daily loan is settled for less than its scheduled
-- total, total_repayment_amount is lowered to the amount collected and the
-- scheduled total is kept here. Both columns are NULL for loans that were never settled.

-- AlterTable
ALTER TABLE "loans" ADD COLUMN "original_total_repayment_amount" DECIMAL(12,2),
ADD COLUMN "settlement_note" TEXT;
