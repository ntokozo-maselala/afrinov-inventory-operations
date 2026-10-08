import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));

vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));

const { ReceiveStock } = await import('./ReceiveStock');
const { ToastProvider } = await import('../components/Toast');

function renderPage() {
  mockGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/suppliers')) return [
      { id: 's-1', name: 'Hydroscand', active: true },
      { id: 's-old', name: 'Closed Ltd', active: false },
    ];
    if (path.startsWith('/materials')) return [
      { id: 'm-1', sku: 'DISC-115', name: 'Cutting disc', unitOfMeasure: 'each', active: true },
      { id: 'm-2', sku: 'GLOVE-L', name: 'Welding gloves', unitOfMeasure: 'pair', active: true },
      { id: 'm-old', sku: 'OLD', name: 'Retired item', unitOfMeasure: 'each', active: false },
    ];
    if (path.startsWith('/locations')) return [{ id: 'l-1', name: 'A-1', active: true }, { id: 'l-2', name: 'B-2', active: true }];
    if (path.startsWith('/reports/current-stock')) return [
      { materialId: 'm-1', locationId: 'l-1', locationName: 'A-1', quantity: '3' },
      { materialId: 'm-1', locationId: 'l-2', locationName: 'B-2', quantity: '8' },
    ];
    return [];
  });
  render(<MemoryRouter><ToastProvider><ReceiveStock /></ToastProvider></MemoryRouter>);
}

async function ready() {
  await waitFor(() => expect(screen.getByRole('option', { name: 'Hydroscand' })).toBeInTheDocument());
  await waitFor(() => expect(screen.getByLabelText('Item 1')).toBeEnabled());
}

/** Type into an item search box and pick the first match. */
function choose(label: string, query: string) {
  const input = screen.getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: query } });
  fireEvent.mouseDown(within(screen.getByRole('listbox')).getAllByRole('option')[0]!);
}

describe('ReceiveStock page', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset().mockResolvedValue({ goodsReceiptId: 'gr-1', number: 'GR-2026-0007', transactionIds: ['t-1', 't-2'] });
  });

  it('offers only active suppliers and items', async () => {
    renderPage();
    await ready();
    fireEvent.focus(screen.getByLabelText('Item 1'));
    expect(screen.queryByRole('option', { name: 'Closed Ltd' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Retired item/ })).not.toBeInTheDocument();
  });

  it('receives several items from one supplier and invoice in one request', async () => {
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText(/Supplier/), { target: { value: 's-1' } });
    fireEvent.change(screen.getByLabelText(/Delivery note/), { target: { value: ' INV-2041 ' } });
    fireEvent.change(screen.getByLabelText(/Delivery date/), { target: { value: '2026-10-01' } });
    choose('Item 1', 'DISC');
    fireEvent.change(screen.getAllByLabelText('Into location')[0]!, { target: { value: 'l-1' } });
    fireEvent.change(screen.getAllByLabelText(/Quantity/)[0]!, { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: /Add another item/ }));
    choose('Item 2', 'GLOVE');
    fireEvent.change(screen.getAllByLabelText(/Quantity/)[1]!, { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/stock-receipts', {
      supplierId: 's-1',
      deliveryRef: 'INV-2041',
      receivedAt: '2026-10-01',
      lines: [
        { materialId: 'm-1', locationId: 'l-1', quantity: 20 },
        // The new line starts in the same location as the line above it.
        { materialId: 'm-2', locationId: 'l-1', quantity: 6 },
      ],
    }));
    expect(await screen.findByText(/as GR-2026-0007/)).toBeInTheDocument();
  });

  it.each([
    ['the supplier', {}, 'Choose the supplier.'],
    ['the invoice number', { supplier: 's-1' }, 'Enter the delivery note or invoice number.'],
  ])('asks for %s before sending anything', async (_case, filled, message) => {
    renderPage();
    await ready();
    if ('supplier' in filled) fireEvent.change(screen.getByLabelText(/Supplier/), { target: { value: filled.supplier } });
    choose('Item 1', 'DISC');
    fireEvent.change(screen.getByLabelText('Into location'), { target: { value: 'l-1' } });
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Receive stock' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows where an item is kept and starts the line in its main location', async () => {
    renderPage();
    await ready();
    choose('Item 1', 'disc');
    expect(screen.getByText('11 each in stock · B-2 (8), A-1 (3)')).toBeInTheDocument();
    expect(screen.getByLabelText('Into location')).toHaveValue('l-2');
    choose('Item 1', 'glove');
    expect(screen.getByText('None in stock')).toBeInTheDocument();
    // A location already chosen is not overwritten.
    expect(screen.getByLabelText('Into location')).toHaveValue('l-2');
  });
});
