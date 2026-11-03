// Mirrors MonthEndService.report (apps/backend/src/modules/reporting/
// month-end.service.ts) for frontend-only mode: stock as at the end of the
// period (a month or any from/to range of days) from the ledger, graded by the
// stock status bands, with the period's stock used from the consumption report.
import type { ApiError } from '../api/client';
import { classifyItem, type StatusBands } from '../lib/stockStatus';
import type { ConsumptionReport, MonthEndCategory, MonthEndItem, MonthEndProject, MonthEndReport } from '../api/reportTypes';
import type { MockInventoryTransaction, MockLocation, MockMaterial, MockProject } from './types';

const ORDER = ['CONSUMABLES', 'FASTENERS_SLUGS_INSULATION', 'TOOLING_PPE_ELECTRICAL', 'PROJECT_MATERIAL', 'TOOLS'];
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const fail = (message: string): ApiError => ({ code: 'VALIDATION_ERROR', message });

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve the period as the backend's reportRange does: from/to when either is
 * given (both required, both days included, the first not in the future), else
 * the month, else this UTC month. month is set only for exactly one calendar month.
 * @throws A VALIDATION_ERROR ApiError object for malformed, reversed or future periods.
 */
function resolveRange(q: { month?: string; from?: string; to?: string }, now: Date): { month: string | null; from: string; to: string; end: string } {
  if (q.from || q.to) {
    if (!q.from || !q.to) throw fail('Give both a start and an end date');
    if (!DAY.test(q.from) || !DAY.test(q.to)) throw fail('Dates must be YYYY-MM-DD');
    const start = new Date(`${q.from}T00:00:00.000Z`);
    const last = new Date(`${q.to}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(last.getTime())
      || start.toISOString().slice(0, 10) !== q.from || last.toISOString().slice(0, 10) !== q.to) throw fail('Invalid date');
    if (q.from > q.to) throw fail('The start date is after the end date');
    if (q.from > now.toISOString().slice(0, 10)) throw fail('That period has not started yet');
    const end = new Date(last.getTime() + 86_400_000);
    const whole = q.from.endsWith('-01') && end.getUTCDate() === 1 && q.from.slice(0, 7) === q.to.slice(0, 7);
    return { month: whole ? q.from.slice(0, 7) : null, from: q.from, to: q.to, end: end.toISOString() };
  }
  const month = q.month || now.toISOString().slice(0, 7);
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw fail('Month must be YYYY-MM');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (y * 12 + mo > now.getUTCFullYear() * 12 + now.getUTCMonth() + 1) throw fail('That month has not started yet');
  return {
    month,
    from: new Date(Date.UTC(y, mo - 1, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(y, mo, 1)).toISOString(),
  };
}

/**
 * Build the frontend-only report from ledger balances before UTC midnight
 * after the period's last day and the supplied consumption report. Includes active items and
 * inactive items with nonzero location balances; omits empty categories.
 * Stock values use supplied prices (null when absent, zero toward totals),
 * ratios are fractions, and reorder quantities may be negative.
 * @param q - A YYYY-MM month (the current UTC month is allowed; years 0000–0099
 * follow Date.UTC's mapping to 1900–1999) or a from/to range of days.
 * @param data - Current catalog and settings plus ledger entries with comparable
 * UTC ISO timestamps. consumption receives inclusive YYYY-MM-DD bounds;
 * usage locations reflect holdings at the end, not the issue locations.
 * @param now - Reference for future-period validation and generatedAt.
 * @throws A VALIDATION_ERROR ApiError object for malformed or future periods.
 * Errors from consumption propagate; an invalid now causes a RangeError.
 */
export function computeMonthEnd(
  q: { month?: string; from?: string; to?: string },
  data: {
    transactions: MockInventoryTransaction[]; materials: MockMaterial[]; locations: MockLocation[];
    bands: StatusBands; currency: string; consumption: (from: string, to: string) => ConsumptionReport;
    /** For the projects' names and statuses in the by-project summary. */
    projects?: MockProject[];
  },
  now = new Date(),
): MonthEndReport {
  const { month, from, to, end } = resolveRange(q, now);

  const locationName = new Map(data.locations.map((l) => [l.id, l.name]));
  // Stock at the end per item, then per holder ('' for Stores, else the
  // project it is held for), then per location.
  const balance = new Map<string, Map<string, Map<string, number>>>();
  for (const t of data.transactions) {
    if (t.postedAt >= end) continue;
    const holders = balance.get(t.materialId) ?? new Map<string, Map<string, number>>();
    const holder = t.heldForProject ?? '';
    const perLocation = holders.get(holder) ?? new Map<string, number>();
    perLocation.set(t.locationId, (perLocation.get(t.locationId) ?? 0) + Number(t.quantity));
    holders.set(holder, perLocation);
    balance.set(t.materialId, holders);
  }
  // Tools out on loan at the end are still owned (see the backend's tool-loans.ts).
  const onLoan = (materialId: string) => -data.transactions
    .filter((t) => t.materialId === materialId && t.postedAt < end && (t.type === 'LOAN' || t.type === 'LOAN_RETURN'))
    .reduce((a, t) => a + Number(t.quantity), 0);
  const holdersOf = (materialId: string) => [...(balance.get(materialId) ?? new Map<string, Map<string, number>>())]
    .filter(([, perLocation]) => [...perLocation.values()].some((q) => q !== 0))
    .map(([h]) => h);
  const held = (materialId: string, holders = holdersOf(materialId)) => {
    const at = new Map<string, number>();
    for (const h of holders) for (const [loc, q] of balance.get(materialId)?.get(h) ?? []) at.set(loc, (at.get(loc) ?? 0) + q);
    return [...at]
      .filter(([, q]) => q !== 0)
      .map(([loc, quantity]) => ({ location: locationName.get(loc) ?? '—', quantity }))
      .sort((a, b) => b.quantity - a.quantity);
  };
  const whereKept = (rows: Array<{ location: string; quantity: number }>) => {
    if (rows.length === 0) return '';
    return rows.length === 1 ? rows[0]!.location : rows.map((r) => `${r.location} (${round4(r.quantity)})`).join(', ');
  };
  const consumption = data.consumption(from, to);
  const skuToId = new Map(data.materials.map((x) => [x.sku, x.id]));

  // A project's line has no Required Stock, as the server reports it.
  const itemOf = (x: MockMaterial, holders: string[], project: string | null, forProject = false): MonthEndItem => {
    const rows = held(x.id, holders);
    const current = round4(rows.reduce((a, r) => a + r.quantity, 0));
    const required = forProject ? 0 : Number(x.requiredStock);
    const unitCost = x.unitCost === undefined || x.unitCost === null ? null : Number(x.unitCost);
    const owned = round4(current + (holders.includes('') ? onLoan(x.id) : 0));
    const s = classifyItem(owned, required, data.bands);
    return {
      sku: x.sku, name: x.name, location: whereKept(rows), requiredStock: required, currentStock: current, unitCost,
      value: unitCost === null ? null : round2(current * unitCost),
      percentOfRequired: s.percentOfRequired === null ? null : round4(owned / required),
      reorderQuantity: required > 0 ? round4(required - owned) : null,
      status: s.status,
      project,
    };
  };

  const categories: MonthEndCategory[] = [];
  for (const category of ORDER) {
    let items: MonthEndItem[];
    if (category !== 'PROJECT_MATERIAL') {
      // Stores stock only, as the server counts it: stock held for a project is not the store's.
      items = data.materials
        .filter((x) => x.category === category && (x.active || holdersOf(x.id).includes('')))
        .sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }))
        .map((x) => itemOf(x, [''], x.projectNumber ?? null));
    } else {
      // A line per item and project holding it; leftovers keep the item's project.
      items = [];
      for (const x of data.materials) {
        const byProject = new Map<string, string[]>();
        for (const h of holdersOf(x.id)) {
          if (h === '' && x.category !== 'PROJECT_MATERIAL') continue;
          const project = h || (x.projectNumber ?? '');
          byProject.set(project, [...(byProject.get(project) ?? []), h]);
        }
        if (byProject.size === 0 && x.category === 'PROJECT_MATERIAL' && x.active) byProject.set(x.projectNumber ?? '', ['']);
        for (const [project, holders] of byProject) items.push(itemOf(x, holders, project || null, true));
      }
      items.sort((a, b) => (a.project ?? '\uffff').localeCompare(b.project ?? '\uffff')
        || a.sku.localeCompare(b.sku, undefined, { numeric: true }));
    }
    const used = consumption.items
      .filter((i) => i.category === category)
      .map((i) => ({ sku: i.sku, name: i.name, location: whereKept(held(skuToId.get(i.sku) ?? '')), used: i.used, value: i.value }))
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
  // Projects material per project, as the server adds it up.
  const projects = new Map<string, MonthEndProject>();
  for (const i of categories.find((c) => c.category === 'PROJECT_MATERIAL')?.items ?? []) {
    const key = i.project ?? '';
    const info = data.projects?.find((p) => p.projectNumber === i.project);
    const p = projects.get(key) ?? { projectNumber: i.project ?? null, name: info?.name ?? null, status: info?.status ?? null, items: 0, itemsInStock: 0, value: 0 };
    p.items++;
    if (i.currentStock > 0) p.itemsInStock++;
    p.value = round2(p.value + (i.value ?? 0));
    projects.set(key, p);
  }
  return {
    month, from, to, generatedAt: now.toISOString(), currency: data.currency, bands: data.bands, categories,
    projects: [...projects.values()].sort((a, b) => (a.projectNumber === null ? 1 : b.projectNumber === null ? -1 : a.projectNumber.localeCompare(b.projectNumber))),
    total: {
      items: sum((c) => c.items.length), itemsInStock: sum((c) => c.itemsInStock), value: round2(sum((c) => c.value)),
      urgent: sum((c) => c.urgent), warning: sum((c) => c.warning), usedValue: round2(sum((c) => c.usedValue)),
    },
  };
}
