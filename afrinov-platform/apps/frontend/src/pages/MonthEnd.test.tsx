import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockDownload } = vi.hoisted(() => ({ mockGet: vi.fn(), mockDownload: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: mockGet } }));
vi.mock('../api/exportMonthEnd', () => ({ downloadMonthEnd: mockDownload }));

const { MonthEnd, lastMonth } = await import('./MonthEnd');
const { ToastProvider } = await import('../components/Toast');

const REPORT = {
  month: '2026-09', from: '2026-09-01', to: '2026-09-30', generatedAt: '2026-10-09T10:00:00Z', currency: 'ZAR',
  bands: { urgentBelowPercent: 20, warningBelowPercent: 40 },
  categories: [
    { category: 'CONSUMABLES', items: [{}, {}, {}], value: 5489.25, urgent: 1, warning: 0, itemsInStock: 2, used: [], usedValue: 1051.25 },
  ],
  total: { items: 3, itemsInStock: 2, value: 5489.25, urgent: 1, warning: 0, usedValue: 1051.25 },
};

describe('MonthEnd page', () => {
  beforeEach(() => {
    mockGet.mockReset().mockResolvedValue(REPORT);
    mockDownload.mockReset().mockResolvedValue(undefined);
  });

  it('defaults to the month just ended, across a year end', () => {
    expect(lastMonth(new Date(2026, 9, 9))).toBe('2026-09');
    expect(lastMonth(new Date(2027, 0, 5))).toBe('2026-12');
  });

  it('shows the overview per category for the chosen month, and downloads it', async () => {
    render(<MemoryRouter><ToastProvider><MonthEnd /></ToastProvider></MemoryRouter>);
    const overview = within(await screen.findByLabelText('Month-end overview'));
    expect(overview.getByText('Consumables')).toBeInTheDocument();
    expect(screen.getByText('Stock as at the end of 2026-09-30; stock used from 2026-09-01 to 2026-09-30.')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith(`/reports/month-end?month=${lastMonth()}`);

    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-08' } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/reports/month-end?month=2026-08'));
    fireEvent.click(screen.getByRole('button', { name: 'Download month-end report' }));
    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith('2026-08'));
  });

  it('will not ask for a month that has not started', async () => {
    render(<MemoryRouter><ToastProvider><MonthEnd /></ToastProvider></MemoryRouter>);
    await screen.findByLabelText('Month-end overview');
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2999-01' } });
    expect(screen.getByText('Choose a month up to this one.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download month-end report' })).toBeDisabled();
  });
});
