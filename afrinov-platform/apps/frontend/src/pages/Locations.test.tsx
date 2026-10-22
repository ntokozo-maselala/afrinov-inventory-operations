import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockPatch } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPatch: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, patch: mockPatch },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));

// Signed in as a store controller, who may do everything on these pages; tests that need another role set signedIn.roles.
const { signedIn } = vi.hoisted(() => ({ signedIn: { roles: ['STORE_CONTROLLER'] as string[] } }));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: signedIn.roles } }) }));

const { Locations } = await import('./Locations');
const { ToastProvider } = await import('../components/Toast');

const LOCATIONS = [
  { id: 'l-1', name: 'Main Storeroom', type: 'STOREROOM', active: true, inventoryCount: 3 },
  { id: 'l-2', name: 'D-1', type: 'RACK', active: true, inventoryCount: 0 },
];

function renderPage(report: () => Promise<unknown>) {
  mockGet.mockReset().mockImplementation(async (path: string) => {
    if (path === '/locations') return LOCATIONS;
    if (path.startsWith('/reports/inventory')) return report();
    return [];
  });
  render(<MemoryRouter><ToastProvider><Locations /></ToastProvider></MemoryRouter>);
}

/** The Value cell in the row for the named location. */
const valueCell = async (name: string) => {
  const row = (await screen.findByText(name)).closest('tr')!;
  const column = screen.getAllByRole('columnheader').findIndex((h) => h.textContent === 'Value');
  return within(row).getAllByRole('cell')[column]!;
};

describe('Locations page', () => {
  it('shows the stock value held at each location, and zero where nothing is held', async () => {
    renderPage(async () => ({ currency: 'ZAR', byLocation: [{ locationId: 'l-1', inventoryValue: 1250.5 }] }));
    expect(screen.getByRole('columnheader', { name: 'Value' })).toBeInTheDocument();
    expect((await valueCell('Main Storeroom')).textContent).toMatch(/1\s?250,50/);
    expect((await valueCell('D-1')).textContent).toMatch(/0,00/);
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('pageSize=1'));
  });

  it('shows a dash when the report cannot be read, for example without access to reports', async () => {
    renderPage(async () => { throw { code: 'FORBIDDEN', message: 'No access' }; });
    expect((await valueCell('Main Storeroom')).textContent).toBe('—');
  });

  it('labels its search and filters', async () => {
    renderPage(async () => ({ currency: 'ZAR', byLocation: [] }));
    await screen.findByText('Main Storeroom');
    for (const label of ['Search', 'Type', 'Status']) {
      expect(screen.getByText(label, { selector: 'label' })).toBeInTheDocument();
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });
});

describe('Locations page: the room a location stands in', () => {
  const ROOMS = [
    { id: 'l-1', name: 'Main Storeroom', type: 'STOREROOM', active: true, parentId: null, parent: null, inventoryCount: 0 },
    { id: 'l-2', name: 'D-1', type: 'RACK', active: true, parentId: 'l-1', parent: { id: 'l-1', name: 'Main Storeroom', type: 'STOREROOM' }, inventoryCount: 2 },
    { id: 'l-3', name: 'Boiler Shop', type: 'SHOP_FLOOR_AREA', active: true, parentId: null, parent: null, inventoryCount: 0 },
    { id: 'l-4', name: 'E-3', type: 'RACK', active: true, parentId: null, parent: null, inventoryCount: 0 },
  ];
  const show = () => {
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path === '/locations') return ROOMS;
      if (path.startsWith('/reports/inventory')) return { currency: 'ZAR', byLocation: [] };
      return [];
    });
    mockPatch.mockReset().mockResolvedValue({});
    render(<MemoryRouter><ToastProvider><Locations /></ToastProvider></MemoryRouter>);
  };
  const row = async (name: string) => (await screen.findByText(name, { selector: 'span.font-medium' })).closest('tr')!;
  const edit = async (name: string) => fireEvent.click(within(await row(name)).getByRole('button', { name: 'Edit' }));

  it('shows each location’s room, and filters to a room and what stands in it', async () => {
    show();
    expect(screen.getByRole('columnheader', { name: 'Located in' })).toBeInTheDocument();
    expect(within(await row('D-1')).getByText('Main Storeroom')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Room'), { target: { value: 'l-1' } });
    expect(screen.queryByText('Boiler Shop', { selector: 'span.font-medium' })).not.toBeInTheDocument();
    expect(screen.getByText('D-1', { selector: 'span.font-medium' })).toBeInTheDocument();
    expect(screen.getByText('Main Storeroom', { selector: 'span.font-medium' })).toBeInTheDocument();
  });

  it('offers only rooms a location can go inside, and moves a rack to another one', async () => {
    show();
    await edit('D-1');
    const select = await screen.findByLabelText('Located in');
    const offered = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(offered).toEqual(['Not inside another location', 'Main Storeroom', 'Boiler Shop']);
    fireEvent.change(select, { target: { value: 'l-3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/locations/l-2', expect.objectContaining({ parentId: 'l-3' })));
  });

  it('takes a location out of its room with "Not inside another location"', async () => {
    show();
    await edit('D-1');
    fireEvent.change(await screen.findByLabelText('Located in'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/locations/l-2', expect.objectContaining({ parentId: null })));
  });

  it('will not put a room that holds others inside another, and says why', async () => {
    show();
    await edit('Main Storeroom');
    expect(await screen.findByLabelText('Located in')).toBeDisabled();
    expect(screen.getByText('Other locations stand inside this one, so it cannot go inside another.')).toBeInTheDocument();
  });

  it('shows the server’s reason when a room is refused', async () => {
    show();
    mockPatch.mockRejectedValue({ code: 'VALIDATION_ERROR', message: 'Boiler Shop is inactive. Reactivate it to put locations inside it.' });
    await edit('E-3');
    fireEvent.change(await screen.findByLabelText('Located in'), { target: { value: 'l-3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save location' }));
    // In the form, under 'Cannot save', and in the toast.
    expect((await screen.findAllByText('Boiler Shop is inactive. Reactivate it to put locations inside it.')).length).toBeGreaterThan(0);
    expect(screen.getByText('Cannot save')).toBeInTheDocument();
  });
});
