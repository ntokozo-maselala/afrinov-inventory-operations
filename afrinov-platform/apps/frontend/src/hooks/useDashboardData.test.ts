// Unit tests for the pure helper functions exported from useDashboardData.
//
// These functions transform raw report data into chart-ready structures.
// They are intentionally pure (no hooks, no side-effects) so they can be
// unit-tested without a React test renderer.
import { describe, expect, it } from 'vitest';
import { buildMovementTrend, buildMovementByType, computeKPITrend } from '../hooks/useDashboardData';

function makeMovement(
  partial: Partial<{
    id: string;
    postedAt: string;
    type: string;
    materialId: string;
    materialSku: string;
    materialName: string;
    category: string;
    locationId: string;
    locationName: string;
    quantity: number;
    actorName: string;
  }>,
) {
  return {
    id: 'm-1',
    postedAt: '2026-09-01T08:00:00Z',
    type: 'RECEIPT',
    materialId: 'mat-1',
    materialSku: 'SKU-001',
    materialName: 'Bolt M8',
    category: 'FASTENERS',
    locationId: 'loc-1',
    locationName: 'Rack A',
    quantity: 10,
    actorName: 'John',
    reasonCode: null,
    reasonNote: null,
    projectNumber: null,
    referenceType: null,
    referenceId: null,
    ...partial,
  };
}

describe('buildMovementTrend', () => {
  it('returns empty array for no movements', () => {
    expect(buildMovementTrend([])).toEqual([]);
  });

  it('groups movements by day and sums absolute quantities', () => {
    const movements = [
      makeMovement({ id: 'a', postedAt: '2026-09-01T08:00:00Z', quantity: 10 }),
      makeMovement({ id: 'b', postedAt: '2026-09-01T14:00:00Z', quantity: 5, type: 'ISSUE' }),
      makeMovement({ id: 'c', postedAt: '2026-09-02T09:00:00Z', quantity: 20 }),
    ];
    const result = buildMovementTrend(movements);
    expect(result).toHaveLength(2);
    expect(result[0]!.label).toBe('09-01');
    expect(result[0]!.value).toBe(15); // |10| + |5|
    expect(result[1]!.label).toBe('09-02');
    expect(result[1]!.value).toBe(20);
  });

  it('sorts results by date ascending', () => {
    const movements = [
      makeMovement({ id: 'b', postedAt: '2026-09-05T08:00:00Z', quantity: 5 }),
      makeMovement({ id: 'a', postedAt: '2026-09-01T08:00:00Z', quantity: 10 }),
    ];
    const result = buildMovementTrend(movements);
    expect(result[0]!.label).toBe('09-01');
    expect(result[1]!.label).toBe('09-05');
  });
});

describe('buildMovementByType', () => {
  it('returns empty array for no movements', () => {
    expect(buildMovementByType([])).toEqual([]);
  });

  it('counts events by movement type', () => {
    const movements = [
      makeMovement({ id: 'a', type: 'RECEIPT', quantity: 10 }),
      makeMovement({ id: 'b', type: 'RECEIPT', quantity: 20 }),
      makeMovement({ id: 'c', type: 'ISSUE', quantity: 5 }),
      makeMovement({ id: 'd', type: 'TRANSFER_IN', quantity: 3 }),
    ];
    const result = buildMovementByType(movements);
    expect(result).toHaveLength(3);
    const receipt = result.find((r) => r.label === 'RECEIPT');
    expect(receipt!.value).toBe(2);
    const issue = result.find((r) => r.label === 'ISSUE');
    expect(issue!.value).toBe(1);
    const transfer = result.find((r) => r.label === 'TRANSFER_IN');
    expect(transfer!.value).toBe(1);
  });
});

describe('computeKPITrend', () => {
  it('handles zero previous as neutral when current is also 0', () => {
    expect(computeKPITrend(0, 0)).toEqual({ direction: 'neutral', delta: '0' });
  });

  it('handles zero previous as up when current > 0', () => {
    expect(computeKPITrend(5, 0)).toEqual({ direction: 'up', delta: '+5' });
  });

  it('rounds small percentage changes (<1%) to neutral', () => {
    // 0.5% change — within the <1% threshold
    expect(computeKPITrend(100.5, 100).direction).toBe('neutral');
    // 0.5% decrease
    expect(computeKPITrend(99.5, 100).direction).toBe('neutral');
    // exactly 1% is NOT within threshold → still 'up'
    expect(computeKPITrend(101, 100).direction).toBe('up');
  });

  it('reports upward trend for >1% increase', () => {
    const result = computeKPITrend(150, 100);
    expect(result.direction).toBe('up');
    expect(result.delta).toBe('+50%');
  });

  it('reports downward trend for >1% decrease', () => {
    const result = computeKPITrend(50, 100);
    expect(result.direction).toBe('down');
    expect(result.delta).toBe('-50%');
  });
});
