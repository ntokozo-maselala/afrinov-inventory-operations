-- A tool kept as one unit carries its serial number, unique when set.
ALTER TABLE "materials" ADD COLUMN "serial_number" TEXT;
CREATE UNIQUE INDEX "materials_serial_number_key" ON "materials"("serial_number");
