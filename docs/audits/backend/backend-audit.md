# Backend typecheck audit

**Date:** 2026-10-07  
**Scope:** The pasted `npm run typecheck` diagnostics and the backend workspace in `afrinov-platform/apps/backend`. This is a build/typecheck investigation, not a full security or operational audit.

## Executive finding

**P1 — The backend typecheck is compiling against an ungenerated Prisma Client.**

The failure is not 210 unrelated source defects. The installed declaration at `afrinov-platform/node_modules/.prisma/client/default.d.ts` is Prisma's placeholder: it declares `PrismaClient` and `Prisma.TransactionClient` as `any` and does not expose this application's generated models, enums, decimal type, or query/input types. Meanwhile, `apps/backend/prisma/schema.prisma` defines the referenced types, including `LocationType`, `InventoryTransactionType`, `RackStatus`, `MaterialCategory`, and the corresponding models.

With generated declarations missing, imports and Prisma namespace references fail across unrelated modules. Query results and transaction callbacks then lose their inferred types, producing secondary implicit-`any` errors and downstream property errors. Fixing those individual callbacks or weakening strict TypeScript settings would treat symptoms and hide type safety rather than resolve the cause.

## Reproduction and evidence

- From the repository root, `npm run typecheck` cannot run because that directory has no `package.json`. The workspace root is `afrinov-platform`.
- From `afrinov-platform`, `npm run typecheck` runs the backend workspace's `tsc -p tsconfig.json --noEmit` and reproduces **210 errors across 23 files**.
- The backend package's `typecheck` script runs `tsc` directly; there is no Prisma generation step in that lifecycle.
- Prisma Client is locked at **5.22.0**. The schema uses the standard `prisma-client-js` generator.
- The backend Dockerfile already runs `npx prisma generate` before its build. That is a useful existing safeguard for the image build, but it does not run when developers or CI invoke `npm run typecheck`.

## Error map

Counts below are the compiler's per-file summary from the reproduced run. They show breadth of impact; they do not indicate 23 separate root causes.

| Backend file | Errors | Observed impact |
|---|---:|---|
| `src/db/seed.ts` | 2 | Implicit `any` in Prisma-related code |
| `src/diagnostic.ts` | 1 | Implicit `any` |
| `src/modules/identity/identity.service.ts` | 12 | Missing generated Prisma types and inferred types |
| `src/modules/inventory/inventory.service.test.ts` | 30 | `Prisma.Decimal` references missing |
| `src/modules/inventory/inventory.service.ts` | 14 | Missing enum, decimal, query-input and JSON types; inferred `any` cascade |
| `src/modules/inventory/location.service.test.ts` | 3 | Missing `LocationType`; inferred `any` |
| `src/modules/inventory/location.service.ts` | 10 | Missing enum and Prisma model/input types; inferred `any` |
| `src/modules/inventory/material.service.ts` | 6 | Missing Prisma JSON/model types |
| `src/modules/inventory/rack.service.test.ts` | 1 | Missing `RackStatus` |
| `src/modules/inventory/rack.service.ts` | 6 | Missing enum and Prisma model/input/JSON types |
| `src/modules/inventory/stock-item.service.test.ts` | 12 | Missing `Prisma.Decimal` and Prisma error class |
| `src/modules/inventory/stock-item.service.ts` | 3 | Missing transaction and JSON typing |
| `src/modules/operations/project.service.ts` | 5 | Missing generated Prisma query/input types |
| `src/modules/procurement/goods-receipt.service.ts` | 1 | Missing generated Prisma types |
| `src/modules/procurement/procurement.service.test.ts` | 12 | Missing generated Prisma types |
| `src/modules/procurement/procurement.service.ts` | 10 | Missing JSON, update-input and transaction typing |
| `src/modules/reporting/report.service.ts` | 6 | Missing category, decimal and query-input types |
| `src/modules/reporting/reporting.service.test.ts` | 8 | Missing decimal typing; inferred `any` |
| `src/modules/reporting/reporting.service.ts` | 34 | Missing Prisma model/query/decimal types; downstream map/property errors |
| `src/modules/settings/settings.service.ts` | 18 | Missing JSON/`JsonNull` and transaction typing; inferred `any` |
| `src/shared/decimal.test.ts` | 6 | Missing `Prisma.Decimal` |
| `src/shared/decimal.ts` | 9 | Missing `Prisma.Decimal` |
| `src/shared/inventory/balances.ts` | 1 | Missing `Prisma.Decimal` |
| **Total** | **210** | **23 files** |

## Recommended production-ready remediation

1. **Generate the client from the backend's authoritative schema.** From `afrinov-platform/apps/backend`, run:

   ```powershell
   npx prisma generate --schema prisma/schema.prisma
   npm run typecheck
   ```

   This is the immediate recovery step. Do not edit generated files in `node_modules` or commit generated client output.

2. **Make generation a deterministic part of every compile path.** Add one backend script, for example:

   ```json
   "db:generate": "prisma generate --schema prisma/schema.prisma"
   ```

   Invoke it automatically before both `typecheck` and `build` (for example through npm's `pretypecheck` and `prebuild` lifecycle scripts). Then keep the Docker build on that same generation path rather than maintaining a separate command that can drift. This makes a clean checkout behave consistently for developers, CI and container builds.

3. **Verify a clean install and CI sequence.** With the lockfile-installed Prisma CLI/client pair, run generation before typecheck, tests and build in CI. Assert the generated types include the schema's models and enums; fail the pipeline if generation fails. Do not mask this failure with relaxed TypeScript settings, hand-written model declarations or a Prisma version upgrade unrelated to the diagnosis.

4. **Keep migrations separate from client generation.** `prisma generate` produces local client code from the schema; it does not apply database migrations. Retain the existing migration deployment step and verify it independently against the target database.

## Verification criteria

After implementing the remediation:

- `npm run typecheck` from `afrinov-platform` completes with zero TypeScript errors.
- `npm run build` completes from a clean dependency install without relying on a previously generated local artifact.
- The generated client corresponds to `apps/backend/prisma/schema.prisma` and the lockfile-selected Prisma version.
- The existing migration deployment path is tested independently; successful type generation is not evidence that the production database is migrated.

