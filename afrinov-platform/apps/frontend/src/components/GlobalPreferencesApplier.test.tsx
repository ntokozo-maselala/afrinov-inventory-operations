import { StrictMode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPEARANCE_THEME_STORAGE_KEY, getAppearance, setAppearance } from '../hooks/useAppearance';
import { GlobalPreferencesApplier } from './GlobalPreferencesApplier';

const mocks = vi.hoisted(() => ({ get: vi.fn(), frontendOnly: false }));
vi.mock('../api/client', () => ({
  api: { get: mocks.get },
  get FRONTEND_ONLY() { return mocks.frontendOnly; },
}));

type Values = { 'appearance.theme'?: string; 'appearance.density'?: string };

function deferred() {
  let resolve!: (value: Values) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Values>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue({});
  mocks.frontendOnly = false;
  setAppearance({ theme: 'light', density: 'comfortable' });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  setAppearance({ theme: 'light', density: 'comfortable' });
  localStorage.clear();
});

describe('GlobalPreferencesApplier', () => {
  it.each(['light', 'dark', 'system'] as const)('applies the server %s default and density before announcing readiness', async (theme) => {
    const request = deferred();
    mocks.get.mockReturnValue(request.promise);
    const ready = vi.fn(() => ({ ...getAppearance(), colorScheme: document.documentElement.style.colorScheme }));
    render(<GlobalPreferencesApplier onReady={ready} />);

    expect(mocks.get).toHaveBeenCalledExactlyOnceWith('/settings/values?keys=appearance.theme,appearance.density');
    expect(ready).not.toHaveBeenCalled();
    await act(async () => request.resolve({ 'appearance.theme': theme, 'appearance.density': 'compact' }));

    expect(ready).toHaveBeenCalledTimes(1);
    expect(ready.mock.results[0]?.value).toEqual({ theme, density: 'compact', colorScheme: theme === 'dark' ? 'dark' : 'light' });
    expect(document.body).toHaveClass('table-compact');
  });

  it.each(['light', 'dark', 'system'] as const)('uses the browser %s choice over a conflicting server default', async (theme) => {
    localStorage.setItem(APPEARANCE_THEME_STORAGE_KEY, theme);
    mocks.get.mockResolvedValue({ 'appearance.theme': theme === 'dark' ? 'light' : 'dark' });
    const ready = vi.fn();
    render(<GlobalPreferencesApplier onReady={ready} />);

    await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
    expect(getAppearance().theme).toBe(theme);
    expect(localStorage.getItem(APPEARANCE_THEME_STORAGE_KEY)).toBe(theme);
  });

  it('honors a legacy browser choice over the server default', async () => {
    localStorage.setItem('afrinov.settings.v1', JSON.stringify({ theme: 'dark' }));
    mocks.get.mockResolvedValue({ 'appearance.theme': 'light' });
    const ready = vi.fn();
    render(<GlobalPreferencesApplier onReady={ready} />);

    await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
    expect(getAppearance().theme).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it('uses light and comfortable when the server omits appearance values', async () => {
    const ready = vi.fn();
    render(<GlobalPreferencesApplier onReady={ready} />);

    await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
    expect(getAppearance()).toEqual({ theme: 'light', density: 'comfortable' });
  });

  it('keeps a browser choice made while the server response is pending', async () => {
    const request = deferred();
    mocks.get.mockReturnValue(request.promise);
    render(<GlobalPreferencesApplier />);
    act(() => setAppearance({ theme: 'dark' }));

    await act(async () => request.resolve({ 'appearance.theme': 'light', 'appearance.density': 'compact' }));

    expect(getAppearance()).toEqual({ theme: 'dark', density: 'compact' });
    expect(document.documentElement).toHaveClass('dark');
  });

  it('signals readiness after a failed request without replacing applied preferences', async () => {
    setAppearance({ theme: 'dark', density: 'compact' });
    mocks.get.mockRejectedValue(new Error('Unauthorized'));
    const ready = vi.fn();
    render(<GlobalPreferencesApplier onReady={ready} />);

    await waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
    expect(getAppearance()).toEqual({ theme: 'dark', density: 'compact' });
    expect(document.documentElement).toHaveClass('dark');
    expect(document.body).toHaveClass('table-compact');
  });

  it.each(['success', 'failure'] as const)('ignores a late %s after unmount', async (outcome) => {
    const request = deferred();
    mocks.get.mockReturnValue(request.promise);
    const ready = vi.fn();
    const { unmount } = render(<GlobalPreferencesApplier onReady={ready} />);
    unmount();

    await act(async () => {
      if (outcome === 'success') request.resolve({ 'appearance.theme': 'dark', 'appearance.density': 'compact' });
      else request.reject(new Error('Offline'));
    });

    expect(ready).not.toHaveBeenCalled();
    expect(getAppearance()).toEqual({ theme: 'light', density: 'comfortable' });
    expect(localStorage.getItem(APPEARANCE_THEME_STORAGE_KEY)).toBeNull();
  });

  it('calls the latest readiness callback once without refetching on rerender', async () => {
    const request = deferred();
    mocks.get.mockReturnValue(request.promise);
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(<GlobalPreferencesApplier onReady={first} />);
    rerender(<GlobalPreferencesApplier onReady={latest} />);

    await act(async () => request.resolve({}));
    rerender(<GlobalPreferencesApplier onReady={first} />);

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('ignores the abandoned StrictMode request and announces readiness for the active request', async () => {
    const abandoned = deferred();
    const active = deferred();
    mocks.get.mockReturnValueOnce(abandoned.promise).mockReturnValueOnce(active.promise);
    const ready = vi.fn();
    render(<StrictMode><GlobalPreferencesApplier onReady={ready} /></StrictMode>);

    await act(async () => active.resolve({ 'appearance.theme': 'light' }));
    await act(async () => abandoned.resolve({ 'appearance.theme': 'dark' }));

    expect(ready).toHaveBeenCalledTimes(1);
    expect(getAppearance().theme).toBe('light');
  });

  it.each(['light', 'dark', 'system'] as const)('preserves the bootstrapped %s theme in frontend-only mode', (theme) => {
    mocks.frontendOnly = true;
    setAppearance({ theme, density: 'compact' });
    const ready = vi.fn();
    render(<GlobalPreferencesApplier onReady={ready} />);

    expect(mocks.get).not.toHaveBeenCalled();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(document.documentElement.classList.contains('dark')).toBe(theme === 'dark');
    expect(document.body).not.toHaveClass('table-compact');
    expect(localStorage.getItem(APPEARANCE_THEME_STORAGE_KEY)).toBe(theme);
  });
});
