# Prototype Validation

**Status:** DRAFT · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Before building beyond Milestone 1, validate the domain model
(`03-domain/`) against 3–5 real historical transactions pulled directly
from the workbook (e.g. a `FS&I Issued` receipt row, a `Tools Issued`
check-out row, a `Project Material Issued` row referencing `AFRI-1341`) by
walking them through the proposed data model by hand and confirming every
field has a home and every business rule holds.

*Unverified:* whether this walk-through was done is not recorded in the
repository. The workbook import's dry run now performs a mechanical
version of it for every Main-sheet row (`07-data/migration-strategy.md`).
