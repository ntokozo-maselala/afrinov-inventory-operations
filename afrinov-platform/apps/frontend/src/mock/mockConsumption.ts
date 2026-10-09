// Mirrors ConsumptionService.report (apps/backend/src/modules/reporting/
// consumption.service.ts) for frontend-only mode: issued less returned per
// item in a date range, valued at unit price, by project, recipient and category, with
// reversed issues and returns left out together with their reversals.
import type { ApiError } from '../api/client';
import type { MockInventoryTransaction, MockMaterial, MockProject, MockRecipient } from './types';
import { NO_PROJECT, NO_RECIPIENT, type ConsumptionItem, type ConsumptionLine, type ConsumptionReport } from '../api/reportTypes';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const fail = (message: string): ApiError => ({ code: 'VALIDATION_ERROR', message });

export function computeConsumption(
  qs: Record<string, string>,
  data: {
    transactions: MockInventoryTransaction[]; materials: MockMaterial[]; projects: MockProject[]; currency?: string;
    recipients?: MockRecipient[]; userName?: (id: string) => string;
  },
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
  const recipientsById = new Map((data.recipients ?? []).map((r) => [r.id, r]));
  const recipients = new Map<string | null, { value: number; materials: Set<string>; issues: number }>();
  const lines: ConsumptionLine[] = [];

  for (const t of data.transactions) {
    if (t.type !== 'ISSUE' && t.type !== 'RETURN') continue;
    if (t.reversesId || reversed.has(t.id)) continue;
    if (t.postedAt < start || t.postedAt >= end.toISOString()) continue;
    if (qs.projectNumber === NO_PROJECT ? t.projectNumber : qs.projectNumber && t.projectNumber !== qs.projectNumber) continue;
    if (qs.recipientId === NO_RECIPIENT ? t.recipientId : qs.recipientId && t.recipientId !== qs.recipientId) continue;
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

    const rKey = t.recipientId ?? null;
    const r = recipients.get(rKey) ?? { value: 0, materials: new Set<string>(), issues: 0 };
    r.value += -qty * (unitCost ?? 0);
    r.materials.add(m.id);
    if (t.type === 'ISSUE') r.issues++;
    recipients.set(rKey, r);
    lines.push({
      id: t.id, postedAt: t.postedAt, type: t.type, sku: m.sku, name: m.name, unitOfMeasure: m.unitOfMeasure,
      quantity: round4(-qty), projectNumber: t.projectNumber ?? null, issuedBy: data.userName?.(t.actorId) ?? 'Unknown',
    });
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
    byRecipient: [...recipients]
      .map(([recipientId, r]) => {
        const who = recipientId ? recipientsById.get(recipientId) : undefined;
        return { recipientId, name: who?.name ?? null, type: who?.type ?? null, value: round2(r.value), items: r.materials.size, issues: r.issues };
      })
      .sort((a, b) => b.value - a.value || (a.name ?? '').localeCompare(b.name ?? '')),
    ...(qs.recipientId ? { lines: lines.sort((a, b) => b.postedAt.localeCompare(a.postedAt)).slice(0, 1000) } : {}),
    byCategory: [...categories].map(([category, c]) => ({ category, value: round2(c.value), items: c.items })).sort((a, b) => b.value - a.value),
    total: { value: round2(list.reduce((a, i) => a + (i.value ?? 0), 0)), items: list.length, unpriced: list.filter((i) => i.value === null).length },
  };
}
