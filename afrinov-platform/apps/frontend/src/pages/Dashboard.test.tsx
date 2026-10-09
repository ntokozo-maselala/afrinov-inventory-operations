import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: mockGet } }));

const { Dashboard } = await import('./Dashboard');

const VALUE = {
  currency: 'ZAR',
  categories: [
    { category: 'CONSUMABLES', items: 12, itemsInStock: 10, value: 7500, unpriced: 1, share: 0.75 },
    { category: 'TOOLS', items: 2, itemsInStock: 0, value: 2500, unpriced: 0, share: 0.25 },
  ],
  total: { items: 14, itemsInStock: 10, value: 10000, unpriced: 1 },
  status: { URGENT: 2, WARNING: 1, OK: 9, NOT_SET: 2, outOfStock: 4 },
};

describe('Dashboard', () => {
  beforeEach(() => {
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path === '/reports/stock-value') return VALUE;
      if (path === '/reports/low-stock') return [];
      return { generatedAt: '2026-10-09T08:00:00Z', currency: 'ZAR', inventory: [], kpis: {} };
    });
  });

  it('shows the stock value per category, with a total, and the status counts', async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const table = within(await screen.findByLabelText('Stock value by category'));
    expect(table.getByText('Consumables')).toBeInTheDocument();
    expect(table.getByText('1 in stock without a price')).toBeInTheDocument();
    expect(table.getByText('All categories')).toBeInTheDocument();
    expect(table.getByText('75%')).toBeInTheDocument();

    expect(screen.getByText('10 of 14')).toBeInTheDocument();
    expect(screen.getByText('Urgent').closest('a')).toHaveAttribute('href', '/reports/stock-status?view=URGENT');
    expect(screen.getByText('Out of stock').closest('a')).toHaveAttribute('href', '/reports/stock-status?view=all');
    expect(screen.queryByLabelText('Time range')).not.toBeInTheDocument();
  });
});
