// The month-end report management receives: the stock workbook's Summary
// sheets (stock on hand, value, % of Required Stock, re-order quantity,
// URGENCY) and its Stock Report sheets (stock used), one per category.
//
// Stock is as it stood at the end of the month, rebuilt from the ledger (the
// sum of every movement before midnight on the first of the next month), so a
// report for a past month does not change when stock moves later. The workbook
// could only show "now". Status uses the stock status bands; prices are the
// items' unit prices now, as the workbook's were.
import type { MaterialCategory } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { classifyItem, getStatusBands, type StatusBands, type StockStatus } from '../../shared/inventory/stock-status.js';
import { SettingsService } from '../settings/settings.service.js';
import { ConsumptionService } from './consumption.service.js';

export interface MonthEndItem {
  sku: string;
  name: string;
  /** Where it was kept at month end, e.g. "A-1" or "A-1 (8), B-2 (3)". */
  location: string;
  requiredStock: number;
  currentStock: number;
  unitCost: number | null;
  /** Current stock × unit price; null without a price. */
  value: number | null;
  /** Current stock as a fraction of Required Stock (0.11 = 11%); null when Required Stock is not set. */
  percentOfRequired: number | null;
  /** Required Stock − current stock, as the workbook shows it (negative when over); null when not set. */
  reorderQuantity: number | null;
  status: StockStatus;
}

export interface MonthEndUsed { sku: string; name: string; location: string; used: number; value: number | null }

export interface MonthEndCategory {
  category: MaterialCategory;
  items: MonthEndItem[];
  value: number;
  urgent: number;
  warning: number;
  itemsInStock: number;
  used: MonthEndUsed[];
  usedValue: number;
}

export interface MonthEndReport {
  month: string;
  from: string;
  to: string;
  generatedAt: string;
  currency: string;
  bands: StatusBands;
  categories: MonthEndCategory[];
  total: { items: number; itemsInStock: number; value: number; urgent: number; warning: number; usedValue: number };
}

const CATEGORY_ORDER: MaterialCategory[] = ['CONSUMABLES', 'FASTENERS_SLUGS_INSULATION', 'TOOLING_PPE_ELECTRICAL', 'PROJECT_MATERIAL', 'TOOLS'];
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** The month's first and last day, and midnight after it. Not a future month. */
export function monthRange(month: string, now = new Date()): { from: string; to: string; end: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw Errors.validation('Month must be YYYY-MM');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) throw Errors.validation('Month must be YYYY-MM');
  if (y * 12 + mo > now.getUTCFullYear() * 12 + now.getUTCMonth() + 1) throw Errors.validation('That month has not started yet');
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const last = new Date(Date.UTC(y, mo, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), end: new Date(Date.UTC(y, mo, 1)) };
}

export const MonthEndService = {
  async report(month: string): Promise<MonthEndReport> {
    const { from, to, end } = monthRange(month);
    const [balances, materials, bands, currency, consumption] = await Promise.all([
      prisma.inventoryTransaction.groupBy({ by: ['materialId', 'locationId'], where: { postedAt: { lt: end } }, _sum: { quantity: true } }),
      prisma.material.findMany({ select: { id: true, sku: true, name: true, category: true, requiredStock: true, unitCost: true, active: true } }),
      getStatusBands(),
      SettingsService.getValue<string>('general.defaultCurrency'),
      ConsumptionService.report({ from, to }),
    ]);
    const locationNames = new Map(
      (await prisma.location.findMany({ where: { id: { in: [...new Set(balances.map((b) => b.locationId))] } }, select: { id: true, name: true } }))
        .map((l) => [l.id, l.name]),
    );

    const held = new Map<string, Array<{ location: string; quantity: number }>>();
    for (const b of balances) {
      const q = Number(b._sum.quantity ?? 0);
      if (q === 0) continue;
      held.set(b.materialId, [...(held.get(b.materialId) ?? []), { location: locationNames.get(b.locationId) ?? '—', quantity: q }]);
    }
    const whereKept = (materialId: string) => {
      const rows = (held.get(materialId) ?? []).sort((a, b) => b.quantity - a.quantity);
      if (rows.length === 0) return '';
      return rows.length === 1 ? rows[0]!.location : rows.map((r) => `${r.location} (${round4(r.quantity)})`).join(', ');
    };
    const skuToId = new Map(materials.map((m) => [m.sku, m.id]));

    const categories: MonthEndCategory[] = [];
    for (const category of CATEGORY_ORDER) {
      // Active items, and any inactive one that still had stock at month end.
      const mine = materials
        .filter((m) => m.category === category && (m.active || held.has(m.id)))
        .sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));
      const items: MonthEndItem[] = mine.map((m) => {
        const current = round4((held.get(m.id) ?? []).reduce((a, r) => a + r.quantity, 0));
        const required = Number(m.requiredStock);
        const unitCost = m.unitCost === null ? null : Number(m.unitCost);
        const s = classifyItem(current, required, bands);
        return {
          sku: m.sku,
          name: m.name,
          location: whereKept(m.id),
          requiredStock: required,
          currentStock: current,
          unitCost,
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
        category,
        items,
        value: round2(items.reduce((a, i) => a + (i.value ?? 0), 0)),
        urgent: items.filter((i) => i.status === 'URGENT').length,
        warning: items.filter((i) => i.status === 'WARNING').length,
        itemsInStock: items.filter((i) => i.currentStock > 0).length,
        used,
        usedValue: round2(used.reduce((a, u) => a + (u.value ?? 0), 0)),
      });
    }

    return {
      month,
      from,
      to,
      generatedAt: new Date().toISOString(),
      currency,
      bands,
      categories,
      total: {
        items: categories.reduce((a, c) => a + c.items.length, 0),
        itemsInStock: categories.reduce((a, c) => a + c.itemsInStock, 0),
        value: round2(categories.reduce((a, c) => a + c.value, 0)),
        urgent: categories.reduce((a, c) => a + c.urgent, 0),
        warning: categories.reduce((a, c) => a + c.warning, 0),
        usedValue: round2(categories.reduce((a, c) => a + c.usedValue, 0)),
      },
    };
  },
};
