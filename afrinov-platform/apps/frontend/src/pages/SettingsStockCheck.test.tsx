// Settings → Data & backup: the daily stock check (ADR-047). When figures don't
// add up, an Admin reads which, so the Dashboard card is not a dead end.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  FRONTEND_ONLY: false,
  isSafeServerMessage: () => true,
  isApiError: (e: unknown) => typeof (e as { code?: unknown } | null)?.code === 'string',
}));

const { StockCheckStatus } = await import('./SettingsSections');

const at = '2026-11-23T02:00:03Z';
const run = (over: Record<string, unknown>) => ({
  status: 'OK', startedAt: at, finishedAt: at, balances: 1138, issues: 40, problemCount: 0, problems: [], detail: null, ...over,
});

describe('Settings: stock check', () => {
  it('lists the figures that do not add up, and how many more there are', async () => {
    mockGet.mockReset().mockResolvedValue({
      state: 'DRIFT',
      lastRun: run({ status: 'DRIFT', problemCount: 52, problems: ['RECON-1 at Shelf A: stored balance 5, the ledger adds up to 8', 'RECON-2 at Shelf B: balance is negative (-1)'] }),
    });
    render(<StockCheckStatus />);

    expect(await screen.findByText('52 stock figures don\'t add up')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Figures that don\'t add up' });
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByText(/stored balance 5, the ledger adds up to 8/)).toBeTruthy();
    expect(screen.getByText(/and 50 more/)).toBeTruthy();
    expect(mockGet.mock.calls[0]![0]).toBe('/stock-reconciliation/status');
  });

  it('says the figures add up, with no list', async () => {
    mockGet.mockReset().mockResolvedValue({ state: 'OK', lastRun: run({}) });
    render(<StockCheckStatus />);
    expect(await screen.findByText('Stock figures add up')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('says when it could not load, instead of a blank space', async () => {
    mockGet.mockReset().mockRejectedValue(Object.assign(new Error('Service unavailable'), { code: 'SERVICE_UNAVAILABLE', status: 503 }));
    render(<StockCheckStatus />);
    expect(await screen.findByText('Couldn\'t load the stock check')).toBeTruthy();
  });
});
