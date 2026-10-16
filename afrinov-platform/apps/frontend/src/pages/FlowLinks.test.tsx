// The links from the setup pages (projects, recipients, suppliers) to what
// happened with them: stock used and deliveries.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => false }) }));

const { Projects } = await import('./Projects');
const { Recipients } = await import('./Recipients');
const { SupplierDetail } = await import('./SupplierDetail');
const { ToastProvider } = await import('../components/Toast');

const page = (el: React.ReactNode, url = '/') => render(<MemoryRouter initialEntries={[url]}><ToastProvider>{el}</ToastProvider></MemoryRouter>);
const project = (projectNumber: string, startDate: string | null) => ({ projectNumber, name: `Project ${projectNumber}`, status: 'ACTIVE', active: true, startDate });

describe('links to stock used and deliveries', () => {
  beforeEach(() => {
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path.startsWith('/projects')) return [project('AFRI-1325', '2026-03-01T00:00:00.000Z'), project('AFRI-2000', '2099-01-01'), project('AFRI-3000', null)];
      if (path.startsWith('/recipients')) return [{ id: 'r-1', name: 'Sabelo', type: 'WORKER', active: true }];
      if (path.startsWith('/suppliers')) return [{ id: 's-1', name: 'Hydroscand', active: true }];
      return [];
    });
  });

  it('opens Stock used for a project from its start date, or this month when it has none yet', async () => {
    page(<Projects />);
    await screen.findByText('Project AFRI-1325');
    const links = screen.getAllByRole('link', { name: 'View' }).map((a) => a.getAttribute('href'));
    expect(links[0]).toMatch(/^\/reports\/consumption\?projectNumber=AFRI-1325&from=2026-03-01&to=\d{4}-\d\d-\d\d$/);
    expect(links[1]).toBe('/reports/consumption?projectNumber=AFRI-2000');
    expect(links[2]).toBe('/reports/consumption?projectNumber=AFRI-3000');
  });

  it('opens Stock used for a recipient', async () => {
    page(<Recipients />);
    await screen.findByText('Sabelo');
    expect(screen.getByRole('link', { name: 'This month' })).toHaveAttribute('href', '/reports/consumption?recipientId=r-1');
  });

  it("lists a supplier's deliveries from the last 12 months, and opens them in Movements", async () => {
    page(<Routes><Route path="/suppliers/:id" element={<SupplierDetail />} /></Routes>, '/suppliers/s-1');
    await screen.findByText('Deliveries');
    await waitFor(() => expect(mockGet.mock.calls.some(([p]) => String(p).startsWith('/stock-receipts?') && String(p).includes('supplierId=s-1'))).toBe(true));
    expect(screen.getByRole('link', { name: 'Open in Movements' }).getAttribute('href'))
      .toMatch(/^\/movements\?report=received&from=\d{4}-\d\d-\d\d&to=\d{4}-\d\d-\d\d&supplierId=s-1$/);
  });
});
