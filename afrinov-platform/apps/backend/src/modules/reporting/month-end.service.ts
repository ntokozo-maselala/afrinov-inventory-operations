// The stock report management receives: the stock workbook's Summary sheets
// (stock on hand, value, % of Required Stock, re-order quantity, URGENCY) and
// its Stock Report sheets (stock used), one per category, for a month or any
// other range of days (a week, say).
//
// Stock is as it stood at the end of the range, rebuilt from the ledger (the
// sum of every movement before midnight after the last day), so a report for a
// past period does not change when stock moves later. The workbook could only
// show "now". Status uses the stock status bands; prices are the
// items' unit prices now, as the workbook's were.
import type { MaterialCategory } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { classifyItem, getStatusBands, type StatusBands, type StockStatus } from '../../shared/inventory/stock-status.js';
import { SettingsService } from '../settings/settings.service.js';
import { onLoanByMaterial } from '../../shared/inventory/tool-loans.js';
import { ConsumptionService, parseRange } from './consumption.service.js';

export interface MonthEndItem {
  sku: string;
  name: string;
  /** Where it was kept at the end of the range, e.g. "A-1" or "A-1 (8), B-2 (3)". */
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
  /** Projects material: its project, null until assigned; null for Stores. */
  project: string | null;
}

/** Projects material per project at the end of the range (materials sections roadmap, Phase 4). */
export interface MonthEndProject {
  /** Null for Projects material with no project yet. */
  projectNumber: string | null;
  name: string | null;
  status: string | null;
  items: number;
  itemsInStock: number;
  value: number;
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
  /** YYYY-MM when the range is exactly one calendar month, otherwise null. */
  month: string | null;
  from: string;
  to: string;
  generatedAt: string;
  currency: string;
  bands: StatusBands;
  categories: MonthEndCategory[];
  /** Projects material per project, completed and cancelled projects included. */
  projects: MonthEndProject[];
  total: { items: number; itemsInStock: number; value: number; urgent: number; warning: number; usedValue: number };
}

const CATEGORY_ORDER: MaterialCategory[] = ['CONSUMABLES', 'FASTENERS_SLUGS_INSULATION', 'TOOLING_PPE_ELECTRICAL', 'PROJECT_MATERIAL', 'TOOLS'];
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** The holder of Stores stock: no project. */
const STORES = '';
interface Place { location: string; quantity: number }

/** An item's places for the given holders, one per location, most first. */
function placesOf(byHolder: Map<string, Place[]> | undefined, holders: string[]): Place[] {
  const at = new Map<string, number>();
  for (const h of holders) for (const p of byHolder?.get(h) ?? []) at.set(p.location, (at.get(p.location) ?? 0) + p.quantity);
  return [...at].map(([location, quantity]) => ({ location, quantity })).filter((p) => p.quantity !== 0).sort((a, b) => b.quantity - a.quantity);
}

/** Where it was kept, e.g. "A-1" or "A-1 (8), B-2 (3)"; '' when nowhere. */
function whereKept(places: Place[]): string {
  if (places.length === 0) return '';
  return places.length === 1 ? places[0]!.location : places.map((r) => `${r.location} (${round4(r.quantity)})`).join(', ');
}

/**
 * Return inclusive YYYY-MM-DD bounds and the exclusive UTC midnight after a month.
 * The current month is allowed and still returns the full month's bounds.
 * Years 0000–0099 follow Date.UTC's mapping to 1900–1999.
 * @param month - Month in YYYY-MM format.
 * @param now - Reference date whose UTC month is the latest allowed month.
 * @throws {ApiError} VALIDATION_ERROR (400) for malformed or future months.
 */
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

export interface StockReportQuery { month?: string; from?: string; to?: string }

/** The calendar month a range covers exactly, as YYYY-MM, or null. */
export function wholeMonth(from: string, to: string): string | null {
  if (!from.endsWith('-01') || from.slice(0, 7) !== to.slice(0, 7)) return null;
  const [y, m] = from.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) === to ? from.slice(0, 7) : null;
}

/**
 * Resolve the report's days: ?from and ?to (YYYY-MM-DD, both included) when
 * either is given, else ?month, else this UTC month. The last day may be in the
 * future (stock is then as it stands now); the first may not.
 * @param now - Reference date for "this month" and the future check.
 * @throws {ApiError} VALIDATION_ERROR (400) for malformed, reversed or future ranges.
 */
export function reportRange(q: StockReportQuery, now = new Date()): { month: string | null; from: string; to: string; end: Date } {
  if (!q.from && !q.to) {
    const month = q.month || now.toISOString().slice(0, 7);
    return { month, ...monthRange(month, now) };
  }
  if (!q.from || !q.to) throw Errors.validation('Give both a start and an end date');
  const { from, to, start, end } = parseRange(q.from, q.to);
  // Date rolls 2026-02-30 over to 2 March; refuse days that do not exist.
  if (start.toISOString().slice(0, 10) !== from || new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10) !== to) {
    throw Errors.validation('Invalid date');
  }
  if (from > now.toISOString().slice(0, 10)) throw Errors.validation('That period has not started yet');
  return { month: wholeMonth(from, to), from, to, end };
}

export const MonthEndService = {
  /**
   * Read stock before UTC midnight after the last day and usage within the range,
   * grouped by category with totals. Includes active items and inactive items
   * with a nonzero balance at any location; empty categories are omitted.
   * Prices, item details, required stock, and status bands are current values.
   * Usage is issued minus returned, excluding reversed movements and reversals;
   * its locations describe holdings at the end, not where stock was issued.
   * Unpriced values are null and contribute zero to totals. Stock ratios are
   * fractions (0.11 = 11%); reorder quantities may be negative when overstocked.
   * Settings read failures fall back to catalog defaults.
   * @param q - A month or a from/to range, resolved by reportRange.
   * @throws {ApiError} For invalid or future ranges.
   * @throws Propagates inventory, material, location, and consumption read failures.
   */
  async report(q: StockReportQuery): Promise<MonthEndReport> {
    const { month, from, to, end } = reportRange(q);
    const [balances, materials, bands, currency, consumption] = await Promise.all([
      prisma.inventoryTransaction.groupBy({ by: ['materialId', 'locationId', 'heldForProject'], where: { postedAt: { lt: end } }, _sum: { quantity: true } }),
      prisma.material.findMany({ select: { id: true, sku: true, name: true, category: true, requiredStock: true, unitCost: true, active: true, projectNumber: true, project: { select: { name: true, status: true } } } }),
      getStatusBands(),
      SettingsService.getValue<string>('general.defaultCurrency'),
      ConsumptionService.report({ from, to }),
    ]);
    // Tools out on loan at the end are still owned, so they count towards Required Stock.
    const onLoan = await onLoanByMaterial(prisma, undefined, new Date(end.getTime() - 1));
    const locationNames = new Map(
      (await prisma.location.findMany({ where: { id: { in: [...new Set(balances.map((b) => b.locationId))] } }, select: { id: true, name: true } }))
        .map((l) => [l.id, l.name]),
    );

    // Stock at the end per item, then per holder: '' for Stores, else the
    // project it is held for (Project Material Through the Store Roadmap).
    const held = new Map<string, Map<string, Place[]>>();
    for (const b of balances) {
      const q = Number(b._sum.quantity ?? 0);
      if (q === 0) continue;
      const holders = held.get(b.materialId) ?? new Map<string, Place[]>();
      const holder = b.heldForProject ?? STORES;
      holders.set(holder, [...(holders.get(holder) ?? []), { location: locationNames.get(b.locationId) ?? '—', quantity: q }]);
      held.set(b.materialId, holders);
    }
    const holdersOf = (materialId: string) => [...(held.get(materialId)?.keys() ?? [])];
    const skuToId = new Map(materials.map((m) => [m.sku, m.id]));
    type Mat = (typeof materials)[number];

    /** One report line: the item's stock with the given holders, for the given project. */
    const itemOf = (m: Mat, holders: string[], project: string | null): MonthEndItem => {
      const places = placesOf(held.get(m.id), holders);
      const current = round4(places.reduce((a, r) => a + r.quantity, 0));
      const required = Number(m.requiredStock);
      const unitCost = m.unitCost === null ? null : Number(m.unitCost);
      // Current Stock is what is on the shelf; a tool out on loan (Stores stock) still counts as owned.
      const owned = round4(current + (holders.includes(STORES) ? Number(onLoan.get(m.id) ?? 0) : 0));
      const s = classifyItem(owned, required, bands);
      return {
        sku: m.sku,
        name: m.name,
        location: whereKept(places),
        requiredStock: required,
        currentStock: current,
        unitCost,
        value: unitCost === null ? null : round2(current * unitCost),
        percentOfRequired: s.percentOfRequired === null ? null : round4(owned / required),
        reorderQuantity: required > 0 ? round4(required - owned) : null,
        status: s.status,
        project,
      };
    };

    const categories: MonthEndCategory[] = [];
    for (const category of CATEGORY_ORDER) {
      let items: MonthEndItem[];
      if (category !== 'PROJECT_MATERIAL') {
        // Stores stock only: stock held for a project is not the store's to
        // issue, so it stays out of status and re-order. Active items, and any
        // inactive one that still had Stores stock at the end.
        items = materials
          .filter((m) => m.category === category && (m.active || holdersOf(m.id).includes(STORES)))
          .sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }))
          .map((m) => itemOf(m, [STORES], m.projectNumber));
      } else {
        // What each project holds: a line per item and project. Stock held for
        // a project is that project's, whatever the item is tagged to (and an
        // older RFQ may have bought a Stores item for one); stock left in the
        // store before keeps the item's own project.
        items = [];
        for (const m of materials) {
          const byProject = new Map<string, string[]>();
          for (const h of holdersOf(m.id)) {
            if (h === STORES && m.category !== 'PROJECT_MATERIAL') continue;
            const project = h || (m.projectNumber ?? '');
            byProject.set(project, [...(byProject.get(project) ?? []), h]);
          }
          if (byProject.size === 0 && m.category === 'PROJECT_MATERIAL' && m.active) byProject.set(m.projectNumber ?? '', [STORES]);
          for (const [project, holders] of byProject) items.push(itemOf(m, holders, project || null));
        }
        // Project by project, those with no project last.
        items.sort((a, b) => (a.project ?? '￿').localeCompare(b.project ?? '￿')
          || a.sku.localeCompare(b.sku, undefined, { numeric: true }));
      }
      const used = consumption.items
        .filter((i) => i.category === category)
        .map((i) => {
          const id = skuToId.get(i.sku) ?? '';
          return { sku: i.sku, name: i.name, location: whereKept(placesOf(held.get(id), holdersOf(id))), used: i.used, value: i.value };
        })
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

    // Projects material per project, from the Project Material lines.
    const projects = new Map<string, MonthEndProject>();
    const projectItems = categories.find((c) => c.category === 'PROJECT_MATERIAL')?.items ?? [];
    // Names from the items' own projects; a project stock is held for that no
    // item is tagged to is looked up.
    const projectInfo = new Map<string, { name: string | null; status: string }>();
    for (const m of materials) if (m.projectNumber && m.project) projectInfo.set(m.projectNumber, m.project);
    const unnamed = [...new Set(projectItems.flatMap((i) => (i.project && !projectInfo.has(i.project) ? [i.project] : [])))];
    if (unnamed.length > 0) {
      for (const p of await prisma.project.findMany({ where: { projectNumber: { in: unnamed } }, select: { projectNumber: true, name: true, status: true } })) {
        projectInfo.set(p.projectNumber, p);
      }
    }
    for (const i of projectItems) {
      const key = i.project ?? '';
      const info = i.project ? projectInfo.get(i.project) : undefined;
      const p = projects.get(key) ?? { projectNumber: i.project, name: info?.name ?? null, status: info?.status ?? null, items: 0, itemsInStock: 0, value: 0 };
      p.items++;
      if (i.currentStock > 0) p.itemsInStock++;
      p.value = round2(p.value + (i.value ?? 0));
      projects.set(key, p);
    }

    return {
      month,
      from,
      to,
      generatedAt: new Date().toISOString(),
      currency,
      bands,
      categories,
      projects: [...projects.values()].sort((a, b) => (a.projectNumber === null ? 1 : b.projectNumber === null ? -1 : a.projectNumber.localeCompare(b.projectNumber))),
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
