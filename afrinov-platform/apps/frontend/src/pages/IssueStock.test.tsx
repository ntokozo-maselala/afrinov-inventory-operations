import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

async function respond(path: string) {
  if (path.startsWith('/reports/current-stock')) return STOCK;
  if (path.startsWith('/recipients')) return [{ id: 'r-1', name: 'Sabelo', type: 'WORKER' }, { id: 'r-2', name: 'Forklift', type: 'MACHINE' }];
  if (path.startsWith('/projects')) return [{ projectNumber: 'AFRI-1325', name: 'Plant upgrade' }];
  return [];
}

function renderPage() {
  if (!mockGet.getMockImplementation()) mockGet.mockImplementation(respond);
  render(<MemoryRouter><ToastProvider><IssueStock /></ToastProvider></MemoryRouter>);
}

async function ready() {
  await waitFor(() => expect(screen.getByRole('option', { name: /Sabelo/ })).toBeInTheDocument());
  await waitFor(() => expect(screen.getByLabelText('Item 1')).toBeEnabled());
}

/** Type into an item search box and pick the first match. */
function choose(label: string, query: string) {
  const input = screen.getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: query } });
  fireEvent.mouseDown(within(screen.getByRole('listbox')).getAllByRole('option')[0]!);
}

describe('IssueStock page', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset().mockResolvedValue({ transactionIds: ['t-1', 't-2'] });
  });

  it('offers only items that are in stock', async () => {
    renderPage();
    await ready();
    fireEvent.focus(screen.getByLabelText('Item 1'));
    expect(screen.getAllByRole('option', { name: /on hand/ })).toHaveLength(2);
    expect(screen.queryByRole('option', { name: /Out of stock item/ })).not.toBeInTheDocument();
  });

  it('issues several items to one recipient and project in one request', async () => {
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText(/Issued to/), { target: { value: 'r-1' } });
    fireEvent.change(screen.getByLabelText(/Project/), { target: { value: 'AFRI-1325' } });
    choose('Item 1', 'DISC');
    fireEvent.change(screen.getAllByLabelText('Quantity')[0]!, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /Add another item/ }));
    choose('Item 2', 'GLOVE');
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
    choose('Item 1', 'DISC');
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue stock' }));
    expect(await screen.findByText('Choose who the stock is issued to.')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('warns when two lines together ask for more than is on hand', async () => {
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText(/Issued to/), { target: { value: 'r-2' } });
    choose('Item 1', 'GLOVE');
    fireEvent.change(screen.getAllByLabelText('Quantity')[0]!, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /Add another item/ }));
    choose('Item 2', 'GLOVE');
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
    choose('Item 1', 'DISC');
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue stock' }));
    expect(await screen.findByText(/only 2 available/)).toBeInTheDocument();
  });

  it('finds items by any mix of name, code and location', async () => {
    renderPage();
    await ready();
    const input = screen.getByLabelText('Item 1');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'a-1 glove' } });
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Welding gloves (GLOVE-L) · A-14 pair on hand']);
    fireEvent.change(input, { target: { value: 'b-9' } });
    expect(screen.getByText('No item in stock matches')).toBeInTheDocument();
  });

  it('picks the highlighted item with the keyboard without submitting the form', async () => {
    renderPage();
    await ready();
    const input = screen.getByLabelText('Item 1');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'a-1' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('Welding gloves (GLOVE-L) · A-1');
    expect(screen.getByText('On hand at A-1: 4 pair')).toBeInTheDocument();
    expect(screen.queryByText('Choose who the stock is issued to.')).not.toBeInTheDocument();
  });

  it('puts the cursor in the new line when another item is added', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Add another item/ }));
    expect(screen.getByLabelText('Item 2')).toHaveFocus();
  });

  it('says when recipients cannot be loaded instead of showing an empty list', async () => {
    let fail = true;
    mockGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/recipients') && fail) throw { code: 'INTERNAL_ERROR', message: 'Server unavailable' };
      return respond(path);
    });
    renderPage();
    expect(await screen.findByText("Couldn't load recipients and projects")).toBeInTheDocument();
    expect(screen.queryByText('No recipients yet')).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('option', { name: /Sabelo/ })).toBeInTheDocument());
    expect(screen.queryByText("Couldn't load recipients and projects")).not.toBeInTheDocument();
  });
});
