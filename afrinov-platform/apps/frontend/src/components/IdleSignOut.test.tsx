import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { IdleSignOut } from './IdleSignOut';

const expireSession = vi.fn();
const get = vi.fn();

vi.mock('../auth', () => ({ useAuth: () => ({ expireSession }) }));
vi.mock('../api/client', () => ({
  FRONTEND_ONLY: false,
  api: { get: (...args: unknown[]) => get(...args) },
}));

describe('IdleSignOut', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    expireSession.mockReset();
    get.mockReset();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function mountWith(minutes: number) {
    get.mockResolvedValue({ 'security.sessionTimeoutMinutes': minutes });
    render(<IdleSignOut />);
    // Let the settings request resolve.
    await act(async () => { await Promise.resolve(); });
  }

  it('signs out after the configured minutes without activity', async () => {
    await mountWith(10);
    await act(async () => { vi.advanceTimersByTime(9 * 60_000); });
    expect(expireSession).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(60_000 + 15_000); });
    expect(expireSession).toHaveBeenCalled();
  });

  it('keeps the session while the user is active', async () => {
    await mountWith(10);
    for (let i = 0; i < 4; i++) {
      await act(async () => { vi.advanceTimersByTime(5 * 60_000); });
      window.dispatchEvent(new Event('keydown'));
    }
    expect(expireSession).not.toHaveBeenCalled();
  });

  it('counts activity in another tab', async () => {
    await mountWith(10);
    await act(async () => { vi.advanceTimersByTime(8 * 60_000); });
    localStorage.setItem('afrinov.lastActivity', String(Date.now()));
    await act(async () => { vi.advanceTimersByTime(5 * 60_000); });
    expect(expireSession).not.toHaveBeenCalled();
  });

  it('falls back to 60 minutes when the setting cannot be read', async () => {
    get.mockRejectedValue(new Error('offline'));
    render(<IdleSignOut />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(59 * 60_000); });
    expect(expireSession).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(2 * 60_000); });
    expect(expireSession).toHaveBeenCalled();
  });
});
