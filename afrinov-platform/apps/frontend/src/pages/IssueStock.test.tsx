import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));

vi.mock('../api/client', () => ({
  api: { get: mockGet, post: mockPost },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));

const { IssueStock } = await import('./IssueStock');
const { ToastProvider } = await import('../components/Toast');

const STOCK = [
  { materialId: 'm-1', materialSku: 'DISC-115', materialName: 'Cutting disc', locationId: 'l-1', locationName: 'A-1', unitOfMeasure: 'each', quantity: '10' },
  { materialId: 'm-2', materialSku: 'GLOVE-L', materialName: 'Welding gloves', locationId: 'l-1', locationName: 'A-1', unitOfMeasure: 'pair', quantity: '4' },
  { materialId: 'm-3', materialSku: 'EMPTY', materialName: 'Out of stock item', locationId: 'l-1', locationName: 'A-1', unitOfMeasure: 'each', quantity: '0' },
];

function renderPage() {
  mockGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/reports/current-stock')) return STOCK;
    if (path.startsWith('/recipients')) return [{ id: 'r-1', name: 'Sabelo', type: 'WORKER' }, { id: 'r-2', name: 'Forklift', type: 'MACHINE' }];
    if (path.startsWith('/projects')) return [{ projectNumber: 'AFRI-1325', name: 'Plant upgrade' }];
    return [];
  });
  render(<MemoryRouter><ToastProvider><IssueStock /></ToastProvider></MemoryRouter>);
}

async function ready() {
  await waitFor(() => expect(screen.getByRole('option', { name: /Sabelo/ })).toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('option', { name: /Cutting disc/ })).toBeInTheDocument());
}

describe('IssueStock page', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset().mockResolvedValue({ transactionIds: ['t-1', 't-2'] });
  });

  it('offers only items that are in stock', async () => {
    renderPage();
    await ready();
    expect(screen.queryByRole('option', { name: /Out of stock item/ })).not.toBeInTheDocument();
  });

  it('issues several items to one recipient and project in one request', async () => {
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText(/Issued to/), { target: { value: 'r-1' } });
    fireEvent.change(screen.getByLabelText(/Project/), { target: { value: 'AFRI-1325' } });
    fireEvent.change(screen.getByLabelText('Item 1'), { target: { value: 'm-1|l-1' } });
    fireEvent.change(screen.getAllByLabelText('Quantity')[0]!, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /Add another item/ }));
    fireEvent.change(screen.getByLabelText('Item 2'), { target: { value: 'm-2|l-1' } });
    fireEvent.change(screen.getAllByLabelText('Quantity')[1]!, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue stock' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/inventory-issues', {
      recipientId: 'r-1',
      projectNumber: 'AFRI-1325',
      lines: [
        { materialId: 'm-1', locationId: 'l-1', quantity: 3 },
        { materialId: 'm-2', locationId: 'l-1', quantity: 2 },
      ],
    }));
  });

  it('asks for a recipient before sending anything', async () => {
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText('Item 1'), { target: { value: 'm-1|l-1' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue stock' }));
    expect(await screen.findByText('Choose who the stock is issued to.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('warns when two lines together ask for more than is on hand', async () => {
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText(/Issued to/), { target: { value: 'r-2' } });
    fireEvent.change(screen.getByLabelText('Item 1'), { target: { value: 'm-2|l-1' } });
    fireEvent.change(screen.getAllByLabelText('Quantity')[0]!, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /Add another item/ }));
    fireEvent.change(screen.getByLabelText('Item 2'), { target: { value: 'm-2|l-1' } });
    fireEvent.change(screen.getAllByLabelText('Quantity')[1]!, { target: { value: '2' } });
    expect(screen.getAllByText('More than on hand')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Issue stock' }));
    expect(await screen.findByText('Some lines ask for more than is in stock.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows the server message when the issue is refused', async () => {
    mockPost.mockRejectedValue({ code: 'INSUFFICIENT_BALANCE', message: 'Cannot issue 3 × DISC-115: only 2 available.' });
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText(/Issued to/), { target: { value: 'r-1' } });
    fireEvent.change(screen.getByLabelText('Item 1'), { target: { value: 'm-1|l-1' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue stock' }));
    expect(await screen.findByText(/only 2 available/)).toBeInTheDocument();
  });
});
