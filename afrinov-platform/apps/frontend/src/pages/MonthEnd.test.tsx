import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockDownload } = vi.hoisted(() => ({ mockGet: vi.fn(), mockDownload: vi.fn() }));
vi.mock('../api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/client')>(), api: { get: mockGet },
}));
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
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
    mockGet.mockReset().mockResolvedValue(REPORT);
    mockDownload.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => vi.useRealTimers());

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
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Month-end overview')).not.toBeInTheDocument();
    expect(screen.getByText('Choose a month up to this one.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download month-end report' })).toBeDisabled();
  });
});


describe('MonthEnd loading and failures', () => {
  const renderPage = () => render(<MemoryRouter><ToastProvider><MonthEnd /></ToastProvider></MemoryRouter>);
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
    mockGet.mockReset().mockResolvedValue(REPORT);
    mockDownload.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('disables downloads until the selected month has loaded and discards a stale response', async () => {
    let resolvePrevious!: (value: typeof REPORT) => void;
    let resolveSelected!: (value: typeof REPORT) => void;
    mockGet.mockImplementationOnce(() => new Promise((resolve) => { resolvePrevious = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSelected = resolve; }));
    renderPage();
    const button = screen.getByRole('button', { name: 'Download month-end report' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-08' } });
    await act(async () => resolvePrevious(REPORT));
    expect(screen.queryByLabelText('Month-end overview')).not.toBeInTheDocument();
    expect(button).toBeDisabled();
    await act(async () => resolveSelected({ ...REPORT, month: '2026-08', from: '2026-08-01', to: '2026-08-31' }));
    expect(button).toBeEnabled();
    expect(screen.getByText('Stock as at the end of 2026-08-31; stock used from 2026-08-01 to 2026-08-31.')).toBeInTheDocument();
  });

  it('shows a report failure and retries the selected month', async () => {
    mockGet.mockRejectedValueOnce({ code: 'FORBIDDEN', message: 'Reports permission required' });
    renderPage();
    expect(await screen.findByText('Reports permission required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download month-end report' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByLabelText('Month-end overview');
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet).toHaveBeenLastCalledWith('/reports/month-end?month=2026-09');
    expect(screen.queryByText('Reports permission required')).not.toBeInTheDocument();
  });

  it('prevents duplicate downloads while pending and recovers after a failure', async () => {
    let rejectDownload!: (reason: Error) => void;
    mockDownload.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDownload = reject; }));
    renderPage();
    await screen.findByLabelText('Month-end overview');
    const button = screen.getByRole('button', { name: 'Download month-end report' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mockDownload).toHaveBeenCalledTimes(1);
    await act(async () => rejectDownload(new Error('Network unavailable')));
    const notifications = within(screen.getByRole('region', { name: 'Notifications' }));
    expect(notifications.getByText('Download failed')).toBeInTheDocument();
    expect(notifications.getByText('Network unavailable')).toBeInTheDocument();
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('allows this month and explains that the report is still in progress', async () => {
    renderPage();
    await screen.findByLabelText('Month-end overview');
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-10' } });
    await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith('/reports/month-end?month=2026-10'));
    expect(screen.getByText('This month so far: stock as it stands now.')).toBeInTheDocument();
    expect(screen.getByLabelText('Month')).toHaveAttribute('max', '2026-10');
  });

  it('does not request or download a cleared month', async () => {
    renderPage();
    await screen.findByLabelText('Month-end overview');
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '' } });
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Month-end overview')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download month-end report' })).toBeDisabled();
  });
});
