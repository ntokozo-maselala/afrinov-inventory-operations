// Stores and Projects stock and reports, apart (materials sections roadmap,
// Phase 4). Project material goes from the supplier straight to site (Stores
// and Procurement Separation Roadmap), so the Stock page shows Stores stock only
// and lists project material still in the store by project; the stock report
// lists only projects with some left; the mock API's stock status and value.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/client')>(),
  api: { get: mockGet },
}));
vi.mock('../components/RoleGuard', () => ({ RoleGuard: () => null }));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: ['STORE_CONTROLLER'] } }) }));
vi.mock('../api/exportMonthEnd', () => ({ downloadMonthEnd: vi.fn(), downloadMonthEndPdf: vi.fn() }));

const { Stock } = await import('./Stock');
const { MonthEnd } = await import('./MonthEnd');
const { ToastProvider } = await import('../components/Toast');
const { createMockApi, resetMockState } = await import('../mock/mockApi');

const row = (sku: string, category: string, quantity: string, over: Record<string, unknown> = {}) => ({
  materialId: `m-${sku}`, materialSku: sku, materialName: `Item ${sku}`, category, locationId: 'l-1', locationName: 'A-1',
  unitOfMeasure: 'each', quantity, requiredStock: '10', stockStatus: 'OK', percentOfRequired: 100, projectNumber: null, project: null, ...over,
});
const ROWS = [
  row('DISC', 'CONSUMABLES', '30'),
  row('1402-BOLT', 'PROJECT_MATERIAL', '5', { requiredStock: '0', stockStatus: 'NOT_SET', projectNumber: '1402', project: { name: 'Silo', status: 'ACTIVE' } }),
  row('1369-PIPE', 'PROJECT_MATERIAL', '3', { requiredStock: '0', stockStatus: 'NOT_SET', projectNumber: '1369', project: { name: 'Plant upgrade', status: 'COMPLETED' } }),
  row('OLD-PLATE', 'PROJECT_MATERIAL', '2', { requiredStock: '0', stockStatus: 'NOT_SET' }),
];

const stockPage = (url = '/stock') => render(<MemoryRouter initialEntries={[url]}><ToastProvider><Stock /></ToastProvider></MemoryRouter>);
const skus = () => within(screen.getByRole('table')).getAllByRole('link').map((a) => a.textContent);

const STOCK_VALUE = {
  currency: 'ZAR', categories: [], total: { items: 0, itemsInStock: 0, value: 0, unpriced: 0 },
  status: { URGENT: 0, WARNING: 0, OK: 0, NOT_SET: 0, outOfStock: 0 },
  projects: [
    { projectNumber: '1369', name: 'Plant upgrade', status: 'COMPLETED', items: 1, itemsInStock: 1, value: 300, unpriced: 0 },
    { projectNumber: '1402', name: 'Silo', status: 'ACTIVE', items: 2, itemsInStock: 1, value: 50, unpriced: 0 },
    { projectNumber: null, name: null, status: null, items: 1, itemsInStock: 1, value: 0, unpriced: 2 },
    { projectNumber: '1500', name: 'Bridge', status: 'ACTIVE', items: 4, itemsInStock: 0, value: 0, unpriced: 0 },
  ],
};

describe('Stock: the store\u2019s stock, Stores only', () => {
  beforeEach(() => {
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path === '/locations') return [];
      if (path === '/reports/stock-value') return STOCK_VALUE;
      return ROWS;
    });
  });

  it('lists Stores stock only, with its Required threshold and status, and no Stores/Projects tabs', async () => {
    stockPage();
    await screen.findByText('DISC');
    expect(skus()).toEqual(['DISC']);
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Project')).not.toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Required')).toBeInTheDocument();
    expect(screen.getByText('1 of 1 lines')).toBeInTheDocument();
  });

  it('lists project material still in the store by project, apart from the stock', async () => {
    stockPage();
    await screen.findByText('DISC');
    // A closed project's: leftovers to move to Stores.
    expect(await screen.findByRole('link', { name: '1 item to move to Stores' })).toHaveAttribute('href', '/projects/1369/leftovers');
    // An open project's, and one with no project yet: to its project's items on Materials.
    expect(screen.getByRole('link', { name: 'Project 1402 · Silo: 1 item' })).toHaveAttribute('href', '/materials?section=PROJECTS&project=1402');
    expect(screen.getByRole('link', { name: 'No project yet: 1 item' })).toHaveAttribute('href', '/materials?section=PROJECTS&project=none');
    // Not a project with nothing in the store.
    expect(screen.queryByText(/Bridge/)).not.toBeInTheDocument();
  });

  it('opens an older Projects link on the store\u2019s stock', async () => {
    stockPage('/stock?section=PROJECTS&project=1369');
    await screen.findByText('Item DISC');
    expect(screen.queryByText('1369-PIPE')).not.toBeInTheDocument();
  });

  it('keeps the address in step with the filters, so cleared ones do not come back', async () => {
    function Where() { return <output data-testid="where">{useLocation().search}</output>; }
    render(<MemoryRouter initialEntries={['/stock?q=DISC&status=OK']}><ToastProvider><Stock /><Where /></ToastProvider></MemoryRouter>);
    await screen.findByText('DISC');
    const where = () => screen.getByTestId('where').textContent;
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'CONSUMABLES' } });
    expect(where()).toContain('category=CONSUMABLES');
    fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
    expect(where()).toBe('');
  });
});

describe('Stock report: project material still in the store', () => {
  it('lists only projects with some left, completed ones marked', async () => {
    mockGet.mockReset().mockResolvedValue({
      month: '2026-09', from: '2026-09-01', to: '2026-09-30', generatedAt: '2026-10-01T00:00:00Z', currency: 'ZAR',
      bands: { urgentBelowPercent: 20, warningBelowPercent: 40 }, categories: [],
      projects: [
        { projectNumber: '1369', name: 'Plant upgrade', status: 'COMPLETED', items: 1, itemsInStock: 1, value: 300 },
        { projectNumber: '1402', name: 'Silo', status: 'ON_HOLD', items: 1, itemsInStock: 1, value: 50 },
        { projectNumber: null, name: null, status: null, items: 1, itemsInStock: 0, value: 0 },
      ],
      total: { items: 0, itemsInStock: 0, value: 0, urgent: 0, warning: 0, usedValue: 0 },
    });
    render(<MemoryRouter initialEntries={['/reports/stock-report?month=2026-09']}><ToastProvider><MonthEnd /></ToastProvider></MemoryRouter>);
    const section = (await screen.findByRole('heading', { name: 'Project material still in the store' })).closest('section')!;
    expect(within(section).getByText('1369 · Plant upgrade')).toBeInTheDocument();
    expect(within(section).getByText('(completed)')).toBeInTheDocument();
    // Every project shows its status, not only closed ones.
    expect(within(section).getByText('(on hold)')).toBeInTheDocument();
    // Projects material with nothing in the store isn't listed.
    expect(within(section).queryByText('No project yet')).not.toBeInTheDocument();
  });

  it('has no projects table when no project material is left in the store', async () => {
    mockGet.mockReset().mockResolvedValue({
      month: '2026-11', from: '2026-11-01', to: '2026-11-30', generatedAt: '2026-12-01T00:00:00Z', currency: 'ZAR',
      bands: { urgentBelowPercent: 20, warningBelowPercent: 40 }, categories: [],
      projects: [{ projectNumber: '1500', name: 'Bridge', status: 'ACTIVE', items: 4, itemsInStock: 0, value: 0 }],
      total: { items: 0, itemsInStock: 0, value: 0, urgent: 0, warning: 0, usedValue: 0 },
    });
    render(<MemoryRouter initialEntries={['/reports/stock-report?month=2026-11']}><ToastProvider><MonthEnd /></ToastProvider></MemoryRouter>);
    await screen.findByText(/2026/);
    expect(screen.queryByRole('heading', { name: 'Project material still in the store' })).not.toBeInTheDocument();
  });
});

describe('mock API: re-ordering is for Stores', () => {
  const api = createMockApi();
  beforeEach(() => resetMockState());

  it('leaves Projects material out of stock status, and splits the stock value by section and project', async () => {
    const status = await api.get<Array<{ category: string }>>('/reports/stock-status');
    expect(status.some((r) => r.category === 'PROJECT_MATERIAL')).toBe(false);
    const v = await api.get<{ sections: Record<'STORES' | 'PROJECTS', { items: number }>; projects: Array<{ projectNumber: string | null; items: number }>; total: { items: number } }>('/reports/stock-value');
    expect(v.sections.PROJECTS.items).toBeGreaterThan(0);
    expect(v.total.items).toBe(v.sections.STORES.items + v.sections.PROJECTS.items);
    expect(v.projects.reduce((a, p) => a + p.items, 0)).toBe(v.sections.PROJECTS.items);
  });

  it('applies a category and the section together in stock status', async () => {
    expect(await api.get('/reports/stock-status?category=PROJECT_MATERIAL')).toEqual([]);
  });
});
