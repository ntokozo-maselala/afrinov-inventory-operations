import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));

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
});
