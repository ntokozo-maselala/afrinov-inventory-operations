// What the catalogue holds, and how Stock and Tools count it (ADR-031). Each of
// those pages counts something different: Materials counts items, Stock counts
// lines (an item at a location, so an item in two places is two lines), and
// Tools counts its active tools. Their totals can't be added up, so this is the
// one place that says how they relate: GET /materials/summary and
// check:catalogue both read it.
//
// The tabs split the catalogue so they add up to it: a tool is in the Stores
// section, as ever, for orders and stock rules, but has a tab of its own.
import type { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { PROJECTS_CATEGORY } from './material-section.js';

export type CatalogueTab = 'STORES' | 'TOOLS' | 'PROJECTS';

const TOOLS_CATEGORY = 'TOOLS';

export function catalogueTabOf(category: string): CatalogueTab {
  if (category === PROJECTS_CATEGORY) return 'PROJECTS';
  return category === TOOLS_CATEGORY ? 'TOOLS' : 'STORES';
}

/**
 * Where an item stands. IN_STOCK: Stores stock on hand. HELD_FOR_PROJECT: none
 * of that, but stock held for a project. OUT_OF_STOCK: it has stock lines, all
 * at nothing. NEVER_RECEIVED: no stock line at all, so Stock can't list it.
 */
export type StockState = 'IN_STOCK' | 'HELD_FOR_PROJECT' | 'OUT_OF_STOCK' | 'NEVER_RECEIVED';

type StockLine = { quantity: Prisma.Decimal; heldForProject: string };

/** An item's stock state, from all its stock lines. */
export function stockStateOf(lines: StockLine[]): StockState {
  const total = (held: boolean) => lines
    .filter((l) => (l.heldForProject !== '') === held)
    .reduce((sum, l) => sum + Number(l.quantity), 0);
  if (total(false) > 0) return 'IN_STOCK';
  if (total(true) > 0) return 'HELD_FOR_PROJECT';
  return lines.length > 0 ? 'OUT_OF_STOCK' : 'NEVER_RECEIVED';
}

export interface CatalogueSummary {
  /** Every item, active or not. */
  items: number;
  active: number;
  inactive: number;
  /** The Materials tabs. They add up to `items`. */
  tabs: Record<CatalogueTab, number>;
  /** What the Stock page lists: Stores stock of Stores and Tools items. */
  stock: {
    /** One per item at a location, zero quantities included. */
    lines: number;
    /** The different items on those lines. */
    items: number;
    /** How many of those items are tools, which the Tools page lists too. */
    tools: number;
  };
  /** Stores and Tools items with no line on Stock. With `stock.items`, they make up both tabs. */
  notOnStock: { items: number; tools: number };
  /** Stores and Tools items by stock state. */
  states: Record<StockState, number>;
  /** What the Tools page lists: its active tools. */
  toolsListed: number;
}

/** Counts the catalogue from its items and all their stock lines. */
export function summarise(
  items: Array<{ id: string; category: string; active: boolean }>,
  lines: Array<StockLine & { materialId: string }>,
): CatalogueSummary {
  const tabs: Record<CatalogueTab, number> = { STORES: 0, TOOLS: 0, PROJECTS: 0 };
  for (const item of items) tabs[catalogueTabOf(item.category)] += 1;

  const byItem = new Map<string, StockLine[]>();
  for (const line of lines) byItem.set(line.materialId, [...(byItem.get(line.materialId) ?? []), line]);

  const states: Record<StockState, number> = { IN_STOCK: 0, HELD_FOR_PROJECT: 0, OUT_OF_STOCK: 0, NEVER_RECEIVED: 0 };
  const stock = { lines: 0, items: 0, tools: 0 };
  const notOnStock = { items: 0, tools: 0 };
  for (const item of items) {
    const tab = catalogueTabOf(item.category);
    if (tab === 'PROJECTS') continue;
    const mine = byItem.get(item.id) ?? [];
    const onStock = mine.filter((l) => l.heldForProject === '').length;
    const tool = tab === 'TOOLS' ? 1 : 0;
    states[stockStateOf(mine)] += 1;
    stock.lines += onStock;
    if (onStock > 0) {
      stock.items += 1;
      stock.tools += tool;
    } else {
      notOnStock.items += 1;
      notOnStock.tools += tool;
    }
  }
  const active = items.filter((i) => i.active).length;

  return {
    items: items.length,
    active,
    inactive: items.length - active,
    tabs,
    stock,
    notOnStock,
    states,
    toolsListed: items.filter((i) => i.category === TOOLS_CATEGORY && i.active).length,
  };
}

export const CatalogueService = {
  async summary(): Promise<CatalogueSummary> {
    const [items, lines] = await Promise.all([
      prisma.material.findMany({ select: { id: true, category: true, active: true } }),
      prisma.inventoryBalance.findMany({ select: { materialId: true, quantity: true, heldForProject: true } }),
    ]);
    return summarise(items, lines);
  },
};
