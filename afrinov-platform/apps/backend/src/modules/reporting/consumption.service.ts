// Consumption: what the store used in a date range, by item, project,
// recipient and category, at the item's unit price. It replaces the workbook's Stock Report
// sheets ("Used Stock Inventory": quantity out × unit price), which could only
// show the whole period since the last rollover and never by project.
//
// Used = issued − returned. A reversed issue or return is left out together
// with its reversal, so a correction posted in a later month does not show as
// negative use there. Values use the item's unit price now: the platform keeps
// one price per item, as the workbook did.
//
// Items that track use after issue (discs, blades, bits) also say what became
// of what was issued: used up, broken, or still out with the person. That is
// worked out as of now, for the issues in the period, whenever they came back.
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { SettingsService } from '../settings/settings.service.js';
import { closedOffAgainst } from '../inventory/consumable-outcomes.js';

export interface ConsumptionQuery {
  /** First day, YYYY-MM-DD. */
  from: string;
  /** Last day, YYYY-MM-DD, included. */
  to: string;
  /** A project number; '__none__' for issues with no project. */
  projectNumber?: string;
  category?: string;
  /** A recipient id; '__none__' for issues recorded before Issued To was required. */
  recipientId?: string;
}

/** One issue or return, for the issues-to-one-recipient list (the workbook's Consumable Box). */
export interface ConsumptionLine {
  id: string;
  postedAt: string;
  type: 'ISSUE' | 'RETURN';
  sku: string;
  name: string;
  unitOfMeasure: string;
  /** Positive: issued to them; negative: returned. */
  quantity: number;
  projectNumber: string | null;
  issuedBy: string;
  /** Issues of items that track use: marked used up or broken so far, and still out now. Null otherwise. */
  usedUp: number | null;
  broken: number | null;
  stillOut: number | null;
}

export interface ConsumptionItem {
  materialId: string;
  sku: string;
  name: string;
  category: string;
  unitOfMeasure: string;
  issued: number;
  returned: number;
  /** issued − returned. */
  used: number;
  unitCost: number | null;
  /** used × unit price; null when the item has no price. */
  value: number | null;
}

export interface ConsumptionReport {
  from: string;
  to: string;
  currency: string;
  items: ConsumptionItem[];
  byProject: Array<{ projectNumber: string | null; projectName: string | null; value: number; items: number }>;
  /** usedUp, broken and stillOut: quantities of items that track use, as of now. */
  byRecipient: Array<{
    recipientId: string | null; name: string | null; type: string | null; value: number; items: number; issues: number;
    usedUp: number; broken: number; stillOut: number;
  }>;
  /** Each issue and return, newest first; only when one recipient is asked for. */
  lines?: ConsumptionLine[];
  byCategory: Array<{ category: string; value: number; items: number }>;
  total: { value: number; items: number; unpriced: number };
}

export const NO_PROJECT = '__none__';
export const NO_RECIPIENT = '__none__';
const MAX_LINES = 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** This month, as the default range. */
export function defaultRange(now = new Date()): { from: string; to: string } {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export function parseRange(from: string | undefined, to: string | undefined): { from: string; to: string; start: Date; end: Date } {
  const d = defaultRange();
  const f = from || d.from;
  const t = to || d.to;
  if (!DAY.test(f) || !DAY.test(t)) throw Errors.validation('Dates must be YYYY-MM-DD');
  const start = new Date(`${f}T00:00:00.000Z`);
  const end = new Date(`${t}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw Errors.validation('Invalid date');
  if (start > end) throw Errors.validation('The start date is after the end date');
  end.setUTCDate(end.getUTCDate() + 1); // the last day is included
  return { from: f, to: t, start, end };
}

export const ConsumptionService = {
  async report(q: ConsumptionQuery): Promise<ConsumptionReport> {
    const { from, to, start, end } = parseRange(q.from, q.to);
    const where: Prisma.InventoryTransactionWhereInput = {
      type: { in: ['ISSUE', 'RETURN'] },
      postedAt: { gte: start, lt: end },
      reversesId: null,
      reversedBy: null,
    };
    if (q.projectNumber === NO_PROJECT) where.projectNumber = null;
    else if (q.projectNumber) where.projectNumber = q.projectNumber;
    if (q.category) where.material = { category: q.category as Prisma.MaterialWhereInput['category'] };
    if (q.recipientId === NO_RECIPIENT) where.recipientId = null;
    else if (q.recipientId) where.recipientId = q.recipientId;

    const rows = await prisma.inventoryTransaction.findMany({
      where,
      select: {
        id: true, postedAt: true, type: true, quantity: true, projectNumber: true, materialId: true, recipientId: true,
        material: { select: { sku: true, name: true, category: true, unitOfMeasure: true, unitCost: true, trackUse: true } },
        recipient: { select: { name: true, type: true } },
        actor: { select: { name: true } },
      },
      orderBy: { postedAt: 'desc' },
    });

    // Issues of items that track use, and of items switched off since that were
    // marked before (those marks still count): what came back, at any time, and
    // what was closed off.
    const issueIds = rows.filter((t) => t.type === 'ISSUE').map((t) => t.id);
    const closed = issueIds.length === 0 ? new Map() : await closedOffAgainst(prisma, issueIds);
    const tracked = rows.filter((t) => t.type === 'ISSUE' && (t.material.trackUse || closed.has(t.id)));
    const trackedIds = tracked.map((t) => t.id);
    const returnedRows = trackedIds.length === 0 ? [] : await prisma.inventoryTransaction.groupBy({
      by: ['referenceId'],
      where: { type: 'RETURN', referenceType: 'Return', referenceId: { in: trackedIds } },
      _sum: { quantity: true },
    });
    const returnedByIssue = new Map(returnedRows.map((r) => [r.referenceId, r._sum.quantity?.toNumber() ?? 0]));
    const use = new Map(tracked.map((t) => {
      const c = closed.get(t.id);
      const usedUp = c?.usedUp.toNumber() ?? 0;
      const broken = c?.broken.toNumber() ?? 0;
      return [t.id, { usedUp, broken, stillOut: round4(-t.quantity.toNumber() - (returnedByIssue.get(t.id) ?? 0) - usedUp - broken) }];
    }));

    const items = new Map<string, ConsumptionItem>();
    const projects = new Map<string | null, { value: number; materials: Set<string> }>();
    const recipients = new Map<string | null, {
      name: string | null; type: string | null; value: number; materials: Set<string>; issues: number; usedUp: number; broken: number; stillOut: number;
    }>();
    for (const t of rows) {
      const qty = t.quantity.toNumber();
      const item = items.get(t.materialId) ?? {
        materialId: t.materialId,
        sku: t.material.sku,
        name: t.material.name,
        category: t.material.category,
        unitOfMeasure: t.material.unitOfMeasure,
        issued: 0,
        returned: 0,
        used: 0,
        unitCost: t.material.unitCost === null ? null : t.material.unitCost.toNumber(),
        value: null,
      };
      if (t.type === 'ISSUE') item.issued -= qty; // issues are negative in the ledger
      else item.returned += qty;
      items.set(t.materialId, item);

      const p = projects.get(t.projectNumber) ?? { value: 0, materials: new Set<string>() };
      p.value += -qty * (item.unitCost ?? 0); // an issue adds value used, a return takes it off
      p.materials.add(t.materialId);
      projects.set(t.projectNumber, p);

      const r = recipients.get(t.recipientId) ?? {
        name: t.recipient?.name ?? null, type: t.recipient?.type ?? null, value: 0, materials: new Set<string>(), issues: 0, usedUp: 0, broken: 0, stillOut: 0,
      };
      r.value += -qty * (item.unitCost ?? 0);
      r.materials.add(t.materialId);
      if (t.type === 'ISSUE') r.issues++;
      const u = use.get(t.id);
      if (u) {
        r.usedUp += u.usedUp;
        r.broken += u.broken;
        r.stillOut += u.stillOut;
      }
      recipients.set(t.recipientId, r);
    }

    const list = [...items.values()]
      .map((i) => {
        const used = round4(i.issued - i.returned);
        return { ...i, issued: round4(i.issued), returned: round4(i.returned), used, value: i.unitCost === null ? null : round2(used * i.unitCost) };
      })
      .filter((i) => i.issued !== 0 || i.returned !== 0)
      .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.name.localeCompare(b.name));

    const names = new Map(
      (await prisma.project.findMany({
        where: { projectNumber: { in: [...projects.keys()].filter((k): k is string => k !== null) } },
        select: { projectNumber: true, name: true },
      })).map((p) => [p.projectNumber, p.name]),
    );
    const byProject = [...projects]
      .map(([projectNumber, p]) => ({
        projectNumber,
        projectName: projectNumber ? names.get(projectNumber) ?? null : null,
        value: round2(p.value),
        items: p.materials.size,
      }))
      .sort((a, b) => b.value - a.value);

    const byRecipient = [...recipients]
      .map(([recipientId, r]) => ({
        recipientId, name: r.name, type: r.type, value: round2(r.value), items: r.materials.size, issues: r.issues,
        usedUp: round4(r.usedUp), broken: round4(r.broken), stillOut: round4(r.stillOut),
      }))
      .sort((a, b) => b.value - a.value || (a.name ?? '').localeCompare(b.name ?? ''));

    const lines: ConsumptionLine[] | undefined = q.recipientId
      ? rows.slice(0, MAX_LINES).map((t) => ({
        id: t.id,
        postedAt: t.postedAt.toISOString(),
        type: t.type as 'ISSUE' | 'RETURN',
        sku: t.material.sku,
        name: t.material.name,
        unitOfMeasure: t.material.unitOfMeasure,
        quantity: round4(-t.quantity.toNumber()),
        projectNumber: t.projectNumber,
        issuedBy: t.actor.name,
        usedUp: use.get(t.id)?.usedUp ?? null,
        broken: use.get(t.id)?.broken ?? null,
        stillOut: use.get(t.id)?.stillOut ?? null,
      }))
      : undefined;

    const categories = new Map<string, { value: number; items: number }>();
    for (const i of list) {
      const c = categories.get(i.category) ?? { value: 0, items: 0 };
      c.value += i.value ?? 0;
      c.items++;
      categories.set(i.category, c);
    }
    const byCategory = [...categories].map(([category, c]) => ({ category, value: round2(c.value), items: c.items })).sort((a, b) => b.value - a.value);

    return {
      from,
      to,
      currency: await SettingsService.getValue<string>('general.defaultCurrency'),
      items: list,
      byProject,
      byRecipient,
      ...(lines ? { lines } : {}),
      byCategory,
      total: {
        value: round2(list.reduce((a, i) => a + (i.value ?? 0), 0)),
        items: list.length,
        unpriced: list.filter((i) => i.value === null).length,
      },
    };
  },
};
