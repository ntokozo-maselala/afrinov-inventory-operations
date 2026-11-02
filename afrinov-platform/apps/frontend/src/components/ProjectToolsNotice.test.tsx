// Tools still out on a project when it is closed: listed on the Projects page
// and in the project form, since closing a project brings nothing back.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: mockGet } }));

const { ClosedProjectToolsNotice, ClosingProjectTools } = await import('./ProjectToolsNotice');

const loan = (projectNumber: string | null, recipientName: string, out: string, daysLate: number) => ({
  loanId: `${recipientName}-${projectNumber}`, projectNumber, recipientName, out, dueOn: '2026-11-04', daysLate,
});
const TOOLS = [
  { materialId: 'm-drill', sku: 'TL-0002', name: 'Makita Hand Drill', loans: [loan('AFRI-1325', 'Sabelo', '1', 3)] },
  { materialId: 'm-scraper', sku: 'TL-0004', name: 'Scraper', loans: [loan('AFRI-1325', 'Bukho', '2', -2), loan('AFRI-1400', 'Bukho', '1', 0), loan(null, 'Khodani', '1', 0)] },
];

beforeEach(() => {
  mockGet.mockReset().mockImplementation(async (path: string) => (path === '/tools' ? TOOLS : []));
});

describe('ClosedProjectToolsNotice', () => {
  it('lists closed projects with tools still out, and links to them on Tools', async () => {
    render(<MemoryRouter><ClosedProjectToolsNotice projects={[
      { projectNumber: 'AFRI-1325', name: 'Northam', status: 'COMPLETED' },
      { projectNumber: 'AFRI-1400', status: 'ACTIVE' },
      { projectNumber: 'AFRI-1500', status: 'CANCELLED' },
    ]} /></MemoryRouter>);
    const link = await screen.findByRole('link', { name: '3 tools still out' });
    expect(link).toHaveAttribute('href', '/tools?view=out&q=AFRI-1325');
    expect(screen.getByText(/Project AFRI-1325 · Northam is completed/)).toBeInTheDocument();
    expect(screen.queryByText(/AFRI-1400|AFRI-1500/)).not.toBeInTheDocument();
  });
});

describe('ClosingProjectTools', () => {
  it('names each tool still out when the project is being completed', async () => {
    render(<MemoryRouter><ClosingProjectTools projectNumber="AFRI-1325" status="COMPLETED" /></MemoryRouter>);
    expect(await screen.findByText('3 tools still out on this project')).toBeInTheDocument();
    expect(screen.getByText(/Makita Hand Drill \(TL-0002\) with Sabelo: due .*, 3 days late/)).toBeInTheDocument();
    expect(screen.getByText(/Scraper \(TL-0004\) × 2 with Bukho: due .*, due in 2 days/)).toBeInTheDocument();
  });

  it('says nothing while the project stays open', async () => {
    render(<MemoryRouter><ClosingProjectTools projectNumber="AFRI-1325" status="ACTIVE" /></MemoryRouter>);
    await vi.waitFor(() => expect(mockGet).toHaveBeenCalledWith('/tools'));
    expect(screen.queryByText(/still out/)).not.toBeInTheDocument();
  });
});
