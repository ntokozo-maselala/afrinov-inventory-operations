-- Reports and what figures mean (ADR-041, system audit P5).

-- G1: a closed month keeps its stock report, and every item's unit cost then,
-- which values that month's stock used.
CREATE TABLE "month_closes" (
    "month" TEXT NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by_id" TEXT NOT NULL,
    "report" JSONB NOT NULL,

    CONSTRAINT "month_closes_pkey" PRIMARY KEY ("month"),
    CONSTRAINT "month_closes_month_check" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
ALTER TABLE "month_closes" ADD CONSTRAINT "month_closes_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "month_close_prices" (
    "month" TEXT NOT NULL,
    "material_id" TEXT NOT NULL,
    "unit_cost" DECIMAL(18,4),

    CONSTRAINT "month_close_prices_pkey" PRIMARY KEY ("month","material_id")
);
ALTER TABLE "month_close_prices" ADD CONSTRAINT "month_close_prices_month_fkey" FOREIGN KEY ("month") REFERENCES "month_closes"("month") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "month_close_prices" ADD CONSTRAINT "month_close_prices_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
