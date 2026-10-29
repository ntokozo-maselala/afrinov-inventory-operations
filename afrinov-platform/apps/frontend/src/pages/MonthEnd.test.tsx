import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockGet, mockDownload, mockPdf } = vi.hoisted(() => ({ mockGet: vi.fn(), mockDownload: vi.fn(), mockPdf: vi.fn() }));
vi.mock('../api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api/client')>(), api: { get: mockGet },
}));
vi.mock('../api/exportMonthEnd', () => ({ downloadMonthEnd: mockDownload, downloadMonthEndPdf: mockPdf }));

const { MonthEnd, lastMonth } = await import('./MonthEnd');
const { ToastProvider } = await import('../components/Toast');

const REPORT = {
  month: '2026-09' as string | null, from: '2026-09-01', to: '2026-09-30', generatedAt: '2026-10-09T10:00:00Z', currency: 'ZAR',
  bands: { urgentBelowPercent: 20, warningBelowPercent: 40 },
  categories: [
    { category: 'CONSUMABLES', items: [{}, {}, {}], value: 5489.25, urgent: 1, warning: 0, itemsInStock: 2, used: [], usedValue: 1051.25 },
  ],
  total: { items: 3, itemsInStock: 2, value: 5489.25, urgent: 1, warning: 0, usedValue: 1051.25 },
};
const SEPT = '/reports/month-end?from=2026-09-01&to=2026-09-30';
const renderPage = (url = '/reports/stock-report') => render(<MemoryRouter initialEntries={[url]}><ToastProvider><MonthEnd /></ToastProvider></MemoryRouter>);
const download = () => screen.getByRole('button', { name: 'Download stock report' });
/** Open the Download menu and choose a format. */
const downloadAs = (format: 'Excel (.xlsx)' | 'PDF (.pdf)') => {
  fireEvent.click(download());
  fireEvent.click(screen.getByRole('menuitem', { name: format }));
};

describe('lastMonth', () => {
  it('gives the month just ended, across a year end and a leap February', () => {
    expect(lastMonth(new Date(2026, 9, 9))).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(lastMonth(new Date(2027, 0, 5))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(lastMonth(new Date(2024, 2, 10))).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });
});

describe('Stock report page', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
    mockGet.mockReset().mockResolvedValue(REPORT);
    mockDownload.mockReset().mockResolvedValue(undefined);
    mockPdf.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('defaults to last month, shows the overview per category, and downloads it', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Stock report' })).toBeInTheDocument();
    const overview = within(await screen.findByLabelText('Stock report overview'));
    expect(overview.getByText('Consumables')).toBeInTheDocument();
    expect(screen.getByText('Stock as at the end of 2026-09-30; stock used from 2026-09-01 to 2026-09-30.')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith(SEPT);
    downloadAs('Excel (.xlsx)');
    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-30' }));
    downloadAs('PDF (.pdf)');
    await waitFor(() => expect(mockPdf).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-30' }));
  });

  it('opens on the dates in the address, and says when stock is as it stands now', async () => {
    renderPage('/reports/stock-report?from=2026-10-05&to=2026-10-11');
    await screen.findByLabelText('Stock report overview');
    expect(mockGet).toHaveBeenCalledWith('/reports/month-end?from=2026-10-05&to=2026-10-11');
    expect(screen.getByLabelText('From')).toHaveValue('2026-10-05');
    expect(screen.getByText('Stock as it stands now; stock used from 2026-10-05 to 2026-10-11.')).toBeInTheDocument();
  });

  it('lets the user choose the dates with From and To, as on Movements', async () => {
    renderPage();
    await screen.findByLabelText('Stock report overview');
    expect(screen.getByLabelText('From')).toHaveValue('2026-09-01');
    expect(screen.getByLabelText('To')).toHaveValue('2026-09-30');
    expect(screen.getByLabelText('From')).toHaveAttribute('max', '2026-09-30');
    expect(screen.getByLabelText('To')).toHaveAttribute('min', '2026-09-01');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-07' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-13' } });
    await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith('/reports/month-end?from=2026-09-07&to=2026-09-13'));
    await waitFor(() => expect(download()).toBeEnabled());
    downloadAs('Excel (.xlsx)');
    await waitFor(() => expect(mockDownload).toHaveBeenCalledWith({ from: '2026-09-07', to: '2026-09-13' }));
  });

  it.each([
    [{ From: '2026-09-20', To: '2026-09-13' }, 'The start date is after the end date.'],
    [{ From: '2026-10-10', To: '2026-10-16' }, 'Choose a period that has started.'],
    [{ From: '', To: '2026-09-30' }, 'Choose a start and an end date.'],
  ])('will not ask for %j', async (dates, message) => {
    renderPage();
    await screen.findByLabelText('Stock report overview');
    for (const [label, value] of Object.entries(dates)) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(mockGet).not.toHaveBeenCalledWith(`/reports/month-end?from=${dates.From}&to=${dates.To}`);
    expect(screen.queryByLabelText('Stock report overview')).not.toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(download()).toBeDisabled();
  });
});

describe('Stock report loading and failures', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
    mockGet.mockReset().mockResolvedValue(REPORT);
    mockDownload.mockReset().mockResolvedValue(undefined);
    mockPdf.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it('disables downloads until the chosen period has loaded and discards a stale response', async () => {
    let resolvePrevious!: (value: typeof REPORT) => void;
    let resolveSelected!: (value: typeof REPORT) => void;
    mockGet.mockImplementationOnce(() => new Promise((resolve) => { resolvePrevious = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSelected = resolve; }));
    renderPage();
    expect(download()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-13' } });
    await act(async () => resolvePrevious(REPORT));
    expect(screen.queryByLabelText('Stock report overview')).not.toBeInTheDocument();
    expect(download()).toBeDisabled();
    await act(async () => resolveSelected({ ...REPORT, month: null, to: '2026-09-13' }));
    expect(download()).toBeEnabled();
  });

  it('shows a report failure and retries the chosen period', async () => {
    // A retryable failure: the approved copy is shown (not raw server text) and
    // the retry reloads the chosen period.
    mockGet.mockRejectedValueOnce({ code: 'SERVICE_UNAVAILABLE', message: 'Internal detail: upstream refused' });
    renderPage();
    expect(await screen.findByText("We're having trouble connecting")).toBeInTheDocument();
    expect(screen.queryByText('Internal detail: upstream refused')).not.toBeInTheDocument();
    expect(download()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByLabelText('Stock report overview');
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet).toHaveBeenLastCalledWith(SEPT);
    expect(screen.queryByText("We're having trouble connecting")).not.toBeInTheDocument();
  });

  it('prevents duplicate downloads while pending and recovers after a failure', async () => {
    let rejectDownload!: (reason: Error) => void;
    mockDownload.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDownload = reject; }));
    renderPage();
    await screen.findByLabelText('Stock report overview');
    const button = download();
    downloadAs('Excel (.xlsx)');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mockDownload).toHaveBeenCalledTimes(1);
    await act(async () => rejectDownload(new Error('Network unavailable')));
    const notifications = within(screen.getByRole('region', { name: 'Notifications' }));
    expect(notifications.getByText('Download failed')).toBeInTheDocument();
    expect(notifications.getByText('Network unavailable')).toBeInTheDocument();
    expect(button).toBeEnabled();
    downloadAs('Excel (.xlsx)');
    await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button).toBeEnabled());
  });
});
