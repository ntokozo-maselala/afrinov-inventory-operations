import { describe, it, expect } from 'vitest';
import { planRackCopy, removedRacks, renderRackReport, type LocationRow, type RackRow } from './rack-copy.js';

const loc = (id: string, name: string, over: Partial<LocationRow> = {}): LocationRow => ({
  id, name, code: null, type: 'RACK', active: true, parentId: null, ...over,
});
const rack = (code: string, over: Partial<RackRow> = {}): RackRow => ({
  id: `r-${code}`, code, name: `Aisle ${code}`, description: null, locationId: null,
  projectNumber: null, capacity: null, status: 'ACTIVE', notes: null, ...over,
});

const store = loc('store', 'Main Storeroom', { type: 'STOREROOM' });
const kind = (plan: ReturnType<typeof planRackCopy>, code: string) => plan.items.find((i) => i.rack.code === code)!.outcome;

describe('planRackCopy: matching, never a guess', () => {
  it('copies the rack’s room onto the location with its code', () => {
    const plan = planRackCopy([rack('D-1', { locationId: 'store' })], [store, loc('d1', 'D-1')]);
    expect(kind(plan, 'D-1')).toMatchObject({ kind: 'set-room', location: { id: 'd1' }, room: { id: 'store' } });
    expect(removedRacks(plan)).toHaveLength(1);
  });

  it('matches a location code too, ignoring case and spacing', () => {
    const plan = planRackCopy([rack('rack-d1', { locationId: 'store' })], [store, loc('d1', 'D-1', { code: 'RACK-D1 ' })]);
    expect(kind(plan, 'rack-d1')).toMatchObject({ kind: 'set-room', location: { id: 'd1' } });
  });

  it('matches by name only when its code matches nothing', () => {
    const plan = planRackCopy([rack('X-9', { name: 'D-1', locationId: 'store' })], [store, loc('d1', 'D-1')]);
    expect(kind(plan, 'X-9')).toMatchObject({ kind: 'set-room', location: { id: 'd1' } });
  });

  it('leaves a rack whose code and name point to different locations', () => {
    const plan = planRackCopy([rack('D-1', { name: 'E-3', locationId: 'store' })], [store, loc('d1', 'D-1'), loc('e3', 'E-3')]);
    expect(kind(plan, 'D-1')).toMatchObject({ kind: 'needs-decision', reason: expect.stringContaining('matches D-1 but its name matches E-3') });
    expect(removedRacks(plan)).toHaveLength(0);
  });

  it('leaves a rack whose code matches two locations (one by name, one by code)', () => {
    const plan = planRackCopy([rack('D-1')], [loc('a', 'D-1'), loc('b', 'Rack D one', { code: 'D-1' })]);
    expect(kind(plan, 'D-1')).toMatchObject({ kind: 'needs-decision', reason: expect.stringContaining('matches 2 locations') });
  });

  it('leaves two racks that come to the same location', () => {
    const plan = planRackCopy(
      [rack('D-1', { locationId: 'store' }), rack('Q-2', { name: 'D-1', locationId: 'up' })],
      [store, loc('up', 'Upstairs', { type: 'STOREROOM' }), loc('d1', 'D-1')],
    );
    expect(kind(plan, 'D-1').kind).toBe('needs-decision');
    expect(kind(plan, 'Q-2').kind).toBe('needs-decision');
  });

  it('leaves a rack that matches a location that is not a rack', () => {
    const plan = planRackCopy([rack('Boiler Shop')], [loc('bs', 'Boiler Shop', { type: 'SHOP_FLOOR_AREA' })]);
    expect(kind(plan, 'Boiler Shop')).toMatchObject({ kind: 'needs-decision', reason: expect.stringContaining('not a rack') });
  });

  it('leaves a rack with no matching location, saying how to settle it', () => {
    const plan = planRackCopy([rack('F-7', { locationId: 'store' })], [store]);
    expect(kind(plan, 'F-7')).toMatchObject({ kind: 'needs-decision', reason: expect.stringContaining('--create it or --discard it') });
  });
});

describe('planRackCopy: the room, by the location rules', () => {
  it('has nothing to copy when the location is already in that room, or the rack names none', () => {
    const plan = planRackCopy(
      [rack('D-1', { locationId: 'store' }), rack('E-3')],
      [store, loc('d1', 'D-1', { parentId: 'store' }), loc('e3', 'E-3')],
    );
    expect(kind(plan, 'D-1').kind).toBe('nothing-to-copy');
    expect(kind(plan, 'E-3').kind).toBe('nothing-to-copy');
    expect(removedRacks(plan)).toHaveLength(2);
  });

  it('leaves a location already inside a different room', () => {
    const plan = planRackCopy([rack('D-1', { locationId: 'store' })], [store, loc('up', 'Upstairs', { type: 'STOREROOM' }), loc('d1', 'D-1', { parentId: 'up' })]);
    expect(kind(plan, 'D-1')).toMatchObject({ kind: 'needs-decision', reason: 'D-1 is already inside Upstairs, not Main Storeroom' });
  });

  it.each([
    ['an inactive room', loc('store', 'Main Storeroom', { type: 'STOREROOM', active: false }), 'is inactive'],
    ['a rack as the room', loc('store', 'Main Storeroom'), 'is a rack'],
    ['a room inside another', loc('store', 'Main Storeroom', { type: 'STOREROOM', parentId: 'site' }), 'inside another location'],
  ])('leaves %s', (_what, room, reason) => {
    const plan = planRackCopy([rack('D-1', { locationId: 'store' })], [room, loc('d1', 'D-1')]);
    expect(kind(plan, 'D-1')).toMatchObject({ kind: 'needs-decision', reason: expect.stringContaining(reason) });
  });
});

describe('planRackCopy: decisions given by code', () => {
  it('adds an unmatched rack as a location in its room with --create, and removes one with --discard', () => {
    const plan = planRackCopy([rack('F-7', { locationId: 'store' }), rack('CHK-8849')], [store], { create: ['f-7'], discard: ['CHK-8849'] });
    expect(kind(plan, 'F-7')).toMatchObject({ kind: 'create', name: 'F-7', room: { id: 'store' } });
    expect(kind(plan, 'CHK-8849').kind).toBe('discard');
    expect(plan.errors).toEqual([]);
  });

  it('adds it in no room, saying why, when its room cannot hold it', () => {
    const plan = planRackCopy([rack('F-7', { locationId: 'store' })], [loc('store', 'Main Storeroom', { type: 'STOREROOM', active: false })], { create: ['F-7'] });
    expect(kind(plan, 'F-7')).toMatchObject({ kind: 'create', room: null, roomProblem: expect.stringContaining('inactive') });
  });

  it('refuses codes it cannot act on, so nothing is applied', () => {
    const plan = planRackCopy([rack('D-1')], [loc('d1', 'D-1')], { create: ['D-1', 'Z-0'], discard: ['D-1'] });
    expect(plan.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('both --create and --discard'),
      expect.stringContaining('no rack has the code z-0'),
    ]));
  });

  it('refuses --create for a rack that already matches a location', () => {
    const plan = planRackCopy([rack('D-1')], [loc('d1', 'D-1')], { create: ['D-1'] });
    expect(plan.errors).toEqual([expect.stringContaining('already matches a location')]);
  });
});

describe('renderRackReport', () => {
  it('lists every rack under its heading, with what is dropped', () => {
    const plan = planRackCopy(
      [rack('D-1', { locationId: 'store', projectNumber: 'AFRI-1325', capacity: 100 }), rack('F-7', { locationId: 'store', status: 'FULL' })],
      [store, loc('d1', 'D-1')],
    );
    const report = renderRackReport(plan, { database: 'afrinov', generatedAt: new Date('2026-10-22T12:00:00Z'), applied: false });
    expect(report).toContain('dry run: nothing was changed');
    expect(report).toContain('## Will set the room (1)');
    expect(report).toContain('- `D-1` Aisle D-1: D-1 goes inside Main Storeroom. Dropped: project AFRI-1325, capacity 100.');
    expect(report).toContain('## Needs a decision (left as it is) (1)');
    expect(report).toContain('`F-7`');
  });
});
