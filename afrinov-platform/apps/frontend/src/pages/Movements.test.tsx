import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => true }) }));

const { Movements } = await import('./Movements');
const { ToastProvider } = await import('../components/Toast');

const row = (n: number) => ({
  id: `tx-${n}`, cursor: `2026-10-${String(30 - (n % 28)).padStart(2, '0')}T08:00:00.000Z_tx-${n}`, postedAt: '2026-10-05T08:00:00.000Z', type: 'ISSUE',
  materialId: 'm-1', materialSku: `SKU-${n}`, materialName: 'Cutting disc', unitOfMeasure: 'each', locationId: 'l-1', locationName: 'Boiler Shop',
  quantity: '-1', actorId: 'u-1', actorName: 'Vusi',
});

function renderAt(url: string, pages: Array<ReturnType<typeof row>[]> = [[row(1)]]) {
  let page = 0;
  mockGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/inventory-transactions/summary')) return { total: 205, byType: { ISSUE: 150, RECEIPT: 40, ADJUSTMENT: 15 } };
    if (path.startsWith('/inventory-transactions/actors')) return [{ id: 'u-1', name: 'Vusi' }];
    if (path.startsWith('/inventory-transactions')) return pages[page++] ?? [];
    if (path.startsWith('/locations')) return [{ id: 'l-1', name: 'Boiler Shop' }];
    if (path.startsWith('/materials')) return [];
    return [];
  });
  render(<MemoryRouter initialEntries={[url]}><ToastProvider><Movements /></ToastProvider></MemoryRouter>);
}

const listCalls = () => mockGet.mock.calls.map((c) => c[0] as string).filter((p) => /^\/inventory-transactions\?/.test(p));

describe('Movements page', () => {
  beforeEach(() => { mockGet.mockReset(); });

  it('shows this month by default, with totals for the whole range from the server', async () => {
    renderAt('/movements');
    const now = new Date();
    const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    await screen.findByText('SKU-1');
    expect(listCalls()[0]).toContain(`from=${first}`);
    expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe(first);
    expect(screen.getByText('205')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('1 of 205 shown')).toBeInTheDocument();
  });

  it('sends the filters in the address to the list and the totals', async () => {
    renderAt('/movements?from=2026-09-01&to=2026-09-30&type=ISSUE&locationId=l-1&actorId=u-1&q=disc');
    await screen.findByText('SKU-1');
    const expected = 'from=2026-09-01&to=2026-09-30&type=ISSUE&locationId=l-1&actorId=u-1&q=disc';
    expect(listCalls()[0]).toBe(`/inventory-transactions?${expected}&limit=100`);
    expect(mockGet).toHaveBeenCalledWith(`/inventory-transactions/summary?${expected}`);
  });

  it('loads the next page after the last row shown, and stops when a page is short', async () => {
    const full = Array.from({ length: 100 }, (_, i) => row(i + 1));
    renderAt('/movements?from=2026-10-01&to=2026-10-31', [full, [row(101)]]);
    await screen.findByText('SKU-100');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('SKU-101');
    expect(listCalls()[1]).toBe(`/inventory-transactions?from=2026-10-01&to=2026-10-31&limit=100&before=${encodeURIComponent(full[99]!.cursor)}`);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('says so when the start date is after the end date, and asks the server nothing', async () => {
    renderAt('/movements?from=2026-10-31&to=2026-10-01');
    expect(await screen.findByText('The start date is after the end date.')).toBeInTheDocument();
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(listCalls()).toHaveLength(0);
  });
});
