// A Projects item is added for one project (ADR-046): which projects an item
// can be added for, and which items a project's RFQ or order line offers.
import { describe, expect, it } from 'vitest';
import { itemGroupLabels, itemsForProject, openProjects } from './projectItems';

const item = (id: string, projectNumber: string | null) => ({ id, projectNumber });
const ITEMS = [item('a', 'AFRI-0413'), item('b', 'AFRI-0413'), item('c', null), item('d', 'AFRI-1402')];

describe('itemsForProject', () => {
  it("offers the project's items, then those with no project yet, never another project's", () => {
    const { own, unassigned, held } = itemsForProject(ITEMS, 'AFRI-0413');
    expect(own.map((m) => m.id)).toEqual(['a', 'b']);
    expect(unassigned.map((m) => m.id)).toEqual(['c']);
    expect(held).toEqual([]);
  });

  it('offers nothing before the project is chosen', () => {
    expect(itemsForProject(ITEMS, '')).toEqual({ own: [], unassigned: [], held: [] });
  });

  it("keeps another project's item a line already holds, in its own group", () => {
    const { own, held } = itemsForProject(ITEMS, 'AFRI-0413', new Set(['d']));
    expect(own.map((m) => m.id)).toEqual(['a', 'b']);
    expect(held.map((m) => m.id)).toEqual(['d']);
  });

  it('heads each group so the buyer can tell them apart', () => {
    expect(itemGroupLabels('AFRI-0413')).toMatchObject({ own: 'For AFRI-0413', unassigned: 'No project yet' });
  });
});

describe('openProjects', () => {
  const PROJECTS = [
    { projectNumber: 'AFRI-0413', name: 'Samancor', status: 'ACTIVE' },
    { projectNumber: 'AFRI-0200', name: 'Old job', status: 'COMPLETED' },
    { projectNumber: 'AFRI-0300', name: 'Called off', status: 'CANCELLED' },
    { projectNumber: 'AFRI-0350', name: 'Inactive', active: false },
  ];

  it('lists the open projects only', () => {
    expect(openProjects(PROJECTS, null).map((p) => p.projectNumber)).toEqual(['AFRI-0413']);
  });

  it("keeps an item's own project listed after it has closed, so editing it doesn't lose it", () => {
    expect(openProjects(PROJECTS, 'AFRI-0200').map((p) => p.projectNumber)).toEqual(['AFRI-0413', 'AFRI-0200']);
    expect(openProjects(PROJECTS, 'AFRI-9999').map((p) => p.projectNumber)).toEqual(['AFRI-0413', 'AFRI-9999']);
  });
});
