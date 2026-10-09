// The frontend-only consumption report, which mirrors the backend's.
import { describe, it, expect } from 'vitest';
import { computeConsumption } from './mockConsumption';
import { NO_PROJECT, NO_RECIPIENT } from '../api/reportTypes';
import type { MockInventoryTransaction, MockMaterial, MockProject, MockRecipient } from './types';

const tx = (id: string, type: 'ISSUE' | 'RETURN' | 'RECEIPT', materialId: string, quantity: number, postedAt: string, extra: Partial<MockInventoryTransaction> = {}): MockInventoryTransaction => ({
  id, type, materialId, locationId: 'loc-1', quantity: String(quantity), postedAt, actorId: 'u', ...extra,
} as MockInventoryTransaction);

const materials = [
  { id: 'disc', sku: 'CON-1', name: 'Disc', category: 'CONSUMABLES', unitOfMeasure: 'each', unitCost: '42.05' },
  { id: 'pipe', sku: 'PRJ-1', name: 'Pipe', category: 'PROJECT_MATERIAL', unitOfMeasure: 'm' },
] as unknown as MockMaterial[];
const projects = [{ projectNumber: 'P-1', name: 'Pump' }] as MockProject[];

const transactions = [
  tx('r', 'RECEIPT', 'disc', 100, '2026-10-01T08:00:00Z'),
  tx('i1', 'ISSUE', 'disc', -30, '2026-10-02T08:00:00Z', { projectNumber: 'P-1', recipientId: 'rcp-1' }),
  tx('ret', 'RETURN', 'disc', 5, '2026-10-03T08:00:00Z', { projectNumber: 'P-1', recipientId: 'rcp-1' }),
  tx('i2', 'ISSUE', 'disc', -10, '2026-10-31T23:00:00Z'),
  tx('i3', 'ISSUE', 'pipe', -2.5, '2026-10-05T08:00:00Z', { projectNumber: 'P-1' }),
  tx('bad', 'ISSUE', 'disc', -7, '2026-10-06T08:00:00Z', { projectNumber: 'P-1' }),
  tx('undo', 'ISSUE', 'disc', 7, '2026-11-02T08:00:00Z', { projectNumber: 'P-1', reversesId: 'bad' }),
  tx('old', 'ISSUE', 'disc', -50, '2026-09-30T23:59:00Z'),
];

const recipients = [{ id: 'rcp-1', name: 'Sabelo', type: 'WORKER', active: true }] as MockRecipient[];
const run = (qs: Record<string, string>) => computeConsumption(
  { from: '2026-10-01', to: '2026-10-31', ...qs },
  { transactions, materials, projects, recipients, userName: () => 'Vusi' },
);

describe('computeConsumption (mock)', () => {
  it('nets returns off issues, includes the last day, and leaves reversed issues out', () => {
    const r = run({});
    expect(r.items.map((i) => [i.sku, i.issued, i.returned, i.used, i.value])).toEqual([
      ['CON-1', 40, 5, 35, 1471.75], ['PRJ-1', 2.5, 0, 2.5, null],
    ]);
    expect(r.total).toEqual({ value: 1471.75, items: 2, unpriced: 1 });
    expect(r.byProject).toEqual([
      { projectNumber: 'P-1', projectName: 'Pump', value: 1051.25, items: 2 },
      { projectNumber: null, projectName: null, value: 420.5, items: 1 },
    ]);
  });

  it('narrows to a project or to issues with no project', () => {
    expect(run({ projectNumber: 'P-1' }).items.map((i) => [i.sku, i.used])).toEqual([['CON-1', 25], ['PRJ-1', 2.5]]);
    expect(run({ projectNumber: NO_PROJECT }).items.map((i) => [i.sku, i.used])).toEqual([['CON-1', 10]]);
    expect(run({ category: 'PROJECT_MATERIAL' }).items.map((i) => i.sku)).toEqual(['PRJ-1']);
  });

  it('adds up by recipient, and lists one recipient\u2019s issues and returns newest first', () => {
    const all = run({});
    expect(all.byRecipient).toEqual([
      { recipientId: 'rcp-1', name: 'Sabelo', type: 'WORKER', value: 1051.25, items: 1, issues: 1 },
      { recipientId: null, name: null, type: null, value: 420.5, items: 2, issues: 2 },
    ]);
    expect(all.lines).toBeUndefined();
    expect(run({ recipientId: 'rcp-1' }).lines!.map((l) => [l.type, l.quantity, l.issuedBy])).toEqual([['RETURN', -5, 'Vusi'], ['ISSUE', 30, 'Vusi']]);
    expect(run({ recipientId: NO_RECIPIENT }).items.map((i) => [i.sku, i.used])).toEqual([['CON-1', 10], ['PRJ-1', 2.5]]);
  });

  it('refuses a backwards range', () => {
    expect(() => run({ from: '2026-11-01' })).toThrow();
  });
});
