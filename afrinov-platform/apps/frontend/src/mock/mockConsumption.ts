// Mirrors ConsumptionService.report (apps/backend/src/modules/reporting/
// consumption.service.ts) for frontend-only mode: issued less returned per
// item in a date range, valued at unit price, by project and category, with
// reversed issues and returns left out together with their reversals.
import type { ApiError } from '../api/client';
import type { MockInventoryTransaction, MockMaterial, MockProject } from './types';

export interface ConsumptionItem {
  materialId: string; sku: string; name: string; category: string; unitOfMeasure: string;
  issued: number; returned: number; used: number; unitCost: number | null; value: number | null;
}

export interface ConsumptionReport {
  from: string;
  to: string;
  currency: string;
  items: ConsumptionItem[];
  byProject: Array<{ projectNumber: string | null; projectName: string | null; value: number; items: number }>;
  byCategory: Array<{ category: string; value: number; items: number }>;
  total: { value: number; items: number; unpriced: number };
}

export const NO_PROJECT = '__none__';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const fail = (message: string): ApiError => ({ code: 'VALIDATION_ERROR', message });

export function computeConsumption(
  qs: Record<string, string>,
  data: { transactions: MockInventoryTransaction[]; materials: MockMaterial[]; projects: MockProject[]; currency?: string },
  now = new Date(),
): ConsumptionReport {
  const from = qs.from || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const to = qs.to || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  if (!DAY.test(from) || !DAY.test(to)) throw fail('Dates must be YYYY-MM-DD');
  if (from > to) throw fail('The start date is after the end date');
  const end = new Date(`${to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = `${from}T00:00:00.000Z`;

  const reversed = new Set(data.transactions.filter((t) => t.reversesId).map((t) => t.reversesId));
  const materials = new Map(data.materials.map((m) => [m.id, m]));
  const items = new Map<string, ConsumptionItem>();
  const projects = new Map<string | null, { value: number; materials: Set<string> }>();

  for (const t of data.transactions) {
    if (t.type !== 'ISSUE' && t.type !== 'RETURN') continue;
    if (t.reversesId || reversed.has(t.id)) continue;
    if (t.postedAt < start || t.postedAt >= end.toISOString()) continue;
    if (qs.projectNumber === NO_PROJECT ? t.projectNumber : qs.projectNumber && t.projectNumber !== qs.projectNumber) continue;
    const m = materials.get(t.materialId);
    if (!m || (qs.category && m.category !== qs.category)) continue;
    const qty = Number(t.quantity);
    const unitCost = m.unitCost === undefined || m.unitCost === null ? null : Number(m.unitCost);
    const item = items.get(m.id) ?? {
      materialId: m.id, sku: m.sku, name: m.name, category: m.category, unitOfMeasure: m.unitOfMeasure,
      issued: 0, returned: 0, used: 0, unitCost, value: null,
    };
    if (t.type === 'ISSUE') item.issued -= qty;
    else item.returned += qty;
    items.set(m.id, item);
    const key = t.projectNumber ?? null;
    const p = projects.get(key) ?? { value: 0, materials: new Set<string>() };
    p.value += -qty * (unitCost ?? 0);
    p.materials.add(m.id);
    projects.set(key, p);
  }

  const list = [...items.values()]
    .map((i) => {
      const used = round4(i.issued - i.returned);
      return { ...i, issued: round4(i.issued), returned: round4(i.returned), used, value: i.unitCost === null ? null : round2(used * i.unitCost) };
    })
    .filter((i) => i.issued !== 0 || i.returned !== 0)
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.name.localeCompare(b.name));

  const names = new Map(data.projects.map((p) => [p.projectNumber, p.name ?? null]));
  const categories = new Map<string, { value: number; items: number }>();
  for (const i of list) {
    const c = categories.get(i.category) ?? { value: 0, items: 0 };
    c.value += i.value ?? 0;
    c.items++;
    categories.set(i.category, c);
  }
  return {
    from,
    to,
    currency: data.currency ?? 'ZAR',
    items: list,
    byProject: [...projects]
      .map(([projectNumber, p]) => ({ projectNumber, projectName: projectNumber ? names.get(projectNumber) ?? null : null, value: round2(p.value), items: p.materials.size }))
      .sort((a, b) => b.value - a.value),
    byCategory: [...categories].map(([category, c]) => ({ category, value: round2(c.value), items: c.items })).sort((a, b) => b.value - a.value),
    total: { value: round2(list.reduce((a, i) => a + (i.value ?? 0), 0)), items: list.length, unpriced: list.filter((i) => i.value === null).length },
  };
}
