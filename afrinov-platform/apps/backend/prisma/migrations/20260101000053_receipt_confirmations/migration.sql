-- Proof of receipt (ADR-034): the person collecting an issue or a tool loan
-- confirms the slip with a counter PIN, a signature, or a photo of the signed
-- paper slip, or the reason they didn't is kept. Only adds: no ledger row,
-- balance or existing column changes.

-- CreateEnum
CREATE TYPE "ReceiptSlipKind" AS ENUM ('ISSUE', 'LOAN');

-- CreateEnum
CREATE TYPE "ReceiptMethod" AS ENUM ('PIN', 'SIGNATURE', 'PAPER', 'NONE');

-- CreateEnum
CREATE TYPE "ReceiptSkipReason" AS ENUM ('LEFT', 'CANNOT', 'NO_SCREEN', 'DISPUTED', 'OTHER');

-- AlterTable: the counter PIN, kept only as a bcrypt hash.
ALTER TABLE "recipients" ADD COLUMN     "pin_failed_tries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pin_hash" TEXT,
ADD COLUMN     "pin_locked_at" TIMESTAMP(3),
ADD COLUMN     "pin_set_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "receipt_confirmations" (
    "id" TEXT NOT NULL,
    "slip_id" TEXT NOT NULL,
    "slip_kind" "ReceiptSlipKind" NOT NULL,
    "method" "ReceiptMethod" NOT NULL,
    "signer_id" TEXT,
    "reason" "ReceiptSkipReason",
    "note" TEXT,
    "lines_fingerprint" TEXT,
    "captured_by_id" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "image_removed_at" TIMESTAMP(3),

    CONSTRAINT "receipt_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_images" (
    "confirmation_id" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "receipt_images_pkey" PRIMARY KEY ("confirmation_id")
);

-- CreateIndex
CREATE INDEX "receipt_confirmations_slip_id_idx" ON "receipt_confirmations"("slip_id");

-- CreateIndex
CREATE INDEX "receipt_confirmations_confirmed_at_idx" ON "receipt_confirmations"("confirmed_at");

-- A slip is confirmed once. Rows saying it wasn't (NONE) may come before.
CREATE UNIQUE INDEX "receipt_confirmations_one_per_slip_key" ON "receipt_confirmations"("slip_id") WHERE "method" <> 'NONE';

-- A confirmation names who confirmed and its fingerprint; a NONE row names why
-- not, and nobody.
ALTER TABLE "receipt_confirmations" ADD CONSTRAINT "receipt_confirmations_confirmed_has_signer"
  CHECK ("method" = 'NONE' OR ("signer_id" IS NOT NULL AND "lines_fingerprint" IS NOT NULL AND "reason" IS NULL));
ALTER TABLE "receipt_confirmations" ADD CONSTRAINT "receipt_confirmations_none_has_reason"
  CHECK ("method" <> 'NONE' OR ("reason" IS NOT NULL AND "signer_id" IS NULL));

-- AddForeignKey
ALTER TABLE "receipt_confirmations" ADD CONSTRAINT "receipt_confirmations_signer_id_fkey" FOREIGN KEY ("signer_id") REFERENCES "recipients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_confirmations" ADD CONSTRAINT "receipt_confirmations_captured_by_id_fkey" FOREIGN KEY ("captured_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_images" ADD CONSTRAINT "receipt_images_confirmation_id_fkey" FOREIGN KEY ("confirmation_id") REFERENCES "receipt_confirmations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The three settings, under Settings → Inventory. Ask is the starting point,
-- to be moved to Required once the counter is ready.
INSERT INTO "settings" ("key", "value", "type", "category", "description", "is_editable", "enum_options", "updated_at") VALUES
  ('inventory.receiptConfirmation', '"ask"', 'enum', 'inventory',
   'Whether the person collecting stock or tools confirms they took it. Off: no hand-over step. Ask: the hand-over step opens after each issue and check-out, and can be skipped. Required: skipping needs a reason, and slips not confirmed are counted on the Dashboard.',
   true, '["off","ask","require"]', CURRENT_TIMESTAMP),
  ('inventory.receiptPinTries', '5', 'number', 'inventory',
   'Wrong PIN tries before a counter PIN locks. A store controller unlocks it on Recipients.',
   true, NULL, CURRENT_TIMESTAMP),
  ('inventory.receiptImageKeepMonths', '24', 'number', 'inventory',
   'How long signatures and photos of signed slips are kept, in months: at least 24, or 0 to keep them always. After that the image is removed and the record that the slip was signed stays.',
   true, NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
