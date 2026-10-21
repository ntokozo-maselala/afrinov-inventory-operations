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
    expect(await codeOf(api.post('/purchase-orders', { supplierId: 'sup-1', lines: [{ materialId: 'mat-9', orderedQty: 1 }] }))).toBeUndefined();
  });
});
