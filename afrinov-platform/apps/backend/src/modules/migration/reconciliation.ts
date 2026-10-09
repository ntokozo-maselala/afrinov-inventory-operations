// Reconciliation after the import: does the platform hold what the workbook
// said? Per category it compares item count, units and rand value of the
// opening balances the import posted with the plan built from the workbook,
// and lists every item that differs. Opening balances do not change after
// go-live, so the check stays meaningful once normal issues and receipts start;
// current stock is shown alongside for information.
//
// The comparison is pure; loadSnapshot reads the database, read-only.
import type { MaterialCategory } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { CATEGORY_SHEETS } from './workbook-reader.js';
import { CATEGORY_LABEL } from './workbook-analysis.js';
import type { MappedImport } from './mapping.js';
import { OPENING_BALANCE_REFERENCE } from './opening-balance.service.js';

/** What the platform holds for one item. Quantities by location name. */
export interface PlatformItem {
  sku: string;
  category: MaterialCategory;
  unitCost: number | null;
  opening: Record<string, number>;
  current: Record<string, number>;
}

export type DifferenceKind = 'MISSING' | 'CATEGORY' | 'QUANTITY' | 'PRICE' | 'UNEXPECTED_BALANCE';

export interface Difference {
  kind: DifferenceKind;
  sku: string;
  name: string;
  category: MaterialCategory;
  detail: string;
}

export interface CategoryReconciliation {
  category: MaterialCategory;
  items: { workbook: number; platform: number };
  units: { workbook: number; platform: number };
  value: { workbook: number; platform: number };
  /** Value of the stock on hand now, at the platform's prices. */
  currentValue: number;
}

export interface Reconciliation {
  categories: CategoryReconciliation[];
  differences: Difference[];
  importedOn: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
const same = (a: number, b: number) => Math.abs(a - b) < 0.00005;
const money = (n: number | null) => (n === null ? 'no price' : `R${n}`);
const locationKey = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export function reconcile(plan: MappedImport, platform: PlatformItem[], importedOn: string | null = null): Reconciliation {
  const bySku = new Map(platform.map((p) => [p.sku.toUpperCase(), p]));
  const differences: Difference[] = [];
  const totals = new Map<MaterialCategory, CategoryReconciliation>(CATEGORY_SHEETS.map(({ category }) => [category, {
    category,
    items: { workbook: 0, platform: 0 },
    units: { workbook: 0, platform: 0 },
    value: { workbook: 0, platform: 0 },
    currentValue: 0,
  }]));

  for (const m of plan.materials) {
    const t = totals.get(m.category)!;
    const plannedUnits = m.balances.reduce((a, b) => a + b.quantity, 0);
    t.items.workbook++;
    t.units.workbook += plannedUnits;
    t.value.workbook += plannedUnits * (m.unitCost ?? 0);

    const p = bySku.get(m.sku.toUpperCase());
    const diff = (kind: DifferenceKind, detail: string) => differences.push({ kind, sku: m.sku, name: m.name, category: m.category, detail });
    if (!p) { diff('MISSING', 'Not in the platform'); continue; }

    // Counted under the platform's category, so a moved item shows on both sides.
    const pt = totals.get(p.category) ?? t;
    pt.items.platform++;
    pt.units.platform += sum(p.opening);
    pt.value.platform += sum(p.opening) * (p.unitCost ?? 0);
    pt.currentValue += sum(p.current) * (p.unitCost ?? 0);

    if (p.category !== m.category) diff('CATEGORY', `${CATEGORY_LABEL[m.category]} in the workbook, ${CATEGORY_LABEL[p.category]} in the platform`);
    if ((m.unitCost === null) !== (p.unitCost === null) || (m.unitCost !== null && p.unitCost !== null && !same(m.unitCost, p.unitCost))) {
      diff('PRICE', `${money(m.unitCost)} in the workbook, ${money(p.unitCost)} in the platform`);
    }
    // The import reuses a location whatever its case, so names compare the same way.
    const planned = new Map<string, { name: string; qty: number }>();
    for (const b of m.balances) {
      const key = locationKey(b.location);
      planned.set(key, { name: planned.get(key)?.name ?? b.location, qty: (planned.get(key)?.qty ?? 0) + b.quantity });
    }
    const posted = new Map<string, { name: string; qty: number }>();
    for (const [name, qty] of Object.entries(p.opening)) {
      const key = locationKey(name);
      posted.set(key, { name: posted.get(key)?.name ?? name, qty: (posted.get(key)?.qty ?? 0) + qty });
    }
    for (const [key, { name, qty }] of planned) {
      const there = posted.get(key)?.qty ?? 0;
      if (!same(qty, there)) diff('QUANTITY', `${name}: ${round4(qty)} in the workbook, ${round4(there)} opening balance in the platform`);
    }
    for (const [key, { name, qty }] of posted) {
      if (!planned.has(key) && !same(qty, 0)) diff('UNEXPECTED_BALANCE', `${name}: opening balance of ${round4(qty)} that the workbook does not have`);
    }
  }

  const categories = [...totals.values()].map((c) => ({
    ...c,
    units: { workbook: round4(c.units.workbook), platform: round4(c.units.platform) },
    value: { workbook: round2(c.value.workbook), platform: round2(c.value.platform) },
    currentValue: round2(c.currentValue),
  }));
  return { categories, differences, importedOn };
}

/** Reads the platform's side for these SKUs: category, price, opening and current balances. */
export async function loadSnapshot(skus: string[]): Promise<{ items: PlatformItem[]; importedOn: string | null }> {
  const materials = await prisma.material.findMany({
    where: { sku: { in: skus, mode: 'insensitive' } },
    select: {
      id: true, sku: true, category: true, unitCost: true,
      inventoryBalances: { select: { quantity: true, location: { select: { name: true } } } },
    },
  });
  const ids = materials.map((m) => m.id);
  const opening = ids.length === 0 ? [] : await prisma.inventoryTransaction.groupBy({
    by: ['materialId', 'locationId'],
    where: { materialId: { in: ids }, referenceType: OPENING_BALANCE_REFERENCE },
    _sum: { quantity: true },
  });
  const locationIds = [...new Set(opening.map((o) => o.locationId))];
  const locations = new Map((await prisma.location.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]));
  const first = await prisma.inventoryTransaction.findFirst({ where: { referenceType: OPENING_BALANCE_REFERENCE }, select: { postedAt: true } });

  const items = materials.map((m): PlatformItem => {
    const openingHere: Record<string, number> = {};
    for (const o of opening.filter((x) => x.materialId === m.id)) {
      const name = locations.get(o.locationId) ?? o.locationId;
      openingHere[name] = (openingHere[name] ?? 0) + Number(o._sum.quantity ?? 0);
    }
    const current: Record<string, number> = {};
    for (const b of m.inventoryBalances) current[b.location.name] = (current[b.location.name] ?? 0) + Number(b.quantity);
    return { sku: m.sku, category: m.category, unitCost: m.unitCost === null ? null : Number(m.unitCost), opening: openingHere, current };
  });
  return { items, importedOn: first ? first.postedAt.toISOString().slice(0, 10) : null };
}

const DIFFERENCE_TITLE: Record<DifferenceKind, string> = {
  MISSING: 'Items not in the platform',
  CATEGORY: 'Items in another category',
  QUANTITY: 'Opening quantities that differ',
  PRICE: 'Unit prices that differ',
  UNEXPECTED_BALANCE: 'Opening balances the workbook does not have',
};

const rand = (n: number) => `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cell = (s: string) => s.replace(/\|/g, '\\|');

export function renderReconciliation(r: Reconciliation, meta: { file: string; database: string; generatedAt: Date }): string {
  const out: string[] = [];
  out.push('# Workbook import: reconciliation', '');
  out.push(`Workbook: \`${meta.file}\`  `);
  out.push(`Database: \`${meta.database}\`  `);
  out.push(`Run at: ${meta.generatedAt.toISOString()}  `);
  out.push(r.importedOn ? `Opening balances dated ${r.importedOn}.` : '**No opening balances have been imported into this database.**', '');
  out.push(r.differences.length === 0
    ? '**Reconciled: every item, unit and rand matches the workbook.**'
    : `**${r.differences.length} differences** between the workbook and the platform; listed below.`, '');

  out.push('## Per category', '');
  out.push('| Category | Items: workbook | Items: platform | Units: workbook | Units: platform | Value: workbook | Value: platform | Difference | Value on hand now |');
  out.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  const all = { iw: 0, ip: 0, vw: 0, vp: 0, now: 0 };
  for (const c of r.categories) {
    if (c.items.workbook === 0 && c.items.platform === 0) continue;
    out.push(`| ${CATEGORY_LABEL[c.category]} | ${c.items.workbook} | ${c.items.platform} | ${c.units.workbook} | ${c.units.platform} | ${rand(c.value.workbook)} | ${rand(c.value.platform)} | ${rand(round2(c.value.platform - c.value.workbook))} | ${rand(c.currentValue)} |`);
    all.iw += c.items.workbook; all.ip += c.items.platform; all.vw += c.value.workbook; all.vp += c.value.platform; all.now += c.currentValue;
  }
  out.push(`| **All** | **${all.iw}** | **${all.ip}** | | | **${rand(round2(all.vw))}** | **${rand(round2(all.vp))}** | **${rand(round2(all.vp - all.vw))}** | **${rand(round2(all.now))}** |`, '');
  out.push('- **Workbook** is what the dry run planned from the workbook and the mapping file: negative stock as 0, prices as matched.');
  out.push('- **Platform** is the opening balances the import posted, at the prices the items have in the platform now.');
  out.push('- **Value on hand now** is today\'s stock at those prices, so it moves as stock is issued and received after go-live.', '');

  for (const kind of Object.keys(DIFFERENCE_TITLE) as DifferenceKind[]) {
    const list = r.differences.filter((d) => d.kind === kind);
    if (list.length === 0) continue;
    out.push(`## ${DIFFERENCE_TITLE[kind]} (${list.length})`, '');
    out.push('| SKU | Item | Category | Detail |', '| --- | --- | --- | --- |');
    for (const d of list) out.push(`| ${cell(d.sku)} | ${cell(d.name)} | ${CATEGORY_LABEL[d.category]} | ${cell(d.detail)} |`);
    out.push('');
  }
  return out.join('\n');
}
