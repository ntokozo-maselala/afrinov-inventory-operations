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
 * migration that created the list (20260101000043_units_of_measure) mapped
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

/**
 * Whether a quantity fits a unit of this kind: whole for a counted unit, or
 * exactly the remainder given. Stock booked in part-units before the rule (half
 * a washer still out on an issue, 0.5 still owed on an order) can then be
 * closed off, though no new part-unit can be started.
 */
export function fitsUnitKind(kind: 'COUNTED' | 'MEASURED', quantity: Decimal, remainder?: Decimal): boolean {
  return kind !== 'COUNTED' || quantity.isInteger() || (remainder !== undefined && quantity.equals(remainder));
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
 * Materials it can't find are left to the caller's own not-found check. An
 * entry's remainder, when given, is also taken (see fitsUnitKind).
 */
export async function checkWholeUnits(
  entries: ReadonlyArray<{ materialId: string; quantity: number | string | Decimal; remainder?: Decimal }>,
  db: MaterialClient,
): Promise<void> {
  if (entries.length === 0) return;
  const ids = [...new Set(entries.map((e) => e.materialId))];
  const materials = await db.material.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, unitOfMeasure: true, unit: { select: { kind: true } } },
  });
  const byId = new Map(materials.map((m) => [m.id, m]));
  for (const e of entries) {
    const m = byId.get(e.materialId);
    if (m && !fitsUnitKind(m.unit.kind, toDecimal(e.quantity), e.remainder)) {
      throw Errors.validation(wholeUnitsMessage(m.name, m.unitOfMeasure), { materialId: e.materialId, quantity: toDecimal(e.quantity).toString() });
    }
  }
}
