// The supplier record brought up to the vendor list in the AFRI-0000_x
// purchase order template (procurement roadmap Phase 1): vendor code, address,
// currency, payment terms, website and services, editing and deactivating.
// Signed in through the auth mock, so the real permission table decides.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet, mockPost, mockPatch, signedIn } = vi.hoisted(() => ({
  mockGet: vi.fn(), mockPost: vi.fn(), mockPatch: vi.fn(), signedIn: { roles: [] as string[] },
}));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost, patch: mockPatch, del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: signedIn.roles } }) }));

const { Suppliers } = await import('./Suppliers');
const { SupplierDetail } = await import('./SupplierDetail');
const { ToastProvider } = await import('../components/Toast');

const HYDAC = {
  id: 's-1', name: 'Hydac', vendorCode: 'V006', contactName: 'Lillian', contactEmail: 'Lillian.Obi@hydac.com', contactPhone: '011 723 9080',
  address: 'Hydac Technology, Edenvale', currency: 'ZAR', paymentTerms: '30 DAYS NETT', website: 'www.hydac.co.za',
  services: 'Hydraulics & Filtrations', active: true,
};
const HS = { id: 's-2', name: 'HS SRL', vendorCode: 'V162', currency: 'EUR', paymentTerms: 'C.O.D', services: 'Hydraulic Power Units', active: true };
const BARE = { id: 's-3', name: 'Local Steel Supplies', currency: 'ZAR', active: true };

let supplier: Record<string, unknown>;

beforeEach(() => {
  supplier = { ...HYDAC };
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/suppliers') return [HYDAC, HS, BARE];
    if (path.startsWith('/suppliers/')) return supplier;
    return [];
  });
  mockPost.mockReset();
  mockPatch.mockReset().mockImplementation(async (_path: string, body: Record<string, unknown>) => {
    supplier = { ...supplier, ...body };
    return supplier;
  });
});

const listPage = (roles: string[]) => {
  signedIn.roles = roles;
  render(<MemoryRouter><ToastProvider><Suppliers /></ToastProvider></MemoryRouter>);
};
const detailPage = (roles: string[]) => {
  signedIn.roles = roles;
  render(
    <MemoryRouter initialEntries={['/suppliers/s-1']}>
      <ToastProvider><Routes><Route path="/suppliers/:id" element={<SupplierDetail />} /></Routes></ToastProvider>
    </MemoryRouter>,
  );
};

describe('Suppliers list', () => {
  it('shows vendor code, services, payment terms and a foreign currency', async () => {
    listPage(['VIEWER']);
    const row = (await screen.findByText('HS SRL')).closest('tr')!;
    expect(within(row).getByText('V162')).toBeInTheDocument();
    expect(within(row).getByText('Hydraulic Power Units')).toBeInTheDocument();
    expect(within(row).getByText('C.O.D')).toBeInTheDocument();
    expect(within(row).getByText('EUR')).toBeInTheDocument();
    expect(within(screen.getByText('Hydac').closest('tr')!).queryByText('ZAR')).not.toBeInTheDocument();
  });

  it('finds a supplier by vendor code or by what they supply', async () => {
    listPage(['VIEWER']);
    await screen.findByText('Hydac');
    const search = screen.getByLabelText('Search suppliers');
    fireEvent.change(search, { target: { value: 'v162' } });
    expect(screen.getByText('HS SRL')).toBeInTheDocument();
    expect(screen.queryByText('Hydac')).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'filtration' } });
    expect(screen.getByText('Hydac')).toBeInTheDocument();
    expect(screen.queryByText('HS SRL')).not.toBeInTheDocument();
  });

  it('adds a supplier with the purchasing fields, leaving blank ones out', async () => {
    mockPost.mockResolvedValue({ id: 's-9', name: 'Fast Flame' });
    listPage(['PROCUREMENT']);
    await screen.findByText('Hydac');
    fireEvent.click(screen.getByRole('button', { name: 'Add supplier' }));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Fast Flame' } });
    fireEvent.change(screen.getByLabelText(/Vendor code/), { target: { value: 'V003' } });
    fireEvent.change(screen.getByLabelText(/Payment terms/), { target: { value: 'C.O.D' } });
    fireEvent.change(screen.getByLabelText(/Services and supplies/), { target: { value: 'Laser Cut & Machining' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save supplier' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(mockPost).toHaveBeenCalledWith('/suppliers', expect.objectContaining({
      name: 'Fast Flame', vendorCode: 'V003', currency: 'ZAR', paymentTerms: 'C.O.D', services: 'Laser Cut & Machining', address: undefined, website: undefined,
    }));
  });

  it('refuses a vendor code with spaces or symbols before sending it', async () => {
    listPage(['PROCUREMENT']);
    await screen.findByText('Hydac');
    fireEvent.click(screen.getByRole('button', { name: 'Add supplier' }));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Fast Flame' } });
    fireEvent.change(screen.getByLabelText(/Vendor code/), { target: { value: 'V 003/A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save supplier' }));
    expect(await screen.findByText(/letters, digits and dashes only/)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('Supplier detail', () => {
  it('shows the purchasing details and loads only this supplier', async () => {
    detailPage(['VIEWER']);
    expect(await screen.findByRole('heading', { name: 'Hydac' })).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/suppliers/s-1');
    for (const text of ['30 DAYS NETT', 'Hydac Technology, Edenvale']) expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'www.hydac.co.za' })).toHaveAttribute('href', 'https://www.hydac.co.za');
  });

  it('a viewer cannot edit or deactivate', async () => {
    detailPage(['VIEWER']);
    await screen.findByRole('heading', { name: 'Hydac' });
    for (const name of ['Edit', 'Deactivate']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('a store controller edits a supplier; clearing a field sends null', async () => {
    detailPage(['STORE_CONTROLLER']);
    await screen.findByRole('heading', { name: 'Hydac' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText(/Vendor code/)).toHaveValue('V006');
    fireEvent.change(screen.getByLabelText(/Payment terms/), { target: { value: 'C.O.D' } });
    fireEvent.change(screen.getByLabelText(/Website/), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/Currency/), { target: { value: 'EUR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalled());
    expect(mockPatch).toHaveBeenCalledWith('/suppliers/s-1', expect.objectContaining({
      name: 'Hydac', vendorCode: 'V006', paymentTerms: 'C.O.D', website: null, currency: 'EUR',
    }));
    expect(await screen.findByText('Hydac saved')).toBeInTheDocument();
  });

  it('asks before deactivating, then shows Reactivate', async () => {
    detailPage(['PROCUREMENT']);
    await screen.findByRole('heading', { name: 'Hydac' });
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(screen.getAllByText(/no stock can be received from them/).length).toBeGreaterThan(0);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/suppliers/s-1', { active: false }));
    expect(await screen.findByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('offers to add a missing vendor code', async () => {
    supplier = { ...BARE, id: 's-1' };
    detailPage(['PROCUREMENT']);
    await screen.findByRole('heading', { name: 'Local Steel Supplies' });
    fireEvent.click(screen.getByRole('button', { name: 'Add one' }));
    expect(screen.getByLabelText(/Vendor code/)).toHaveValue('');
  });

  it('says when the supplier does not exist', async () => {
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/suppliers/')) throw { code: 'NOT_FOUND', message: 'Supplier not found' };
      return [];
    });
    detailPage(['VIEWER']);
    expect(await screen.findByText('Supplier not found')).toBeInTheDocument();
  });
});
