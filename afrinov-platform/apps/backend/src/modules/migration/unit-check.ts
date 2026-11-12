// Whole units in an import (system audit H6, ADR-040). A counted unit (each,
// pair, box) takes whole numbers only, so 1.5 lengths of steel or half a tin
// of paint can't be imported on one. The real import refuses them; the dry run
// finds them first, every one at once, so the workbook is fixed before the day.
import { Prisma } from '@prisma/client';
import { COUNTED_AT_RELEASE, fitsUnitKind, unitCode } from '../../shared/units.js';
import type { PlannedMaterial } from './mapping.js';
import type { Problem } from './workbook-analysis.js';

export type UnitKind = 'COUNTED' | 'MEASURED';

/** A unit's kind by its code, or null when the unit isn't on the list. */
export type KindOf = (code: string) => UnitKind | null;

/**
 * The kinds as the database lists them; without one, the units counted at
 * release, everything else taken as measured (so nothing is refused that the
 * list might allow).
 */
export function kindsFrom(units: ReadonlyArray<{ code: string; kind: UnitKind; active?: boolean }> | null): KindOf {
  if (!units) return (code) => (COUNTED_AT_RELEASE.has(code) ? 'COUNTED' : 'MEASURED');
  const byCode = new Map(units.filter((u) => u.active !== false).map((u) => [u.code, u.kind]));
  return (code) => byCode.get(code) ?? null;
}

const show = (n: number) => String(Number(n.toFixed(4)));

/**
 * One problem per item on a counted unit with part of one, in its required
 * stock or at any location, naming each place and quantity. An item whose unit
 * isn't on the list is a problem of its own, as the real import refuses it too.
 */
export function partUnitProblems(materials: readonly PlannedMaterial[], kindOf: KindOf): Problem[] {
  const problems: Problem[] = [];
  for (const m of materials) {
    const code = unitCode(m.unitOfMeasure);
    const kind = kindOf(code);
    const at = { category: m.category, sheet: 'Items (mapping)', productId: m.oldProductIds[0] ?? null, name: m.name };
    if (kind === null) {
      problems.push({ code: 'UNLISTED_UNIT', ...at, detail: `${m.sku}: "${m.unitOfMeasure}" is not a unit on the list` });
      continue;
    }
    if (kind !== 'COUNTED') continue;
    const parts = [
      ...(fitsUnitKind(kind, new Prisma.Decimal(m.requiredStock)) ? [] : [`required stock ${show(m.requiredStock)}`]),
      ...m.balances.filter((b) => !fitsUnitKind(kind, new Prisma.Decimal(b.quantity))).map((b) => `${show(b.quantity)} at ${b.location}`),
    ];
    if (parts.length > 0) problems.push({ code: 'PART_UNIT', ...at, detail: `${m.sku} is counted in ${code}: ${parts.join(', ')}` });
  }
  return problems;
}
