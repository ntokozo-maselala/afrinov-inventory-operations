-- The supplier's own quotation PDF, kept with their quote on a request for
-- quotation (RFQ roadmap, Phase 4). One per supplier asked. Only adds a table.
-- CreateTable
CREATE TABLE "rfq_quote_files" (
    "rfq_supplier_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by_id" TEXT NOT NULL,

    CONSTRAINT "rfq_quote_files_pkey" PRIMARY KEY ("rfq_supplier_id")
);

-- AddForeignKey
ALTER TABLE "rfq_quote_files" ADD CONSTRAINT "rfq_quote_files_rfq_supplier_id_fkey" FOREIGN KEY ("rfq_supplier_id") REFERENCES "rfq_suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_quote_files" ADD CONSTRAINT "rfq_quote_files_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

