// Stores and Projects stock and reports, apart (materials sections roadmap,
// Phase 4): the Stock page's two views, the stock report's projects table, and
// the mock API's stock status and stock value.
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

describe('Stock: Stores and Projects views', () => {
  beforeEach(() => { mockGet.mockReset().mockImplementation(async (path: string) => (path === '/locations' ? [] : ROWS)); });

  it('opens on Stores, with its Required threshold and status', async () => {
    stockPage();
    await screen.findByText('DISC');
    expect(skus()).toEqual(['DISC']);
    expect(screen.getByRole('tab', { name: /Stores/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('table')).getByText('Required')).toBeInTheDocument();
  });

  it('shows Projects stock project by project, completed projects included, without a Required threshold column', async () => {
    stockPage();
    await screen.findByText('DISC');
    fireEvent.click(screen.getByRole('tab', { name: /Projects/ }));
    expect(skus()).toEqual(['1369-PIPE', '1402-BOLT', 'OLD-PLATE']);
    const table = screen.getByRole('table');
    expect(within(table).queryByText('Required')).not.toBeInTheDocument();
    expect(within(within(table).getByText('1369-PIPE').closest('tr')!).getByText('Completed')).toBeInTheDocument();
    expect(within(within(table).getByText('OLD-PLATE').closest('tr')!).getByText('No project yet')).toBeInTheDocument();
  });

  it('leaves no Stores-only filter on, unseen, after switching to Projects', async () => {
    stockPage();
    await screen.findByText('DISC');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'out' } });
    fireEvent.click(screen.getByRole('tab', { name: /Projects/ }));
    expect(skus()).toEqual(['1369-PIPE', '1402-BOLT', 'OLD-PLATE']);
    fireEvent.click(screen.getByRole('tab', { name: /Stores/ }));
    expect(screen.getByLabelText('Status')).toHaveValue('');
  });

  it('ignores a stock-status filter in a Projects link', async () => {
    stockPage('/stock?section=PROJECTS&status=out');
    await screen.findByText('1369-PIPE');
    expect(skus()).toEqual(['1369-PIPE', '1402-BOLT', 'OLD-PLATE']);
  });

  it('keeps a linked project with no stock shown in the Project field, so it can be cleared', async () => {
    stockPage('/stock?section=PROJECTS&project=1500');
    await screen.findByText('No stock matches your filters');
    expect(screen.getByLabelText('Project')).toHaveValue('1500');
    fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
    expect(await screen.findByText('1369-PIPE')).toBeInTheDocument();
    expect(screen.getByLabelText('Project')).toHaveValue('');
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
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'URGENT' } });
    fireEvent.click(screen.getByRole('tab', { name: /Projects/ }));
    expect(where()).toBe('?section=PROJECTS');
  });

  it('keeps the filters when the tab already open is clicked', async () => {
    stockPage('/stock?section=PROJECTS&project=1369');
    await screen.findByText('1369-PIPE');
    fireEvent.click(screen.getByRole('tab', { name: /Projects/ }));
    expect(skus()).toEqual(['1369-PIPE']);
    expect(screen.getByLabelText('Project')).toHaveValue('1369');
  });

  it('opens on one project from the link', async () => {
    stockPage('/stock?section=PROJECTS&project=1369');
    await screen.findByText('1369-PIPE');
    expect(skus()).toEqual(['1369-PIPE']);
    expect(screen.getByLabelText('Project')).toHaveValue('1369');
  });
});

describe('Month-end report: project material by project', () => {
  it('lists each project with its leftovers, completed ones marked', async () => {
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
    const section = (await screen.findByRole('heading', { name: 'Project material by project' })).closest('section')!;
    expect(within(section).getByText('1369 · Plant upgrade')).toBeInTheDocument();
    expect(within(section).getByText('(completed)')).toBeInTheDocument();
    // Every project shows its status, not only closed ones.
    expect(within(section).getByText('(on hold)')).toBeInTheDocument();
    expect(within(section).getByText('No project yet')).toBeInTheDocument();
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
