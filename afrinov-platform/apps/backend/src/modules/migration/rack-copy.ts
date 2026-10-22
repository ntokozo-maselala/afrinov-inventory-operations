// Racks and locations roadmap, Phase 3.1: what each Rack record becomes when
// racks become locations. In the stock workbook a rack code ("D-1") and a room
// ("Stores") share one column, and the platform holds stock per location; the
// separate Rack record holds no stock, and its one useful fact is the room a
// rack stands in. This plans copying that fact onto the matching location
// (its parent), and which Rack records can then go. Pure: the script reads
// the database, plans with this, writes the report and, with --apply, does it.
//
// Nothing is guessed. A rack is matched by code first, and by name only when
// that is unambiguous; anything else needs a person's decision, given to the
// script as --create (add the rack as a location) or --discard (remove it).
// The room is checked by the same rules as LocationService (one level, never
// inside a rack or an inactive room). The Rack extras (project, capacity,
// "Full" status, notes) are dropped, as decided: the report lists them, and
// each rack's full record goes to the audit log before the rack is removed.
import type { LocationType, RackStatus } from '@prisma/client';

export interface RackRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  locationId: string | null;
  projectNumber: string | null;
  capacity: number | null;
  status: RackStatus;
  notes: string | null;
}

export interface LocationRow {
  id: string;
  name: string;
  code: string | null;
  type: LocationType;
  active: boolean;
  parentId: string | null;
}

/** What happens to one rack. */
export type RackOutcome =
  /** The matched location gets the rack's room; the rack goes. */
  | { kind: 'set-room'; location: LocationRow; room: LocationRow }
  /** Nothing to copy (already in that room, or the rack names no room); the rack goes. */
  | { kind: 'nothing-to-copy'; location: LocationRow; room: LocationRow | null }
  /** --create: a new location of type Rack, in the rack's room if it can hold one; the rack goes. */
  | { kind: 'create'; name: string; room: LocationRow | null; roomProblem: string | null }
  /** --discard: the rack goes, copying nothing. */
  | { kind: 'discard' }
  /** Left as it is, for a person to decide. */
  | { kind: 'needs-decision'; reason: string; location?: LocationRow };

export interface RackPlanItem {
  rack: RackRow;
  outcome: RackOutcome;
  /** Rack fields that no location keeps, listed so nothing goes unnoticed. */
  dropped: string[];
}

export interface RackPlan {
  items: RackPlanItem[];
  /** Codes given to --create or --discard that cannot be done: the script stops on any. */
  errors: string[];
}

const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** What a rack carries that no location keeps (the decided Rack extras). */
export function droppedFields(r: RackRow): string[] {
  const out: string[] = [];
  if (r.projectNumber) out.push(`project ${r.projectNumber}`);
  if (r.capacity !== null) out.push(`capacity ${r.capacity}`);
  if (r.status !== 'ACTIVE') out.push(`status ${r.status}`);
  if (r.description) out.push(`description "${r.description}"`);
  if (r.notes) out.push(`notes "${r.notes}"`);
  return out;
}

/** The one location this rack is, or why that cannot be said for sure. */
export function matchRack(r: RackRow, locations: LocationRow[]): { location: LocationRow } | { none: true } | { ambiguous: string } {
  const byCode = locations.filter((l) => norm(l.name) === norm(r.code) || (l.code !== null && norm(l.code) === norm(r.code)));
  const byName = locations.filter((l) => norm(l.name) === norm(r.name));
  if (byCode.length > 1) {
    return { ambiguous: `its code ${r.code} matches ${byCode.length} locations (${byCode.map((l) => l.name).join(', ')})` };
  }
  if (byCode.length === 1) {
    const other = byName.find((l) => l.id !== byCode[0]!.id);
    if (other) return { ambiguous: `its code matches ${byCode[0]!.name} but its name matches ${other.name}` };
    return { location: byCode[0]! };
  }
  if (byName.length === 1) return { location: byName[0]! };
  if (byName.length > 1) return { ambiguous: `its name matches ${byName.length} locations` };
  return { none: true };
}

/**
 * Why `room` cannot hold `location` (absent when it is new), by LocationService's
 * rules, or null when it can. `locations` is every location, to count children.
 */
export function roomProblem(room: LocationRow, location: LocationRow | null, locations: LocationRow[]): string | null {
  if (location && room.id === location.id) return 'its room is the location itself';
  if (!room.active) return `its room ${room.name} is inactive`;
  if (room.type === 'RACK') return `its room ${room.name} is a rack`;
  if (room.parentId) return `its room ${room.name} is itself inside another location`;
  if (location && locations.some((l) => l.parentId === location.id)) return `${location.name} has locations inside it`;
  return null;
}

export function planRackCopy(
  racks: RackRow[],
  locations: LocationRow[],
  decisions: { create?: string[]; discard?: string[] } = {},
): RackPlan {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const wanted = (list: string[] | undefined) => new Set((list ?? []).map(norm));
  const create = wanted(decisions.create);
  const discard = wanted(decisions.discard);
  const errors: string[] = [];
  for (const c of create) if (discard.has(c)) errors.push(`${c} is given to both --create and --discard`);
  const known = new Set(racks.map((r) => norm(r.code)));
  for (const c of [...create, ...discard]) if (!known.has(c)) errors.push(`no rack has the code ${c}`);

  const items = racks.map((rack): RackPlanItem => {
    const dropped = droppedFields(rack);
    const code = norm(rack.code);
    if (discard.has(code)) return { rack, outcome: { kind: 'discard' }, dropped };
    // The rack's room as the Rack record has it. A missing room record counts as none.
    const room = rack.locationId ? byId.get(rack.locationId) ?? null : null;
    const match = matchRack(rack, locations);

    if (create.has(code)) {
      if (!('none' in match)) {
        errors.push(`${rack.code} already matches a location, so --create does not apply; leave it out, or --discard it`);
        return { rack, outcome: { kind: 'needs-decision', reason: 'given to --create but it already matches a location' }, dropped };
      }
      const problem = room ? roomProblem(room, null, locations) : null;
      return { rack, outcome: { kind: 'create', name: rack.code.trim(), room: problem ? null : room, roomProblem: problem }, dropped };
    }

    if ('ambiguous' in match) return { rack, outcome: { kind: 'needs-decision', reason: `no single match: ${match.ambiguous}` }, dropped };
    if ('none' in match) return { rack, outcome: { kind: 'needs-decision', reason: 'no location matches its code or name; --create it or --discard it' }, dropped };

    const location = match.location;
    if (location.type !== 'RACK') {
      return { rack, outcome: { kind: 'needs-decision', reason: `it matches ${location.name}, which is not a rack (${location.type})`, location }, dropped };
    }
    if (!room) return { rack, outcome: { kind: 'nothing-to-copy', location, room: null }, dropped };
    if (location.parentId === room.id) return { rack, outcome: { kind: 'nothing-to-copy', location, room }, dropped };
    if (location.parentId) {
      const current = byId.get(location.parentId);
      return { rack, outcome: { kind: 'needs-decision', reason: `${location.name} is already inside ${current?.name ?? 'another location'}, not ${room.name}`, location }, dropped };
    }
    const problem = roomProblem(room, location, locations);
    if (problem) return { rack, outcome: { kind: 'needs-decision', reason: `cannot put ${location.name} in its room: ${problem}`, location }, dropped };
    return { rack, outcome: { kind: 'set-room', location, room }, dropped };
  });

  // Two racks that come to the same location (one by code, one by name) cannot
  // both say where it stands: neither is applied.
  const target = (i: RackPlanItem) => (i.outcome.kind === 'set-room' || i.outcome.kind === 'nothing-to-copy' ? i.outcome.location.id : null);
  const counts = new Map<string, number>();
  for (const i of items) { const t = target(i); if (t) counts.set(t, (counts.get(t) ?? 0) + 1); }
  for (const i of items) {
    const t = target(i);
    if (t && counts.get(t)! > 1) {
      const name = byId.get(t)?.name ?? 'one location';
      i.outcome = { kind: 'needs-decision', reason: `${counts.get(t)} racks match ${name}; --discard the ones that are not it`, location: byId.get(t) };
    }
  }

  return { items, errors };
}

/** Racks this plan removes: everything not left for a decision. */
export function removedRacks(plan: RackPlan): RackPlanItem[] {
  return plan.items.filter((i) => i.outcome.kind !== 'needs-decision');
}

const HEADINGS: Array<[RackOutcome['kind'], string]> = [
  ['set-room', 'Will set the room'],
  ['nothing-to-copy', 'Nothing to copy'],
  ['create', 'Will be added as a location (--create)'],
  ['discard', 'Will be discarded (--discard)'],
  ['needs-decision', 'Needs a decision (left as it is)'],
];

function line(i: RackPlanItem): string {
  const o = i.outcome;
  const rack = `\`${i.rack.code}\` ${i.rack.name}`;
  let what = '';
  if (o.kind === 'set-room') what = `${o.location.name} goes inside ${o.room.name}`;
  if (o.kind === 'nothing-to-copy') what = o.room ? `${o.location.name} is already inside ${o.room.name}` : `matches ${o.location.name}; the rack names no room`;
  if (o.kind === 'create') {
    what = o.room
      ? `new location ${o.name} (Rack) inside ${o.room.name}`
      : `new location ${o.name} (Rack)${o.roomProblem ? `, in no room: ${o.roomProblem}` : ''}`;
  }
  if (o.kind === 'discard') what = 'removed, nothing copied';
  if (o.kind === 'needs-decision') what = o.reason;
  const dropped = i.dropped.length && o.kind !== 'needs-decision' ? ` Dropped: ${i.dropped.join(', ')}.` : '';
  return `- ${rack}: ${what}.${dropped}`;
}

export function renderRackReport(plan: RackPlan, meta: { database: string | null; generatedAt: Date; applied: boolean }): string {
  const out = [
    '# Racks to locations',
    '',
    `Database: ${meta.database ?? '(none)'} · ${meta.generatedAt.toISOString()} · ${meta.applied ? 'applied' : 'dry run: nothing was changed'}`,
    '',
    `${plan.items.length} racks: ${removedRacks(plan).length} handled, ${plan.items.length - removedRacks(plan).length} need a decision.`,
    'Each handled rack\'s full record goes to the audit log before the rack is removed.',
  ];
  if (plan.errors.length) out.push('', '## Cannot apply', '', ...plan.errors.map((e) => `- ${e}`));
  for (const [kind, title] of HEADINGS) {
    const items = plan.items.filter((i) => i.outcome.kind === kind);
    if (items.length) out.push('', `## ${title} (${items.length})`, '', ...items.map(line));
  }
  return `${out.join('\n')}\n`;
}
