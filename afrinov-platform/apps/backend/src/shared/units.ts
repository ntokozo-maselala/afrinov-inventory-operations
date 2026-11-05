// Units of measure (units_of_measure). An item's unit says how its quantities
// are entered: a COUNTED unit (each, pair, box) takes whole numbers only, a
// MEASURED one (m, kg, l) up to the 4 decimal places the columns hold. The
// kinds live in the table; this module maps the spellings people type onto its
// codes and checks quantities against an item's unit.
import { Prisma } from '@prisma/client';
import { Errors } from './errors.js';
import { toDecimal } from './decimal.js';

type Decimal = Prisma.Decimal;

/**
 * Every spelling of a listed unit, trimmed and lower-case, to its code. The
 * migration that created the list (20260101000047_units_of_measure) mapped
 * existing items with the same table; keep the two in step.
 */
export const UNIT_ALIASES: Readonly<Record<string, string>> = {
  each: 'each', ea: 'each', pc: 'each', pcs: 'each', piece: 'each', pieces: 'each',
  unit: 'each', units: 'each', no: 'each', 'no.': 'each', nos: 'each', item: 'each', items: 'each',
  pair: 'pair', pairs: 'pair', pr: 'pair', prs: 'pair',
  set: 'set', sets: 'set',
  box: 'box', boxes: 'box', bx: 'box',
  pack: 'pack', packs: 'pack', pk: 'pack', pkt: 'pack', packet: 'pack', packets: 'pack',
  roll: 'roll', rolls: 'roll', rl: 'roll',
  bag: 'bag', bags: 'bag',
  sheet: 'sheet', sheets: 'sheet',
  length: 'length', lengths: 'length', lgth: 'length',
  m: 'm', metre: 'm', metres: 'm', meter: 'm', meters: 'm', mtr: 'm', mtrs: 'm', lm: 'm',
  mm: 'mm', millimetre: 'mm', millimetres: 'mm', millimeter: 'mm', millimeters: 'mm',
  kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg',
  g: 'g', gram: 'g', grams: 'g',
  l: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l', lt: 'l', ltr: 'l',
  ml: 'ml', millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml',
  m2: 'm2', 'm²': 'm2', sqm: 'm2', 'sq m': 'm2',
  m3: 'm3', 'm³': 'm3', 'cubic metre': 'm3', 'cubic metres': 'm3',
};

/**
 * The counted units on the list as the migration created it. The table is the
 * source of truth once it exists; this is for the check run before release
 * (scripts/check-units.ts), when it does not yet.
 */
export const COUNTED_AT_RELEASE: ReadonlySet<string> = new Set(['each', 'pair', 'set', 'box', 'pack', 'roll', 'bag', 'sheet', 'length']);

/** The listed code a typed unit stands for ("EA" → each), or the text as typed, trimmed. */
export function unitCode(typed: string): string {
  const t = typed.trim();
  return UNIT_ALIASES[t.toLowerCase()] ?? t;
}

/** Whether a quantity fits a unit of this kind: whole for a counted unit. */
export function fitsUnitKind(kind: 'COUNTED' | 'MEASURED', quantity: Decimal): boolean {
  return kind !== 'COUNTED' || quantity.isInteger();
}

const partOf = (q: Decimal) => q.minus(q.floor());

/**
 * Whether these quantities, taken together from what is left (still out on an
 * issue or a loan, still owed on an order line), fit a unit of this kind. Each
 * is whole, except that one may carry exactly the remainder's part-unit, so
 * stock booked in part-units before the rule can be closed off: what is left
 * becomes whole, and no new part-unit is started. Out of 2.5, 2.5 or 0.5 or
 * 1.5 is taken; out of 3, 2.5 and 0.5 is not.
 */
export function fitsRemainder(kind: 'COUNTED' | 'MEASURED', quantities: readonly Decimal[], remainder: Decimal): boolean {
  if (kind !== 'COUNTED') return true;
  const parts = quantities.filter((q) => !q.isInteger());
  if (parts.length === 0) return true;
  return parts.length === 1 && !remainder.isInteger() && partOf(parts[0]!).equals(partOf(remainder));
}

/**
 * Holds the items' rows for the rest of the transaction, as every check of a
 * quantity against an item's unit does, so a change of unit (which takes them
 * FOR UPDATE) can't slip between the check and the movement it allows.
 */
export async function holdUnits(materialIds: readonly string[], db: Pick<Prisma.TransactionClient, '$executeRaw'>): Promise<void> {
  const ids = [...new Set(materialIds)].sort();
  if (ids.length > 0) await db.$executeRaw`SELECT 1 FROM materials WHERE id IN (${Prisma.join(ids)}) FOR SHARE`;
}

/** What to tell someone who entered part of a counted item. */
export function wholeUnitsMessage(name: string, unit: string): string {
  return `${name} is counted in whole numbers (${unit}). Enter 1, 2, 3 …`;
}

type UnitClient = Pick<Prisma.TransactionClient, 'unitOfMeasure'>;
type MaterialClient = Pick<Prisma.TransactionClient, 'material'>;

/** Every unit, in the order the item form lists them. */
export function listUnits(db: UnitClient) {
  return db.unitOfMeasure.findMany({
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    select: { code: true, label: true, kind: true, needsReview: true, active: true },
  });
}

/**
 * The listed, active unit a material may be given, by any of its spellings.
 * Refuses one that isn't on the list, so a new item can't start a new spelling.
 */
export async function checkUnitOfMeasure(typed: string, db: UnitClient): Promise<{ code: string; kind: 'COUNTED' | 'MEASURED' }> {
  const code = unitCode(typed);
  const unit = await db.unitOfMeasure.findUnique({ where: { code }, select: { code: true, kind: true, active: true } });
  if (!unit || !unit.active) {
    throw Errors.validation(`"${typed.trim()}" is not a unit on the list. Choose one, such as each, pair, box, m or kg.`, { field: 'unitOfMeasure' });
  }
  return { code: unit.code, kind: unit.kind };
}

/** Refuses part of a counted unit for an item that isn't saved yet (its required or opening stock). */
export function checkQuantityForUnit(name: string, unit: { code: string; kind: 'COUNTED' | 'MEASURED' }, quantity: number | string | Decimal, field: string): void {
  if (!fitsUnitKind(unit.kind, toDecimal(quantity))) throw Errors.validation(wholeUnitsMessage(name, unit.code), { field });
}

/**
 * Refuses part of a counted item: 0.5 of a washer, 2.25 gloves. Called with
 * the quantities a person entered; figures the system works out (a count's
 * difference, a stored request being approved) are not checked again.
 * Materials it can't find are left to the caller's own not-found check. The
 * items are held (holdUnits) for the rest of the caller's transaction.
 *
 * Entries that take from one remainder (lines against one order line) share a
 * `group` and its `remainder`, and are checked together by fitsRemainder.
 */
export async function checkWholeUnits(
  entries: ReadonlyArray<{ materialId: string; quantity: number | string | Decimal; remainder?: Decimal; group?: string }>,
  db: MaterialClient & Pick<Prisma.TransactionClient, '$executeRaw'>,
): Promise<void> {
  if (entries.length === 0) return;
  const ids = [...new Set(entries.map((e) => e.materialId))];
  await holdUnits(ids, db);
  const materials = await db.material.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, unitOfMeasure: true, unit: { select: { kind: true } } },
  });
  const byId = new Map(materials.map((m) => [m.id, m]));
  const groups = new Map<string, Array<(typeof entries)[number]>>();
  entries.forEach((e, i) => {
    const key = e.group !== undefined ? `g:${e.group}` : `e:${i}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  });
  for (const group of groups.values()) {
    const first = group[0]!;
    const m = byId.get(first.materialId);
    if (!m) continue;
    const quantities = group.map((e) => toDecimal(e.quantity));
    const fits = first.remainder !== undefined ? fitsRemainder(m.unit.kind, quantities, first.remainder) : quantities.every((q) => fitsUnitKind(m.unit.kind, q));
    if (!fits) {
      throw Errors.validation(wholeUnitsMessage(m.name, m.unitOfMeasure), { materialId: first.materialId, quantity: quantities.map(String).join(', ') });
    }
  }
}
