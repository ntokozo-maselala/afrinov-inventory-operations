// Matching a Procurement RFQ's lines to what Sales asked for, for the savings
// report: a dropdown for buyers, the link as it stands for others, and nothing
// on Sales' own RFQs.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPut, auth } = vi.hoisted(() => ({
  mockGet: vi.fn(), mockPut: vi.fn(), auth: { roles: ['PROCUREMENT'] as string[] },
}));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), put: mockPut, del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Buyer', roles: auth.roles } }) }));

const { RfqDetail } = await import('./RfqDetail');
const { SalesRfqDetail } = await import('./SalesRfqs');
const { ToastProvider } = await import('../components/Toast');

const PIPES = { id: 'sl-1', lineNo: 1, description: '200NB pipes x 3m', unitOfMeasure: 'each', quantity: '24', rfq: { number: 'AFRI-02A-1404-02-01', status: 'SENT' } };
const PLATE = { id: 'sl-2', lineNo: 2, description: 'Mild steel plate', unitOfMeasure: 'kg', quantity: '12.5', rfq: { number: 'AFRI-02A-1404-02-01', status: 'SENT' } };
const line = (id: string, lineNo: number, quantity: string, unitOfMeasure: string, salesRfqLine: unknown = null) => ({
  id, lineNo, materialId: `m-${lineNo}`, quantity, salesRfqLine, material: { sku: `SKU-${lineNo}`, name: `Item ${lineNo}`, unitOfMeasure },
});
const rfq = (lines: unknown[], status = 'SENT') => ({
  id: 'r-1', number: 'AFRI-02A-1404-02-02', status, closed: false, projectNumber: 'AFRI-1404', description: 'Pipe spools', notes: null,
  penaltiesApply: false, issuedAt: '2026-11-05T00:00:00.000Z', closingDate: '2026-11-09T00:00:00.000Z', createdAt: '2026-11-05T08:00:00Z',
  lines, suppliers: [],
});
let current: unknown;
let offered: unknown;

beforeEach(() => {
  auth.roles = ['PROCUREMENT'];
  current = rfq([line('l-1', 1, '24', 'each'), line('l-2', 2, '12.5', 'kg')]);
  offered = [PIPES, PLATE];
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/rfqs/r-1' || path === '/sales-rfqs/r-1') return current;
    if (path === '/rfqs/r-1/sales-lines') {
      if (offered instanceof Error) throw offered;
      return offered;
    }
    return [];
  });
  mockPut.mockReset().mockImplementation(async () => current);
});

const page = () => render(
  <MemoryRouter initialEntries={['/rfqs/r-1']}>
    <ToastProvider><Routes><Route path="/rfqs/:id" element={<RfqDetail />} /></Routes></ToastProvider>
  </MemoryRouter>,
);
const pick = async (lineNo: number) => {
  await screen.findAllByRole('option', { name: /line 1: 200NB/ });
  return screen.findByRole('combobox', { name: `Sales line for line ${lineNo}` });
};

describe('Linking a line to its Sales line', () => {
  it('saves the Sales line a buyer picks, and shows what was asked for without a price', async () => {
    page();
    const select = await pick(1);
    expect(within(select).getByRole('option', { name: 'AFRI-02A-1404-02-01 line 1: 200NB pipes x 3m (24 each)' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'sl-1' } });
    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('/rfqs/r-1/lines/l-1/sales-line', { salesRfqLineId: 'sl-1' }));
    expect(await screen.findByText('Line 1 linked')).toBeInTheDocument();
  });

  it('takes a link off when Not linked is picked', async () => {
    current = rfq([line('l-1', 1, '24', 'each', PIPES)]);
    page();
    const select = await pick(1);
    await waitFor(() => expect(select).toHaveValue('sl-1'));
    // Spelled out, as the dropdown is too narrow to show it all.
    expect(screen.getByText('200NB pipes x 3m (24 each)')).toBeInTheDocument();
    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('/rfqs/r-1/lines/l-1/sales-line', { salesRfqLineId: null }));
  });

  it('says what went wrong, and keeps the link it has, when saving fails', async () => {
    current = rfq([line('l-1', 1, '24', 'each', PIPES)]);
    mockPut.mockRejectedValue({ code: 'VALIDATION_ERROR', message: "That isn't a line of a Sales RFQ sent for AFRI-1404" });
    page();
    const select = await pick(1);
    fireEvent.change(select, { target: { value: 'sl-2' } });
    expect(await screen.findByText(/isn't a line of a Sales RFQ/)).toBeInTheDocument();
    expect(select).toHaveValue('sl-1');
  });

  it('notes when the quantity or unit differs from what Sales asked for', async () => {
    current = rfq([line('l-1', 1, '20', 'each', PIPES), line('l-2', 2, '12.5', 'm', PLATE)]);
    page();
    await screen.findByRole('table', { name: 'RFQ lines' });
    // About this RFQ only: another RFQ may make up the rest (Qodo, PR #159).
    expect(await screen.findByText("Sales asked for 24 each; this RFQ's lines come to 20 each")).toBeInTheDocument();
    expect(screen.getByText(/Sales asked for 12[.,]5 kg; this line is in m/)).toBeInTheDocument();
  });

  it('adds up the lines sharing a Sales line before noting a difference', async () => {
    current = rfq([line('l-1', 1, '20', 'each', PIPES), line('l-2', 2, '4', 'each', PIPES)]);
    page();
    await screen.findByRole('table', { name: 'RFQ lines' });
    expect(screen.queryByText(/Sales asked for \d/)).not.toBeInTheDocument();
  });

  it('keeps showing a link whose Sales RFQ was cancelled, marked so', async () => {
    const gone = { ...PIPES, id: 'sl-9', rfq: { ...PIPES.rfq, status: 'CANCELLED' } };
    current = rfq([line('l-1', 1, '24', 'each', gone)]);
    page();
    const select = await pick(1);
    await waitFor(() => expect(select).toHaveValue('sl-9'));
    expect(screen.getByText('Sales RFQ cancelled')).toBeInTheDocument();
  });

  it('says when Sales has sent nothing for the project', async () => {
    offered = [];
    page();
    expect((await screen.findAllByRole('option', { name: 'No Sales RFQ sent for this project' })).length).toBe(2);
    expect(screen.getByRole('combobox', { name: 'Sales line for line 1' })).toBeDisabled();
  });

  it('says so when the Sales lines cannot be loaded, offering no dropdown', async () => {
    offered = new Error('down');
    page();
    expect(await screen.findByText('Sales lines could not be loaded')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Sales line for line/ })).not.toBeInTheDocument();
  });

  it('shows a senior manager the link with nothing to change, and asks for no Sales lines', async () => {
    auth.roles = ['DIRECTOR'];
    current = rfq([line('l-1', 1, '24', 'each', PIPES), line('l-2', 2, '1', 'kg')]);
    page();
    const table = await screen.findByRole('table', { name: 'RFQ lines' });
    expect(within(table).getByText('AFRI-02A-1404-02-01 line 1: 200NB pipes x 3m (24 each)')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Sales line for line/ })).not.toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalledWith('/rfqs/r-1/sales-lines');
  });

  it('offers no dropdown once the RFQ is cancelled', async () => {
    current = rfq([line('l-1', 1, '24', 'each', PIPES)], 'CANCELLED');
    page();
    const table = await screen.findByRole('table', { name: 'RFQ lines' });
    expect(within(table).getByText(/200NB pipes/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Sales line for line/ })).not.toBeInTheDocument();
  });

  it("isn't on Sales' own RFQs", async () => {
    auth.roles = ['SALES'];
    current = { ...rfq([{ id: 'l-1', lineNo: 1, description: 'Bend', unitOfMeasure: 'each', quantity: '1' }]), suppliers: [] };
    render(
      <MemoryRouter initialEntries={['/sales-rfqs/r-1']}>
        <ToastProvider><Routes><Route path="/sales-rfqs/:id" element={<SalesRfqDetail />} /></Routes></ToastProvider>
      </MemoryRouter>,
    );
    const table = await screen.findByRole('table', { name: 'RFQ lines' });
    expect(within(table).queryByText('Sales line')).not.toBeInTheDocument();
  });
});
