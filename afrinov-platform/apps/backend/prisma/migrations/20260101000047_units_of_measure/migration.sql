-- Units of measure become a list every item points at. A COUNTED unit takes
-- whole numbers only (no 0,0001 of a washer); a MEASURED one keeps the 4
-- decimal places the quantity columns hold. Adjustments gain FOUND, the one
-- reason that only adds stock.

-- CreateEnum
CREATE TYPE "UnitKind" AS ENUM ('COUNTED', 'MEASURED');

-- AlterEnum
ALTER TYPE "AdjustmentReasonCode" ADD VALUE 'FOUND';

-- CreateTable
CREATE TABLE "units_of_measure" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "UnitKind" NOT NULL,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("code")
);

-- The list. Keep it in step with UNIT_ALIASES in src/shared/units.ts.
INSERT INTO "units_of_measure" ("code", "label", "kind", "sort_order") VALUES
  ('each',   'Each',         'COUNTED',  10),
  ('pair',   'Pair',         'COUNTED',  20),
  ('set',    'Set',          'COUNTED',  30),
  ('box',    'Box',          'COUNTED',  40),
  ('pack',   'Pack',         'COUNTED',  50),
  ('roll',   'Roll',         'COUNTED',  60),
  ('bag',    'Bag',          'COUNTED',  70),
  ('sheet',  'Sheet',        'COUNTED',  80),
  ('length', 'Length',       'COUNTED',  90),
  ('m',      'Metre',        'MEASURED', 110),
  ('mm',     'Millimetre',   'MEASURED', 120),
  ('kg',     'Kilogram',     'MEASURED', 130),
  ('g',      'Gram',         'MEASURED', 140),
  ('l',      'Litre',        'MEASURED', 150),
  ('ml',     'Millilitre',   'MEASURED', 160),
  ('m2',     'Square metre', 'MEASURED', 170),
  ('m3',     'Cubic metre',  'MEASURED', 180);

-- Items keep their unit under its listed code: "EA", "pcs" and "Each " all
-- become each. Matched on the trimmed, lower-case spelling.
UPDATE "materials" m
SET "unit_of_measure" = a."code"
FROM (VALUES
  ('each', 'each'), ('ea', 'each'), ('pc', 'each'), ('pcs', 'each'), ('piece', 'each'), ('pieces', 'each'),
  ('unit', 'each'), ('units', 'each'), ('no', 'each'), ('no.', 'each'), ('nos', 'each'), ('item', 'each'), ('items', 'each'),
  ('pair', 'pair'), ('pairs', 'pair'), ('pr', 'pair'), ('prs', 'pair'),
  ('set', 'set'), ('sets', 'set'),
  ('box', 'box'), ('boxes', 'box'), ('bx', 'box'),
  ('pack', 'pack'), ('packs', 'pack'), ('pk', 'pack'), ('pkt', 'pack'), ('packet', 'pack'), ('packets', 'pack'),
  ('roll', 'roll'), ('rolls', 'roll'), ('rl', 'roll'),
  ('bag', 'bag'), ('bags', 'bag'),
  ('sheet', 'sheet'), ('sheets', 'sheet'),
  ('length', 'length'), ('lengths', 'length'), ('lgth', 'length'),
  ('m', 'm'), ('metre', 'm'), ('metres', 'm'), ('meter', 'm'), ('meters', 'm'), ('mtr', 'm'), ('mtrs', 'm'), ('lm', 'm'),
  ('mm', 'mm'), ('millimetre', 'mm'), ('millimetres', 'mm'), ('millimeter', 'mm'), ('millimeters', 'mm'),
  ('kg', 'kg'), ('kgs', 'kg'), ('kilogram', 'kg'), ('kilograms', 'kg'), ('kilo', 'kg'), ('kilos', 'kg'),
  ('g', 'g'), ('gram', 'g'), ('grams', 'g'),
  ('l', 'l'), ('litre', 'l'), ('litres', 'l'), ('liter', 'l'), ('liters', 'l'), ('lt', 'l'), ('ltr', 'l'),
  ('ml', 'ml'), ('millilitre', 'ml'), ('millilitres', 'ml'), ('milliliter', 'ml'), ('milliliters', 'ml'),
  ('m2', 'm2'), ('m²', 'm2'), ('sqm', 'm2'), ('sq m', 'm2'),
  ('m3', 'm3'), ('m³', 'm3'), ('cubic metre', 'm3'), ('cubic metres', 'm3')
) AS a("alias", "code")
WHERE lower(btrim(m."unit_of_measure")) = a."alias"
  AND m."unit_of_measure" <> a."code";

-- A spelling nothing matched is kept as its own unit, MEASURED so its items
-- take what they took before, and marked for review rather than hidden.
INSERT INTO "units_of_measure" ("code", "label", "kind", "needs_review", "sort_order")
SELECT DISTINCT m."unit_of_measure", m."unit_of_measure", 'MEASURED'::"UnitKind", true, 1000
FROM "materials" m
WHERE NOT EXISTS (SELECT 1 FROM "units_of_measure" u WHERE u."code" = m."unit_of_measure");

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_unit_of_measure_fkey" FOREIGN KEY ("unit_of_measure") REFERENCES "units_of_measure"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
