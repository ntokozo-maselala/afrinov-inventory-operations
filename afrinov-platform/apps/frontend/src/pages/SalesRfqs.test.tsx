// Sales RFQs on screen: the form with typed lines, and the shared list and detail
// pages at Sales' address, with Sales' permission and nothing to award.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPost, mockPatch, auth } = vi.hoisted(() => ({
  mockGet: vi.fn(), mockPost: vi.fn(), mockPatch: vi.fn(), auth: { roles: ['SALES'] as string[] },
}));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: mockPatch, put: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { name: 'Seller', roles: auth.roles } }) }));

const { SalesRfqs, SalesRfqDetail } = await import('./SalesRfqs');
const { NewSalesRfq } = await import('./SalesRfqForm');
const { ToastProvider } = await import('../components/Toast');

const SUPPLIERS = [{ id: 's-1', name: 'Local Steel', active: true, currency: 'ZAR' }, { id: 's-2', name: 'Fasteners', active: true, currency: 'ZAR' }];
const UNITS = [
  { code: 'each', label: 'Each', kind: 'COUNTED', needsReview: false, active: true },
  { code: 'kg', label: 'Kilogram', kind: 'MEASURED', needsReview: false, active: true },
];
const LINES = [
  { id: 'l-1', lineNo: 1, description: '200NB pipes x 3m', unitOfMeasure: 'each', quantity: '24' },
  { id: 'l-2', lineNo: 2, description: 'Mild steel plate', unitOfMeasure: 'kg', quantity: '12.5' },
];
const quoted = (id: string, unit: string, plate: string, subtotal: string) => ({
  supplierId: id, quotedAt: '2026-11-05T00:00:00.000Z', declined: false, currency: 'ZAR', vatRate: 15,
  supplier: SUPPLIERS.find((s) => s.id === id),
  prices: [{ rfqLineId: 'l-1', unitPrice: unit }, { rfqLineId: 'l-2', unitPrice: plate }],
  lineSubtotals: [{ rfqLineId: 'l-1', subtotal: String(Number(unit) * 24) }, { rfqLineId: 'l-2', subtotal: String(Number(plate) * 12.5) }],
  totals: { subtotal, vat: '0.00', net: subtotal, unpricedLines: 0 },
});
const RFQ = {
  id: 'r-1', number: 'AFRI-02A-1404-02-01', status: 'SENT', closed: false, projectNumber: 'AFRI-1404', description: 'Pipe spools', notes: null,
  penaltiesApply: false, issuedAt: '2026-11-05T00:00:00.000Z', closingDate: '2026-11-09T00:00:00.000Z', createdAt: '2026-11-05T08:00:00.000Z',
  lines: LINES, suppliers: [quoted('s-1', '100', '20', '2650.00'), quoted('s-2', '90', '25', '2472.50')],
};

function answer(path: string): unknown {
  if (path === '/suppliers') return SUPPLIERS;
  if (path.startsWith('/projects')) return [{ projectNumber: 'AFRI-1404', name: 'Pipe spools', status: 'PLANNING' }];
  if (path === '/units-of-measure') return UNITS;
  if (path === '/sales-rfqs') return [RFQ];
  if (path === '/sales-rfqs/r-1') return RFQ;
  if (path === '/sales-rfqs/r-1/history') return [];
  throw new Error(`Unexpected GET ${path}`);
}

const renderAt = (url: string) => render(
  <MemoryRouter initialEntries={[url]}>
    <ToastProvider>
      <Routes>
        <Route path="/sales-rfqs" element={<SalesRfqs />} />
        <Route path="/sales-rfqs/new" element={<NewSalesRfq />} />
        <Route path="/sales-rfqs/:id" element={<SalesRfqDetail />} />
      </Routes>
    </ToastProvider>
  </MemoryRouter>,
);

beforeEach(() => {
  auth.roles = ['SALES'];
  mockGet.mockReset().mockImplementation(async (path: string) => answer(path));
  mockPost.mockReset();
  mockPatch.mockReset();
});

describe('Sales RFQ list', () => {
  it('lists from Sales\' routes, and links each to Sales\' page', async () => {
    renderAt('/sales-rfqs');
    const link = await screen.findByRole('link', { name: 'AFRI-02A-1404-02-01' });
    expect(link).toHaveAttribute('href', '/sales-rfqs/r-1');
    expect(mockGet).toHaveBeenCalledWith('/sales-rfqs');
    expect(screen.getByRole('link', { name: /New Sales RFQ/ })).toHaveAttribute('href', '/sales-rfqs/new');
  });

  it('has no Awarded filter, as nothing is awarded', async () => {
    renderAt('/sales-rfqs');
    await screen.findByRole('link', { name: 'AFRI-02A-1404-02-01' });
    expect(screen.queryByRole('option', { name: 'Awarded' })).not.toBeInTheDocument();
  });

  it('offers a senior manager no way to raise one', async () => {
    auth.roles = ['DIRECTOR'];
    renderAt('/sales-rfqs');
    await screen.findByRole('link', { name: 'AFRI-02A-1404-02-01' });
    expect(screen.queryByRole('link', { name: /New Sales RFQ/ })).not.toBeInTheDocument();
  });
});

describe('Sales RFQ form', () => {
  const fillLine = (description: string, quantity: string) => {
    fireEvent.change(screen.getByLabelText('Line 1 description'), { target: { value: description } });
    fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: quantity } });
  };
  const chooseProject = async () => {
    await screen.findByRole('option', { name: /AFRI-1404/ });
    fireEvent.change(screen.getByLabelText(/Project/), { target: { value: 'AFRI-1404' } });
  };

  it('saves typed lines with a unit, not catalogue items', async () => {
    mockPost.mockResolvedValue({ id: 'r-1', number: 'AFRI-02A-1404-02-01' });
    renderAt('/sales-rfqs/new');
    await chooseProject();
    await screen.findByRole('option', { name: 'Kilogram' });
    fillLine('  Mild steel plate ', '12.5');
    fireEvent.change(screen.getByLabelText('Line 1 units'), { target: { value: 'kg' } });
    fireEvent.change(screen.getByLabelText('Add a supplier to ask'), { target: { value: 's-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(mockPost).toHaveBeenCalledWith('/sales-rfqs', expect.objectContaining({
      projectNumber: 'AFRI-1404',
      lines: [{ description: 'Mild steel plate', unitOfMeasure: 'kg', quantity: 12.5 }],
      supplierIds: ['s-1'],
    }));
  });

  it('refuses part of a counted unit, and a line with no quantity, before saving', async () => {
    renderAt('/sales-rfqs/new');
    await chooseProject();
    await screen.findByRole('option', { name: 'Each' });
    fillLine('Bend', '1.5');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/counted in whole numbers/)).toBeInTheDocument();
    fillLine('Bend', '');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/needs a description and a quantity/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('tells someone without Sales\' permission they can\'t raise one', () => {
    auth.roles = ['PROCUREMENT'];
    renderAt('/sales-rfqs/new');
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
  });
});

describe('Sales RFQ page', () => {
  it('compares the quotes on the typed lines, with nothing to award', async () => {
    renderAt('/sales-rfqs/r-1');
    const table = await screen.findByRole('table', { name: 'Quote comparison' });
    expect(table).toHaveTextContent('200NB pipes x 3m');
    expect(table).toHaveTextContent('each');
    expect(screen.queryByRole('button', { name: /^Award to/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Record quote|Edit quote for Local Steel/ })).toBeInTheDocument();
  });

  it('records against Sales\' routes when sending', async () => {
    mockGet.mockImplementation(async (path: string) => (path === '/sales-rfqs/r-1' ? { ...RFQ, status: 'DRAFT', suppliers: [{ supplierId: 's-1', quotedAt: null, declined: false, supplier: SUPPLIERS[0] }] } : answer(path)));
    mockPost.mockResolvedValue({ ...RFQ });
    renderAt('/sales-rfqs/r-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Send to suppliers' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/sales-rfqs/r-1/send', expect.anything()));
  });

  it('shows a senior manager the prices with nothing to change', async () => {
    auth.roles = ['CEO'];
    renderAt('/sales-rfqs/r-1');
    await screen.findByRole('table', { name: 'Quote comparison' });
    expect(screen.queryByRole('button', { name: /Cancel RFQ/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /quote for/ })).not.toBeInTheDocument();
  });
});
