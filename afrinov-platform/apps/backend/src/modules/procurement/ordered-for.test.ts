import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.fn();
vi.mock('../../shared/db.js', () => ({ prisma: { purchaseOrderLine: { findMany } } }));

const { groupOrderedFor, listOrderedFor, ORDERED_STATUSES } = await import('./ordered-for.js');

const line = (materialId: string, projectNumber: string | null, name: string | null = `Project ${projectNumber}`) => ({
  materialId, purchaseOrder: { projectNumber, project: projectNumber && name ? { name } : null },
});

describe('groupOrderedFor', () => {
  it('lists each project an item was ordered for once, in project number order', () => {
    expect(groupOrderedFor([
      line('bar', 'AFRI-1402'), line('bar', 'AFRI-1325'), line('bar', 'AFRI-1402'), line('plate', 'AFRI-1325'),
    ])).toEqual([
      { materialId: 'bar', projects: [{ projectNumber: 'AFRI-1325', name: 'Project AFRI-1325' }, { projectNumber: 'AFRI-1402', name: 'Project AFRI-1402' }] },
      { materialId: 'plate', projects: [{ projectNumber: 'AFRI-1325', name: 'Project AFRI-1325' }] },
    ]);
  });

  it('sorts project numbers as numbers, not text', () => {
    const [item] = groupOrderedFor([line('bar', 'AFRI-1000'), line('bar', 'AFRI-999')]);
    expect(item!.projects.map((p) => p.projectNumber)).toEqual(['AFRI-999', 'AFRI-1000']);
  });

  it('leaves out lines on Stores orders, which have no project', () => {
    expect(groupOrderedFor([line('disc', null)])).toEqual([]);
  });
});

describe('listOrderedFor', () => {
  beforeEach(() => findMany.mockReset().mockResolvedValue([line('bar', 'AFRI-1325')]));

  it('reads project orders that were raised and not cancelled', async () => {
    expect(await listOrderedFor()).toEqual([{ materialId: 'bar', projects: [{ projectNumber: 'AFRI-1325', name: 'Project AFRI-1325' }] }]);
    expect(findMany.mock.calls[0]![0].where).toEqual({ purchaseOrder: { projectNumber: { not: null }, status: { in: ORDERED_STATUSES } } });
    expect(ORDERED_STATUSES).not.toContain('DRAFT');
    expect(ORDERED_STATUSES).not.toContain('CANCELLED');
    expect(ORDERED_STATUSES).toContain('CLOSED');
  });
});
