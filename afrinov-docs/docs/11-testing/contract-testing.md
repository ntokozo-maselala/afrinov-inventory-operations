# Contract Testing

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Intent: contract tests catch drift between backend responses and frontend
expectations before it reaches a user.

Implemented: the OpenAPI document (`src/openapi/document.ts`) is generated
from the same Zod schemas the routes validate requests with, and
`src/openapi/openapi.test.ts` fails unless the documented operations are
exactly the registered routes (with procurement on and off). This covers
request shapes and route existence only. **Response bodies are not
described** in the OpenAPI document, and no test checks response shapes
against frontend types — **Planned**. The frontend's types for API
responses are hand-written (e.g. `src/mock/types.ts`).

## Evidence
- `afrinov-platform/apps/backend/src/openapi/openapi.test.ts:37-62`
- `afrinov-platform/apps/backend/src/openapi/document.ts`
- `afrinov-platform/apps/frontend/src/mock/types.ts`
