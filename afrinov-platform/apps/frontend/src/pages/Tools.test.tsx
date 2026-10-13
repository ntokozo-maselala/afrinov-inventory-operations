import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockPost, perms } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn(), perms: { lend: true } }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: (p: string) => p === 'tools:lend' && perms.lend }) }));

const { Tools } = await import('./Tools');
const { ToastProvider } = await import('../components/Toast');

const loan = (loanId: string, recipientName: string, out: string) => ({
  loanId, slipId: 's-1', recipientId: `r-${recipientName}`, recipientName, projectNumber: 'AFRI-1325', locationId: 'l-1', locationName: 'Stores',
  quantity: out, out, checkedOutAt: '2026-10-10T08:00:00.000Z', checkedOutBy: 'Vusi', note: null,
});
const TOOLS = [
  { materialId: 'm-drill', sku: 'TL-0002', name: 'Makita Hand Drill', serialNumber: '34322', unitOfMeasure: 'each', inStore: '0', onLoan: '1', owned: '1', locations: [], loans: [loan('t-1', 'Sabelo', '1')] },
  { materialId: 'm-scraper', sku: 'TL-0004', name: 'Scraper', serialNumber: null, unitOfMeasure: 'each', inStore: '8', onLoan: '3', owned: '11',
    locations: [{ locationId: 'l-1', locationName: 'Stores', quantity: '8' }], loans: [loan('t-2', 'Bukho', '2'), loan('t-3', 'Sabelo', '1')] },
  { materialId: 'm-saw', sku: 'TL-0007', name: 'Saw Cutter', serialNumber: null, unitOfMeasure: 'each', inStore: '1', onLoan: '0', owned: '1',
    locations: [{ locationId: 'l-1', locationName: 'Stores', quantity: '1' }], loans: [] },
];

function renderPage() {
  render(<MemoryRouter><ToastProvider><Tools /></ToastProvider></MemoryRouter>);
}
const row = (name: string) => screen.getByText(name).closest('tr')!;

describe('Tools page', () => {
  beforeEach(() => {
    perms.lend = true;
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path === '/tools') return TOOLS;
      if (path.startsWith('/recipients')) return [{ id: 'r-Sabelo', name: 'Sabelo', type: 'WORKER' }, { id: 'r-Bukho', name: 'Bukho', type: 'WORKER' }];
      if (path.startsWith('/projects')) return [{ projectNumber: 'AFRI-1325', name: 'Northam' }];
      return [];
    });
    mockPost.mockReset().mockResolvedValue({});
  });

  it('shows what is in store, who has the rest, and the serial numbers', async () => {
    renderPage();
    await screen.findByText('Scraper');
    expect(within(row('Scraper')).getByText('Bukho')).toBeInTheDocument();
    expect(within(row('Scraper')).getByText(/2 since/)).toBeInTheDocument();
    expect(within(row('Makita Hand Drill')).getByText('TL-0002 · S/N 34322')).toBeInTheDocument();
    expect(screen.getByText('3 of 3 tools · 4 out')).toBeInTheDocument();
  });

  it('filters to the tools out now, and finds a tool by who has it', async () => {
    renderPage();
    await screen.findByText('Scraper');
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'out' } });
    expect(screen.queryByText('Saw Cutter')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'bukho' } });
    expect(screen.getByText('Scraper')).toBeInTheDocument();
    expect(screen.queryByText('Makita Hand Drill')).not.toBeInTheDocument();
  });

  it('checks a tool out from its row to a person, one by default', async () => {
    renderPage();
    await screen.findByText('Saw Cutter');
    fireEvent.click(within(row('Saw Cutter')).getByRole('button', { name: 'Check out' }));
    const drawer = await screen.findByRole('dialog');
    await waitFor(() => expect(within(drawer).getByRole('option', { name: 'Sabelo' })).toBeInTheDocument());
    fireEvent.change(within(drawer).getByLabelText('Checked out to', { exact: false }), { target: { value: 'r-Sabelo' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Check out' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/tools/check-out', {
      recipientId: 'r-Sabelo', projectNumber: undefined, note: undefined, lines: [{ materialId: 'm-saw', locationId: 'l-1', quantity: 1 }],
    }));
    expect(await screen.findByText('Checked out 1 tool to Sabelo')).toBeInTheDocument();
  });

  it('checks a tool in, asking what happened when it was lost', async () => {
    renderPage();
    await screen.findByText('Makita Hand Drill');
    fireEvent.click(within(row('Makita Hand Drill')).getByRole('button', { name: 'Check in' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByLabelText('Back now')).toHaveValue(1);
    fireEvent.change(within(drawer).getByLabelText('Condition'), { target: { value: 'LOST' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Check in' }));
    expect(await within(drawer).findByText('Say what happened to a lost tool.')).toBeInTheDocument();
    fireEvent.change(within(drawer).getByLabelText('What happened', { exact: false }), { target: { value: 'Left on site' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Check in' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/tools/check-in', { lines: [{ loanId: 't-1', quantity: 1, condition: 'LOST', note: 'Left on site' }] }));
  });

  it('offers no check-out or check-in without permission to lend tools', async () => {
    perms.lend = false;
    renderPage();
    await screen.findByText('Scraper');
    expect(screen.queryByRole('button', { name: /Check (out|in)/ })).not.toBeInTheDocument();
  });
});
