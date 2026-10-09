// Mirrors MonthEndService.report (apps/backend/src/modules/reporting/
// month-end.service.ts) for frontend-only mode: stock as at the end of the
// month from the ledger, graded by the stock status bands, with the month's
// stock used from the consumption report.
import type { ApiError } from '../api/client';
import { classifyItem, type StatusBands } from '../lib/stockStatus';
import type { ConsumptionReport, MonthEndCategory, MonthEndItem, MonthEndReport } from '../api/reportTypes';
import type { MockInventoryTransaction, MockLocation, MockMaterial } from './types';

const ORDER = ['CONSUMABLES', 'FASTENERS_SLUGS_INSULATION', 'TOOLING_PPE_ELECTRICAL', 'PROJECT_MATERIAL', 'TOOLS'];
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const fail = (message: string): ApiError => ({ code: 'VALIDATION_ERROR', message });

/**
 * Build the frontend-only report from ledger balances before the next month's
 * UTC midnight and the supplied consumption report. Includes active items and
 * inactive items with nonzero location balances; omits empty categories.
 * Stock values use supplied prices (null when absent, zero toward totals),
 * ratios are fractions, and reorder quantities may be negative.
 * @param month - YYYY-MM; the current UTC month is allowed. Years 0000–0099
 * follow Date.UTC's mapping to 1900–1999.
 * @param data - Current catalog and settings plus ledger entries with comparable
 * UTC ISO timestamps. consumption receives inclusive YYYY-MM-DD month bounds;
 * usage locations reflect month-end holdings, not the issue locations.
 * @param now - Reference for future-month validation and generatedAt.
 * @throws A VALIDATION_ERROR ApiError object for malformed or future months.
 * Errors from consumption propagate; an invalid now causes a RangeError.
 */
export function computeMonthEnd(
  month: string,
  data: {
    transactions: MockInventoryTransaction[]; materials: MockMaterial[]; locations: MockLocation[];
    bands: StatusBands; currency: string; consumption: (from: string, to: string) => ConsumptionReport;
  },
  now = new Date(),
): MonthEndReport {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw fail('Month must be YYYY-MM');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (y * 12 + mo > now.getUTCFullYear() * 12 + now.getUTCMonth() + 1) throw fail('That month has not started yet');
  const from = new Date(Date.UTC(y, mo - 1, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, mo, 1)).toISOString();

  const locationName = new Map(data.locations.map((l) => [l.id, l.name]));
  const balance = new Map<string, Map<string, number>>();
  for (const t of data.transactions) {
    if (t.postedAt >= end) continue;
    const perLocation = balance.get(t.materialId) ?? new Map<string, number>();
    perLocation.set(t.locationId, (perLocation.get(t.locationId) ?? 0) + Number(t.quantity));
    balance.set(t.materialId, perLocation);
  }
  const held = (materialId: string) => [...(balance.get(materialId) ?? new Map<string, number>())]
    .filter(([, q]) => q !== 0)
    .map(([loc, quantity]) => ({ location: locationName.get(loc) ?? '—', quantity }))
    .sort((a, b) => b.quantity - a.quantity);
  const whereKept = (materialId: string) => {
    const rows = held(materialId);
    if (rows.length === 0) return '';
    return rows.length === 1 ? rows[0]!.location : rows.map((r) => `${r.location} (${round4(r.quantity)})`).join(', ');
  };
  const consumption = data.consumption(from, to);
  const skuToId = new Map(data.materials.map((x) => [x.sku, x.id]));

  const categories: MonthEndCategory[] = [];
  for (const category of ORDER) {
    const mine = data.materials
      .filter((x) => x.category === category && (x.active || held(x.id).length > 0))
      .sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));
    const items: MonthEndItem[] = mine.map((x) => {
      const current = round4(held(x.id).reduce((a, r) => a + r.quantity, 0));
      const required = Number(x.requiredStock);
      const unitCost = x.unitCost === undefined || x.unitCost === null ? null : Number(x.unitCost);
      const s = classifyItem(current, required, data.bands);
      return {
        sku: x.sku, name: x.name, location: whereKept(x.id), requiredStock: required, currentStock: current, unitCost,
        value: unitCost === null ? null : round2(current * unitCost),
        percentOfRequired: s.percentOfRequired === null ? null : round4(current / required),
        reorderQuantity: required > 0 ? round4(required - current) : null,
        status: s.status,
      };
    });
    const used = consumption.items
      .filter((i) => i.category === category)
      .map((i) => ({ sku: i.sku, name: i.name, location: whereKept(skuToId.get(i.sku) ?? ''), used: i.used, value: i.value }))
      .sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));
    if (items.length === 0 && used.length === 0) continue;
    categories.push({
      category, items,
      value: round2(items.reduce((a, i) => a + (i.value ?? 0), 0)),
      urgent: items.filter((i) => i.status === 'URGENT').length,
      warning: items.filter((i) => i.status === 'WARNING').length,
      itemsInStock: items.filter((i) => i.currentStock > 0).length,
      used,
      usedValue: round2(used.reduce((a, u) => a + (u.value ?? 0), 0)),
    });
  }
  const sum = (f: (c: MonthEndCategory) => number) => categories.reduce((a, c) => a + f(c), 0);
  return {
    month, from, to, generatedAt: now.toISOString(), currency: data.currency, bands: data.bands, categories,
    total: {
      items: sum((c) => c.items.length), itemsInStock: sum((c) => c.itemsInStock), value: round2(sum((c) => c.value)),
      urgent: sum((c) => c.urgent), warning: sum((c) => c.warning), usedValue: round2(sum((c) => c.usedValue)),
    },
  };
}
