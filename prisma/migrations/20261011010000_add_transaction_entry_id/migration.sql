-- One recorded payment can create several transaction rows (an interest payment
-- split across months, plus a principal return for any excess). entry_id links
-- those rows so the payment can be corrected or removed as a whole. It is NULL
-- for rows recorded before this column existed.

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "entry_id" UUID;

-- CreateIndex
CREATE INDEX "idx_txn_entry" ON "transactions"("entry_id");
