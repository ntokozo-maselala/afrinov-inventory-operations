// The mock API follows the server's Stores and Projects rules (materials
// sections roadmap, Phase 1), so frontend-only mode behaves like the real one.
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockApi, resetMockState } from './mockApi';
import type { Material } from '../api/types';

const api = createMockApi();
const codeOf = (p: Promise<unknown>) => p.then(() => undefined, (e: { code?: string }) => e.code);

beforeEach(() => resetMockState());

describe('mock Stores and Projects materials', () => {
  it('keeps a Projects material with its project, and lists by section and project', async () => {
    const created = await api.post<Material>('/materials', { sku: 'AFRI-1325-PIPE', name: 'Pipe', category: 'PROJECT_MATERIAL', unitOfMeasure: 'm', projectNumber: 'AFRI-1325' });
    expect(created).toMatchObject({ section: 'PROJECTS', projectNumber: 'AFRI-1325', project: { projectNumber: 'AFRI-1325' } });
    const forProject = await api.get<Material[]>('/materials?section=PROJECTS&projectNumber=AFRI-1325');
    expect(forProject.map((m) => m.sku)).toEqual(['AFRI-1325-PIPE']);
    const stores = await api.get<Material[]>('/materials?section=STORES');
    expect(stores.every((m) => m.section === 'STORES' && m.category !== 'PROJECT_MATERIAL')).toBe(true);
  });

  it('refuses a Projects material without a project or with Required Stock, and a project on Stores material', async () => {
    expect(await codeOf(api.post('/materials', { sku: 'X1', name: 'X', category: 'PROJECT_MATERIAL', unitOfMeasure: 'm' }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(api.post('/materials', { sku: 'X2', name: 'X', category: 'PROJECT_MATERIAL', unitOfMeasure: 'm', projectNumber: 'AFRI-1325', requiredStock: 5 }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(api.post('/materials', { sku: 'X3', name: 'X', category: 'CONSUMABLES', unitOfMeasure: 'm', projectNumber: 'AFRI-1325' }))).toBe('VALIDATION_ERROR');
  });

  it('assigns a project to an existing Project Material item that has none', async () => {
    const before = await api.get<Material>('/materials/mat-9');
    expect(before).toMatchObject({ section: 'PROJECTS', projectNumber: null });
    expect(await api.patch<Material>('/materials/mat-9', { projectNumber: 'AFRI-1325' })).toMatchObject({ projectNumber: 'AFRI-1325' });
  });
});

describe('mock: project material with no project (Phase 3)', () => {
  it('is refused for issuing and ordering until it has its project', async () => {
    // mat-9 is seeded as Project Material with no project.
    expect(await codeOf(api.post('/inventory-issues', { recipientId: 'rcp-1', lines: [{ materialId: 'mat-9', locationId: 'loc-1', quantity: 1 }] }))).toBe('VALIDATION_ERROR');
    expect(await codeOf(api.post('/purchase-orders', { supplierId: 'sup-1', lines: [{ materialId: 'mat-9', orderedQty: 1 }] }))).toBe('VALIDATION_ERROR');
    await api.patch('/materials/mat-9', { projectNumber: 'AFRI-1325' });
    expect(await codeOf(api.post('/purchase-orders', { supplierId: 'sup-1', projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-9', orderedQty: 1 }] }))).toBeUndefined();
  });
});

describe('mock: project material goes only to its own project (Phase 5)', () => {
  const messageOf = (p: Promise<unknown>) => p.then(() => undefined, (e: { message?: string }) => e.message);
  const issue = (lines: Array<{ materialId: string }>, projectNumber?: string) =>
    api.post('/inventory-issues', { recipientId: 'rcp-1', projectNumber, lines: lines.map((l) => ({ ...l, locationId: 'loc-1', quantity: 1 })) });

  it('refuses it to another project, to none, or alongside another project\'s material', async () => {
    await api.patch('/materials/mat-9', { projectNumber: 'AFRI-1325' });
    const other = await api.post<Material>('/materials', { sku: 'AFRI-1402-PIPE', name: 'Pipe', category: 'PROJECT_MATERIAL', unitOfMeasure: 'm', projectNumber: 'AFRI-1402' });
    expect(await messageOf(issue([{ materialId: 'mat-9' }], 'AFRI-1402'))).toMatch(/is material for project AFRI-1325, so it can't be issued to project AFRI-1402/);
    expect(await messageOf(issue([{ materialId: 'mat-9' }]))).toMatch(/is material for project AFRI-1325: issue it to that project/);
    expect(await messageOf(issue([{ materialId: 'mat-9' }, { materialId: other.id }], 'AFRI-1325'))).toMatch(/two projects/);
  });

  it('refuses a completed project, even for Stores items', async () => {
    await api.patch('/projects/AFRI-1402', { status: 'COMPLETED' });
    expect(await messageOf(issue([{ materialId: 'mat-1' }], 'AFRI-1402'))).toMatch(/Project AFRI-1402 is completed, so no more stock is issued to it/);
  });
});

// Project on the Order Roadmap, Phase 1: the order says which project its
// material is for, as the server does.
describe('mock: project material is ordered for the order’s project', () => {
  const messageOf = (p: Promise<unknown>) => p.then(() => undefined, (e: { message?: string }) => e.message);
  const order = (projectNumber: string | undefined, ...materialIds: string[]) =>
    api.post<{ id: string }>('/purchase-orders', { supplierId: 'sup-1', projectNumber, lines: materialIds.map((materialId) => ({ materialId, orderedQty: 1 })) });

  it('takes any Projects item on a project order, and none on a Stores order', async () => {
    await api.patch('/materials/mat-9', { projectNumber: 'AFRI-1325' });
    const other = await api.post<Material>('/materials', { sku: 'AFRI-1402-PIPE', name: 'Pipe', category: 'PROJECT_MATERIAL', unitOfMeasure: 'm', projectNumber: 'AFRI-1402' });
    expect(await messageOf(order('AFRI-1402', 'mat-9'))).toBeUndefined();
    expect(await messageOf(order('AFRI-1325', 'mat-9', other.id))).toBeUndefined();
    // mat-10 has no project.
    expect(await messageOf(order('AFRI-1325', 'mat-9', 'mat-10'))).toBeUndefined();
    expect(await messageOf(order(undefined, 'mat-9'))).toMatch(/is project material, so it isn't bought on a Stores order/);
  });

  it('moves a Projects item with no project to Stores instead of issuing it', async () => {
    // mat-10 is a Projects item with no project.
    expect(await messageOf(api.post('/inventory-issues', { recipientId: 'rcp-1', projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-10', locationId: 'loc-1', quantity: 1 }] })))
      .toMatch(/has no project, so it isn't issued. Move it to Stores from Project leftovers/);
    expect((await api.get<{ project: null }>('/materials/no-project/leftovers')).project).toBeNull();
    await api.patch('/materials/mat-9', { projectNumber: 'AFRI-1325' });
    expect(await messageOf(api.post('/materials/no-project/leftovers/move', { items: [{ materialId: 'mat-9', category: 'CONSUMABLES' }] }))).toMatch(/is not a Projects item with no project/);
    // Qodo, PR #129: an item listed twice is refused, as the server refuses it.
    expect(await messageOf(api.post('/materials/no-project/leftovers/move', { items: [{ materialId: 'mat-10', category: 'CONSUMABLES' }, { materialId: 'mat-10', category: 'FASTENERS_SLUGS_INSULATION' }] })))
      .toMatch(/listed twice/);
    // Not while it is on an open project order.
    const order = await api.post<{ id: string; number: string }>('/purchase-orders', { supplierId: 'sup-1', projectNumber: 'AFRI-1325', lines: [{ materialId: 'mat-10', orderedQty: 1 }] });
    expect(await messageOf(api.post('/materials/no-project/leftovers/move', { items: [{ materialId: 'mat-10', category: 'CONSUMABLES' }] })))
      .toMatch(new RegExp(`is on ${order.number}, which is still open`));
    await api.post(`/purchase-orders/${order.id}/cancel`, { reason: 'Moving it to Stores' });
    expect(await api.post<{ moved: number }>('/materials/no-project/leftovers/move', { items: [{ materialId: 'mat-10', category: 'CONSUMABLES' }] })).toEqual({ moved: 1 });
    expect((await api.get<Material>('/materials/mat-10')).category).toBe('CONSUMABLES');
    // In the Activity, as the server records it.
    expect((await api.get<Array<{ action: string; entityId: string }>>('/audit?entityType=Material')).find((a) => a.entityId === 'mat-10')).toMatchObject({ action: 'MOVE_TO_STORES' });
  });

  it('keeps Stores items off a project order, and neither kind of order becomes the other (Stores ordering)', async () => {
    await api.patch('/materials/mat-9', { projectNumber: 'AFRI-1325' });
    expect(await messageOf(order('AFRI-1325', 'mat-9', 'mat-1'))).toMatch(/is a Stores item, so it isn't bought for project AFRI-1325/);
    const project = await order('AFRI-1325', 'mat-9');
    expect(await messageOf(api.patch(`/purchase-orders/${project.id}`, { projectNumber: null }))).toMatch(/A project order stays on a project/);
    const stores = await order(undefined, 'mat-1');
    expect(await messageOf(api.patch(`/purchase-orders/${stores.id}`, { projectNumber: 'AFRI-1325' }))).toMatch(/A Stores order has no project/);
    const kind = async (k: string) => (await api.get<Array<{ id: string }>>(`/purchase-orders?kind=${k}`)).map((o) => o.id);
    expect(await kind('stores')).toContain(stores.id);
    expect(await kind('stores')).not.toContain(project.id);
    expect(await kind('projects')).toContain(project.id);
    // As the server: an unknown kind is refused, not read as projects (Qodo, PR #117).
    expect(await messageOf(api.get('/purchase-orders?kind=shelf'))).toMatch(/Invalid purchase order filter/);
  });

  it('refuses an order for a completed project, and submitting a draft whose project has closed since', async () => {
    const pipe = await api.post<Material>('/materials', { sku: 'AFRI-1402-PIPE', name: 'Pipe', category: 'PROJECT_MATERIAL', unitOfMeasure: 'm', projectNumber: 'AFRI-1402' });
    const draft = await order('AFRI-1402', pipe.id);
    await api.patch('/projects/AFRI-1402', { status: 'COMPLETED' });
    expect(await messageOf(order('AFRI-1402', pipe.id))).toMatch(/Project AFRI-1402 is completed, so nothing more is ordered for it/);
    expect(await messageOf(api.post(`/purchase-orders/${draft.id}/submit`))).toMatch(/is completed/);
  });
});

describe('mock: a closed project\'s leftovers move to Stores (Phase 7)', () => {
  const messageOf = (p: Promise<unknown>) => p.then(() => undefined, (e: { message?: string }) => e.message);

  it('lists them, refuses to move them while the project is open, then makes them Stores items', async () => {
    const pipe = await api.post<Material>('/materials', { sku: 'AFRI-1402-PIPE', name: 'Pipe', category: 'PROJECT_MATERIAL', unitOfMeasure: 'm', projectNumber: 'AFRI-1402', unitCost: 50 });
    await api.post('/inventory-adjustments', { materialId: pipe.id, locationId: 'loc-1', quantity: 4, reasonCode: 'OTHER' });
    const move = () => api.post<{ moved: number }>('/projects/AFRI-1402/leftovers/move', { items: [{ materialId: pipe.id, category: 'CONSUMABLES' }] });

    expect(await messageOf(move())).toMatch(/Project AFRI-1402 is still open/);
    await api.patch('/projects/AFRI-1402', { status: 'COMPLETED' });
    const listed = await api.get<{ project: { closed: boolean }; items: Array<{ sku: string; onHand: string; value: number | null }> }>('/projects/AFRI-1402/leftovers');
    expect(listed.project.closed).toBe(true);
    expect(listed.items).toEqual([expect.objectContaining({ sku: 'AFRI-1402-PIPE', onHand: '4', value: 200 })]);

    expect(await move()).toEqual({ moved: 1 });
    expect(await api.get<Material>(`/materials/${pipe.id}`)).toMatchObject({ section: 'STORES', category: 'CONSUMABLES', projectNumber: null });
    expect((await api.get<{ items: unknown[] }>('/projects/AFRI-1402/leftovers')).items).toEqual([]);
  });
});
