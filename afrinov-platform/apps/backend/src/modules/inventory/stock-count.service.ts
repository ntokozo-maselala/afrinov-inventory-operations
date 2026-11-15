// Stock count by location: the storeman counts what is on the shelves and the
// differences from the system are posted as COUNT_VARIANCE adjustments, all
// linked to one count. Used for the go-live count and for counts after it.
//
// The count is checked against the quantities the counter was shown, or, on a
// blind sheet (inventory.blindCounts), against when the sheet was opened. A line
// whose stock moved while counting (an issue at the counter, a receipt) is held
// back for a recount and the rest post (system audit C4, C7, ADR-040). A count
// is of Stores stock or of one project's (C6), and Full or Spot (C5): a full
// count lists every item with stock there, one not found counted as 0.
import { randomUUID } from 'node:crypto';
import { AdjustmentReasonCode, InventoryTransactionType, Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { inTx } from '../../shared/tx.js';
import { Errors } from '../../shared/errors.js';
import { toDecimal, fitsQuantityColumn } from '../../shared/decimal.js';
import { recentWriteOffQuantity, writeOffRule } from './write-off-limit.js';
import { requestAdjustment } from './write-off-requests.js';
import { checkWholeUnits } from '../../shared/units.js';
import { getCurrentBalance, recomputeBalance, lockInventoryBalances } from '../../shared/inventory/balances.js';
import { dispatchDomainEvents, type DomainEvent } from '../../shared/events.js';
import { dayRange, pageCursor, parseCursor } from '../../shared/dates.js';
import { checkMaterialActive } from './inventory.service.js';
import { SettingsService } from '../settings/settings.service.js';

/** When on, the count sheet shows no book figures (system audit C4). */
export const BLIND_COUNTS = 'inventory.blindCounts';
export const COUNT_KINDS = ['FULL', 'SPOT'] as const;
export type CountKind = (typeof COUNT_KINDS)[number];

export interface CountSheet {
  locationId: string;
  locationName: string;
  heldForProject: string | null;
  blind: boolean;
  /** When the sheet was opened, by the database's clock: sent back with the count. */
  openedAt: string;
  /** The projects with stock held for them here, whose stock can be counted too. */
  projects: string[];
  lines: Array<{ materialId: string; sku: string; name: string; unitOfMeasure: string; category: string; active: boolean; expected: string | null }>;
}

export const STOCK_COUNT_REFERENCE = 'StockCount';

export interface StockCountInput {
  locationId: string;
  /** Whose stock is counted: a project's, or Stores stock (null or left out). */
  heldForProject?: string | null;
  /** FULL: every item with stock here is listed; SPOT (the default): the ones given. */
  kind?: CountKind;
  /** When the count sheet was opened (GET /stock-counts/sheet); needed when counts are blind. */
  openedAt?: string;
  note?: string;
  lines: Array<{
    materialId: string;
    /** The system quantity the counter was shown; left out on a blind sheet. */
    expectedQuantity?: number | string | null;
    countedQuantity: number | string;
    /** Why this item differs, as the counter wrote it. */
    note?: string;
  }>;
  actorId: string;
}

export interface StockCountResult {
  countId: string;
  kind: CountKind;
  heldForProject: string | null;
  /** Lines whose stock moved while counting, not posted: count them again (system audit C7). */
  heldBack: Array<{ materialId: string; sku: string; expected?: string; current?: string }>;
  counted: number;
  adjusted: number;
  /** Differences over the write-off limit, recorded for someone else to approve rather than posted (ADR-028). */
  waitingForApproval: number;
  lines: Array<{ materialId: string; variance: string; transactionId: string | null; requestId: string | null }>;
}

export interface CountListFilter {
  /** Whole UTC days, the last one included. */
  from?: string;
  to?: string;
  locationId?: string;
  /** A room and the locations inside it; wins over locationId. */
  locationIds?: string[];
  /** Who counted. */
  actorId?: string;
  before?: string;
  limit?: number;
}

export interface CountRecord {
  id: string;
  cursor: string;
  at: string;
  locationId: string | null;
  locationName: string;
  countedByName: string;
  counted: number;
  adjusted: number;
  note: string | null;
  /** Full or Spot; counts from before ADR-040 are Spot. */
  kind: CountKind;
  /** Whose stock: a project's, or null for Stores stock. */
  heldForProject: string | null;
  /** The adjustments the count posted: counted less what the system had. */
  differences: Array<{ materialId: string; sku: string; name: string; unitOfMeasure: string; quantity: string }>;
  /**
   * The full count sheet: every item counted, matched or not, with what the
   * system had. Empty for counts posted before sheets were kept.
   */
  lines: Array<{ materialId: string; sku: string; name: string; unitOfMeasure: string; expected: string; counted: string; note: string | null }>;
}

export const StockCountService = {
  /** Posted counts, newest first, each with the differences it adjusted, for the stock-counts report. */
  async list(filter: CountListFilter): Promise<CountRecord[]> {
    const and: Prisma.AuditLogEntryWhereInput[] = [{ entityType: 'StockCount', action: 'STOCK_COUNT' }];
    const createdAt = dayRange(filter.from, filter.to);
    if (createdAt) and.push({ createdAt });
    if (filter.actorId) and.push({ actorId: filter.actorId });
    if (filter.locationIds) and.push({ OR: filter.locationIds.map((id) => ({ after: { path: ['locationId'], equals: id } })) });
    else if (filter.locationId) and.push({ after: { path: ['locationId'], equals: filter.locationId } });
    if (filter.before) {
      const { at, id } = parseCursor(filter.before);
      and.push({ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] });
    }
    const entries = await prisma.auditLogEntry.findMany({
      where: { AND: and },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(filter.limit ?? 50, 200),
    });
    const facts = entries.map((e) => (e.after ?? {}) as { locationId?: string; counted?: number; adjusted?: number; note?: string | null; kind?: CountKind; heldForProject?: string | null });
    const locationIds = [...new Set(facts.map((f) => f.locationId).filter((id): id is string => !!id))];
    const userIds = [...new Set(entries.map((e) => e.actorId).filter((id): id is string => !!id))];
    const countIds = entries.map((e) => e.entityId);
    const material = { select: { sku: true, name: true, unitOfMeasure: true } } as const;
    const [adjustments, sheetLines, locations, users] = await Promise.all([
      entries.length === 0 ? [] : prisma.inventoryTransaction.findMany({
        where: { referenceType: STOCK_COUNT_REFERENCE, referenceId: { in: countIds } },
        include: { material },
      }),
      entries.length === 0 ? [] : prisma.stockCountLine.findMany({ where: { countId: { in: countIds } }, include: { material } }),
      locationIds.length === 0 ? [] : prisma.location.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true } }),
      userIds.length === 0 ? [] : prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    ]);
    const locationName = new Map(locations.map((l) => [l.id, l.name]));
    const userName = new Map(users.map((u) => [u.id, u.name]));
    return entries.map((e, i) => {
      const f = facts[i]!;
      return {
        id: e.entityId,
        cursor: pageCursor(e.createdAt, e.id),
        at: e.createdAt.toISOString(),
        locationId: f.locationId ?? null,
        locationName: (f.locationId && locationName.get(f.locationId)) || 'Unknown location',
        countedByName: e.actorId ? userName.get(e.actorId) ?? 'Unknown user' : 'System',
        counted: Number(f.counted ?? 0),
        adjusted: Number(f.adjusted ?? 0),
        note: f.note ?? null,
        kind: f.kind === 'FULL' ? 'FULL' : 'SPOT',
        heldForProject: f.heldForProject ?? null,
        differences: adjustments
          .filter((t) => t.referenceId === e.entityId)
          .map((t) => ({ materialId: t.materialId, sku: t.material.sku, name: t.material.name, unitOfMeasure: t.material.unitOfMeasure, quantity: t.quantity.toString() }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        lines: sheetLines
          .filter((l) => l.countId === e.entityId)
          .map((l) => ({ materialId: l.materialId, sku: l.material.sku, name: l.material.name, unitOfMeasure: l.material.unitOfMeasure, expected: l.expectedQuantity.toString(), counted: l.countedQuantity.toString(), note: l.note }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    });
  },


  /**
   * The count sheet for one stock at one location (system audit C4-C6): every
   * item with book stock there, and when the sheet was opened, by the
   * database's clock. With blind counts on, the book figures are left out; a
   * movement after the sheet was opened then holds that line back instead.
   */
  async sheet(input: { locationId: string; heldForProject?: string | null }): Promise<CountSheet> {
    const heldForProject = input.heldForProject?.trim() || null;
    const location = await prisma.location.findUnique({ where: { id: input.locationId }, select: { id: true, name: true } });
    if (!location) throw Errors.notFound('Location');
    if (heldForProject && !(await prisma.project.findUnique({ where: { projectNumber: heldForProject }, select: { projectNumber: true } }))) throw Errors.notFound('Project');
    const blind = (await SettingsService.getValue<boolean>(BLIND_COUNTS)) === true;
    const now = (await prisma.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now`)[0]!.now;
    const balances = await prisma.inventoryBalance.findMany({
      where: { locationId: input.locationId, heldForProject: heldForProject ?? '', NOT: { quantity: 0 } },
      include: { material: { select: { sku: true, name: true, unitOfMeasure: true, active: true, category: true } } },
    });
    const held = await prisma.inventoryBalance.findMany({
      where: { locationId: input.locationId, NOT: [{ heldForProject: '' }, { quantity: 0 }] }, select: { heldForProject: true }, distinct: ['heldForProject'],
    });
    return {
      locationId: location.id, locationName: location.name, heldForProject, blind, openedAt: now.toISOString(),
      projects: held.map((h) => h.heldForProject).sort(),
      lines: balances
        .map((b) => ({
          materialId: b.materialId, sku: b.material.sku, name: b.material.name, unitOfMeasure: b.material.unitOfMeasure,
          category: b.material.category, active: b.material.active, expected: blind ? null : b.quantity.toString(),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  },

  async post(input: StockCountInput, within?: Prisma.TransactionClient): Promise<StockCountResult> {
    if (input.lines.length === 0) throw Errors.validation('Count at least one item');
    const lines = input.lines.map((l) => ({
      materialId: l.materialId,
      expected: l.expectedQuantity === undefined || l.expectedQuantity === null ? null : toDecimal(l.expectedQuantity),
      counted: toDecimal(l.countedQuantity), note: l.note?.trim() || null,
    }));
    if (lines.some((l) => l.counted.isNegative())) throw Errors.validation('A counted quantity cannot be negative');
    if (new Set(lines.map((l) => l.materialId)).size !== lines.length) throw Errors.validation('Each item can appear only once in a count');
    const note = input.note?.trim() || null;
    const kind: CountKind = input.kind ?? 'SPOT';
    // Whose stock is counted: Stores stock, or one project's (system audit C6).
    const heldForProject = input.heldForProject?.trim() || null;
    const stockOf = (materialId: string) => ({ materialId, locationId: input.locationId, heldForProject });
    const blind = (await SettingsService.getValue<boolean>(BLIND_COUNTS)) === true;
    const openedAt = input.openedAt ? new Date(input.openedAt) : null;
    if (openedAt && Number.isNaN(openedAt.getTime())) throw Errors.validation('Invalid sheet opening time');
    // Blind, the counter never saw the book figures: movements are found by
    // when they were posted, against when the sheet was opened (system audit C4).
    if (blind && !openedAt) throw Errors.validation('Counts are blind: open the count sheet, then count.');
    if (!openedAt && lines.some((l) => l.expected === null)) throw Errors.validation('Each line needs the quantity the system showed, or the time the sheet was opened.');

    const countId = randomUUID();
    return inTx(within, async (tx) => {
      // One count at a time per location, so two counters cannot both correct the same difference.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`afrinov:stock-count:${input.locationId}`}))`;
      await lockInventoryBalances(lines.map((line) => stockOf(line.materialId)), tx);

      // Held as checkLocationActive does (system audit A1).
      await tx.$executeRaw`SELECT 1 FROM locations WHERE id = ${input.locationId} FOR SHARE`;
      const location = await tx.location.findUnique({ where: { id: input.locationId } });
      if (!location) throw Errors.notFound('Location');
      if (!location.active) throw Errors.validation(`Location ${location.name} is inactive`);
      if (heldForProject && !(await tx.project.findUnique({ where: { projectNumber: heldForProject }, select: { projectNumber: true } }))) throw Errors.notFound('Project');

      const materials = await tx.material.findMany({ where: { id: { in: lines.map((l) => l.materialId) } }, select: { id: true, sku: true, unitCost: true } });
      const skuById = new Map(materials.map((m) => [m.id, m.sku]));
      const costById = new Map(materials.map((m) => [m.id, m.unitCost ?? null]));
      const unknown = lines.filter((l) => !skuById.has(l.materialId));
      if (unknown.length > 0) throw Errors.notFound('Material');
      await checkWholeUnits(lines.map((l) => ({ materialId: l.materialId, quantity: l.counted })), tx);

      // A full count lists every item with stock here; one not found is counted
      // as 0, not left off (system audit C5).
      if (kind === 'FULL') {
        const listed = new Set(lines.map((l) => l.materialId));
        const missing = await tx.inventoryBalance.findMany({
          where: { locationId: input.locationId, heldForProject: heldForProject ?? '', NOT: { quantity: 0 }, materialId: { notIn: [...listed] } },
          include: { material: { select: { sku: true } } },
        });
        if (missing.length > 0) {
          const skus = missing.map((m) => m.material.sku).sort();
          throw Errors.validation(`A full count lists every item with stock at ${location.name}: ${skus.slice(0, 5).join(', ')}${skus.length > 5 ? ` and ${skus.length - 5} more` : ''} ${skus.length === 1 ? 'isn\'t' : 'aren\'t'} on it. Count ${skus.length === 1 ? 'it' : 'them'}, or confirm ${skus.length === 1 ? 'it' : 'them'} as 0.`, { missing: missing.map((m) => m.materialId) });
        }
      }

      // What moved while counting: against the figure shown, or, on a blind
      // sheet, anything posted since it was opened. Those lines are held back for
      // a recount and the rest post (system audit C7).
      const current = new Map<string, Prisma.Decimal>();
      for (const l of lines) current.set(l.materialId, await getCurrentBalance(stockOf(l.materialId), tx));
      const postedSince = openedAt
        ? new Set((await tx.inventoryTransaction.findMany({
          where: { locationId: input.locationId, heldForProject, materialId: { in: lines.map((l) => l.materialId) }, postedAt: { gt: openedAt } },
          select: { materialId: true }, distinct: ['materialId'],
        })).map((t) => t.materialId))
        : new Set<string>();
      const movedLine = (l: (typeof lines)[number]) => (l.expected !== null && !blind ? !current.get(l.materialId)!.eq(l.expected) : postedSince.has(l.materialId));
      const heldBack = lines.filter(movedLine).map((l) => ({
        materialId: l.materialId, sku: skuById.get(l.materialId)!,
        // A blind sheet shows no figures, so none are sent back either.
        ...(blind ? {} : { expected: (l.expected ?? current.get(l.materialId)!).toString(), current: current.get(l.materialId)!.toString() }),
      }));
      const posting = lines.filter((l) => !movedLine(l));
      if (posting.length === 0) {
        throw Errors.conflict(
          `Stock at ${location.name} changed while you were counting${blind ? '' : ` (${heldBack.slice(0, 3).map((m) => `${m.sku}: ${m.expected} → ${m.current}`).join(', ')}${heldBack.length > 3 ? ', …' : ''})`}. Count those items again and post.`,
          { moved: heldBack },
        );
      }

      const variances = new Map(posting.map((l) => [l.materialId, l.counted.minus(current.get(l.materialId)!)]));
      // Each difference is posted as one movement, so it must fit the column too
      // (a large negative balance corrected by a large count; Qodo, PR #151).
      const tooBig = posting.filter((l) => !fitsQuantityColumn(variances.get(l.materialId)!));
      if (tooBig.length > 0) {
        throw Errors.validation(`The difference for ${tooBig.map((l) => skuById.get(l.materialId)).join(', ')} is too large to post as one movement. Correct it in smaller steps.`);
      }
      // An item with an adjustment already waiting for approval here would be
      // corrected twice if both were approved: that one is decided first.
      const differing = posting.filter((l) => !variances.get(l.materialId)!.isZero()).map((l) => l.materialId);
      // A difference is a movement; an inactive item counted as it stands is not.
      for (const materialId of differing) await checkMaterialActive(materialId, tx);
      const waiting = differing.length === 0 ? [] : await tx.adjustmentRequest.findMany({
        where: { status: 'PENDING', locationId: input.locationId, heldForProject, materialId: { in: differing } },
        select: { materialId: true },
      });
      if (waiting.length > 0) {
        const skus = [...new Set(waiting.map((w) => skuById.get(w.materialId)))].join(', ');
        throw Errors.invalidState(`${skus} at ${location.name} already has an adjustment waiting for approval. Approve or reject it under Write-offs to approve, then count again.`);
      }

      // A difference over the write-off limit, or of an item with no unit cost,
      // waits for someone else's approval, as any adjustment does (ADR-028).
      const rule = await writeOffRule(tx);
      const results: StockCountResult['lines'] = [];
      const events: DomainEvent[] = [];
      for (const l of posting) {
        const variance = variances.get(l.materialId)!;
        if (variance.isZero()) {
          results.push({ materialId: l.materialId, variance: '0', transactionId: null, requestId: null });
          continue;
        }
        const reasonNote = [note, l.note].some(Boolean) ? `Stock count: ${[note, l.note].filter(Boolean).join(' — ')}` : 'Stock count';
        // Judged with the counter's other write-offs of the item this week (system audit C2).
        const recent = variance.isNegative() ? await recentWriteOffQuantity({ actorId: input.actorId, materialId: l.materialId }, tx) : undefined;
        const check = rule(variance, costById.get(l.materialId) ?? null, recent);
        if (check.needsApproval) {
          const { requestId } = await requestAdjustment({
            materialId: l.materialId, locationId: input.locationId, heldForProject, quantity: variance, reasonCode: AdjustmentReasonCode.COUNT_VARIANCE,
            reasonNote, referenceType: STOCK_COUNT_REFERENCE, referenceId: countId, actorId: input.actorId,
          }, check, tx);
          results.push({ materialId: l.materialId, variance: variance.toString(), transactionId: null, requestId });
          continue;
        }
        const trx = await tx.inventoryTransaction.create({
          data: {
            materialId: l.materialId,
            locationId: input.locationId,
            heldForProject,
            type: InventoryTransactionType.ADJUSTMENT,
            quantity: variance,
            reasonCode: AdjustmentReasonCode.COUNT_VARIANCE,
            // The count's note, then the item's own: "Stock count: Monthly — 3 cracked, binned".
            reasonNote,
            referenceType: STOCK_COUNT_REFERENCE,
            referenceId: countId,
            actorId: input.actorId,
          },
        });
        await recomputeBalance(stockOf(l.materialId), tx);
        results.push({ materialId: l.materialId, variance: variance.toString(), transactionId: trx.id, requestId: null });
        events.push({ type: 'InventoryAdjusted', materialId: l.materialId, locationId: input.locationId, quantity: variance.toNumber() });
      }

      // The sheet as posted, matched items included, with what the system had.
      await tx.stockCountLine.createMany({
        data: posting.map((l) => ({ countId, materialId: l.materialId, expectedQuantity: current.get(l.materialId)!, countedQuantity: l.counted, note: l.note })),
      });

      const adjusted = results.filter((r) => r.transactionId).length;
      const waitingForApproval = results.filter((r) => r.requestId).length;
      await tx.auditLogEntry.create({
        data: {
          actorId: input.actorId,
          action: 'STOCK_COUNT',
          entityType: 'StockCount',
          entityId: countId,
          after: {
            locationId: input.locationId, counted: posting.length, adjusted, waitingForApproval, note,
            kind, heldForProject, blind, heldBack: heldBack.map((h) => h.materialId),
          } as Prisma.InputJsonValue,
        },
      });
      await dispatchDomainEvents(events);

      return { countId, kind, heldForProject, counted: posting.length, adjusted, waitingForApproval, lines: results, heldBack };
    });
  },
};
