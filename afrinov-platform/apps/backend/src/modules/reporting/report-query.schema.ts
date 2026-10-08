// Zod schemas for the inventory report query.
//
// The Reports page normalises a UI filter state (date range preset, multi-
// select dimensions, search) into a single `ReportQuery` object that is
// shared verbatim by:
//   - GET /api/v1/reports/inventory (JSON dataset + KPIs)
//   - GET /api/v1/reports/inventory/export?format=xlsx|pdf (file)
//
// The two endpoints therefore produce data that is consistent by construction:
// same query string → same dataset → same export content.
import { z } from 'zod';

export const MaterialCategoryValues = [
  'FASTENERS_SLUGS_INSULATION',
  'TOOLING_PPE_ELECTRICAL',
  'PROJECT_MATERIAL',
  'CONSUMABLES',
  'TOOLS',
] as const;

export const ReportStatusValues = ['ALL', 'IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK'] as const;
export const ReportMovementTypeValues = ['RECEIPT', 'ISSUE', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT', 'RETURN'] as const;
export const DateRangePresetValues = [
  'ALL',
  'TODAY',
  'WEEK',
  'MONTH',
  'QUARTER',
  'YEAR',
  'CUSTOM',
] as const;

export const stockStatusSchema = z.enum(ReportStatusValues);
export const movementTypeSchema = z.enum(ReportMovementTypeValues);
export const dateRangePresetSchema = z.enum(DateRangePresetValues);
export const materialCategorySchema = z.enum(MaterialCategoryValues);

// Single source of truth for "what does the inventory report want to know".
// The UI's filter state is parsed/serialised through this schema on both
// the client and the server so the request and the export cannot drift.
export const reportQuerySchema = z
  .object({
    // Date range filter (applied to movement totals + transaction list).
    // CUSTOM requires both `from` and `to`. All other presets are computed
    // by the server relative to `now` and so do not need explicit bounds.
    range: dateRangePresetSchema.default('ALL'),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),

    // Dimensional filters.
    category: z.array(materialCategorySchema).default([]),
    locationId: z.array(z.string().min(1)).default([]),
    supplierId: z.array(z.string().min(1)).default([]),
    materialId: z.array(z.string().min(1)).default([]),

    // Stock status filter. 'ALL' means do not filter.
    stockStatus: stockStatusSchema.default('ALL'),

    // Item status filter. 'ALL' is the default; 'ACTIVE' and 'INACTIVE' are
    // the two real options against Material.active.
    itemStatus: z.enum(['ALL', 'ACTIVE', 'INACTIVE']).default('ACTIVE'),

    // Free-text search over SKU + name.
    search: z.string().trim().min(1).max(100).optional(),

    // Movement type filter for the activity table.
    movementType: movementTypeSchema.optional(),

    // Pagination for the detailed inventory list.
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(1000).default(200),
  })
  .refine(
    (q) => {
      if (q.range !== 'CUSTOM') return true;
      if (!q.from || !q.to) return false;
      return new Date(q.from).getTime() <= new Date(q.to).getTime();
    },
    { message: 'Custom date range requires from <= to' },
  );

export type ReportQuery = z.infer<typeof reportQuerySchema>;

// Normalises a raw query object (e.g. from Fastify's `req.query` where
// repeated keys are strings) into a typed ReportQuery.
export function parseReportQuery(raw: unknown): ReportQuery {
  const r = (raw ?? {}) as Record<string, unknown>;

  // Coerce repeated/comma-separated query values into arrays. Fastify by
  // default returns the last value for a repeated key, but the front-end
  // encodes multi-selects as repeated `category=...&category=...` OR as
  // comma-separated values. We accept both forms.
  const toArr = (v: unknown): string[] => {
    if (v === undefined || v === null || v === '') return [];
    if (Array.isArray(v)) return v.flatMap((x) => String(x).split(',').map((s) => s.trim()).filter(Boolean));
    return String(v).split(',').map((s) => s.trim()).filter(Boolean);
  };

  const normalised: Record<string, unknown> = {
    range: r['range'] ?? 'ALL',
    from: r['from'] || undefined,
    to: r['to'] || undefined,
    category: toArr(r['category']),
    locationId: toArr(r['locationId']),
    supplierId: toArr(r['supplierId']),
    materialId: toArr(r['materialId']),
    stockStatus: r['stockStatus'] ?? 'ALL',
    itemStatus: r['itemStatus'] ?? 'ACTIVE',
    search: r['search'] || undefined,
    movementType: r['movementType'] || undefined,
    page: r['page'] ?? 1,
    pageSize: r['pageSize'] ?? 200,
  };
  return reportQuerySchema.parse(normalised);
}

// Resolves the preset into a concrete [from, to] date window in UTC.
// `ALL` returns nulls. `CUSTOM` returns the user-supplied bounds.
export function resolveDateWindow(
  q: ReportQuery,
  now: Date = new Date(),
): { from: Date | null; to: Date | null } {
  switch (q.range) {
    case 'ALL':
      return { from: null, to: null };
    case 'TODAY': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      return { from: start, to: end };
    }
    case 'WEEK': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const day = start.getUTCDay(); // 0 (Sun) .. 6 (Sat)
      start.setUTCDate(start.getUTCDate() - day); // Sunday-anchored week
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 7);
      return { from: start, to: end };
    }
    case 'MONTH': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      return { from: start, to: end };
    }
    case 'QUARTER': {
      const q0 = Math.floor(now.getUTCMonth() / 3) * 3;
      const start = new Date(Date.UTC(now.getUTCFullYear(), q0, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), q0 + 3, 1));
      return { from: start, to: end };
    }
    case 'YEAR': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
      return { from: start, to: end };
    }
    case 'CUSTOM': {
      return {
        from: q.from ? new Date(q.from) : null,
        to: q.to ? new Date(q.to) : null,
      };
    }
  }
}
