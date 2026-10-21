import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPEARANCE_THEME_STORAGE_KEY, getAppearance, setAppearance } from './useAppearance';
import { SettingsProvider, useSettings, type SettingValue } from './useSettings';

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn() }));
vi.mock('../api/client', () => ({ api: mocks }));

function setting(key: string, value: unknown): SettingValue {
  return {
    key, value, type: 'enum', category: 'appearance', description: '', isEditable: true,
    enumOptions: key === 'appearance.theme' ? ['light', 'dark', 'system'] : ['comfortable', 'compact'],
    updatedAt: '2026-10-01T00:00:00.000Z', updatedById: null,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <SettingsProvider canEdit>{children}</SettingsProvider>;
}

async function loadPreferences(rows: SettingValue[]) {
  mocks.get.mockResolvedValue(rows);
  const hook = renderHook(() => useSettings(), { wrapper });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(() => {
  mocks.get.mockReset();
  mocks.patch.mockReset();
  mocks.post.mockReset();
  setAppearance({ theme: 'light', density: 'comfortable' });
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  setAppearance({ theme: 'light', density: 'comfortable' });
  localStorage.clear();
});

describe('SettingsProvider appearance preferences', () => {
  it.each(['light', 'dark', 'system'] as const)('applies the server %s theme when no browser choice exists', async (theme) => {
    const { result } = await loadPreferences([setting('appearance.theme', theme), setting('appearance.density', 'compact')]);

    expect(mocks.get).toHaveBeenCalledExactlyOnceWith('/settings');
    expect(result.current.preferences).toMatchObject({ theme, density: 'compact' });
    expect(getAppearance()).toEqual({ theme, density: 'compact' });
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(document.body).toHaveClass('table-compact');
  });

  it.each(['light', 'dark', 'system'] as const)('uses a browser %s choice while retaining the server value in the draft', async (theme) => {
    localStorage.setItem(APPEARANCE_THEME_STORAGE_KEY, theme);
    const serverTheme = theme === 'dark' ? 'light' : 'dark';
    const { result } = await loadPreferences([setting('appearance.theme', serverTheme)]);

    expect(result.current.preferences.theme).toBe(theme);
    expect(result.current.draft['appearance.theme']).toBe(serverTheme);
    expect(result.current.dirty).toBe(false);
    expect(localStorage.getItem(APPEARANCE_THEME_STORAGE_KEY)).toBe(theme);
  });

  it('uses the legacy browser preference ahead of the server value', async () => {
    localStorage.setItem('afrinov.settings.v1', JSON.stringify({ theme: 'dark' }));
    const { result } = await loadPreferences([setting('appearance.theme', 'light')]);

    expect(result.current.preferences.theme).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it.each(['automatic', '', null, false])('falls back to light for an invalid server theme %j', async (theme) => {
    const { result } = await loadPreferences([setting('appearance.theme', theme)]);

    expect(result.current.preferences.theme).toBe('light');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('preserves the applied theme when the response contains density but no theme setting', async () => {
    setAppearance({ theme: 'dark' });
    localStorage.clear();
    const { result } = await loadPreferences([setting('appearance.density', 'compact')]);

    expect(result.current.preferences).toMatchObject({ theme: 'dark', density: 'compact' });
    expect(document.documentElement).toHaveClass('dark');
    expect(document.body).toHaveClass('table-compact');
    expect(localStorage.getItem(APPEARANCE_THEME_STORAGE_KEY)).toBeNull();
  });

  it('keeps browser theme changes live without making the server draft dirty or sending a save', async () => {
    const { result } = await loadPreferences([setting('appearance.theme', 'light')]);

    act(() => setAppearance({ theme: 'dark' }));

    expect(result.current.preferences.theme).toBe('dark');
    expect(result.current.draft['appearance.theme']).toBe('light');
    expect(result.current.dirty).toBe(false);
    await act(async () => { expect(await result.current.save()).toEqual({ updated: 0 }); });
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('saves density without overwriting the browser theme or sending it to the server', async () => {
    const { result } = await loadPreferences([
      setting('appearance.theme', 'light'), setting('appearance.density', 'comfortable'),
    ]);
    act(() => {
      setAppearance({ theme: 'dark' });
      result.current.setDraft('appearance.density', 'compact');
    });
    mocks.patch.mockResolvedValue([setting('appearance.density', 'compact')]);

    await act(async () => { expect(await result.current.save()).toEqual({ updated: 1 }); });

    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith('/settings', { updates: { 'appearance.density': 'compact' } });
    expect(result.current.preferences).toMatchObject({ theme: 'dark', density: 'compact' });
    expect(result.current.dirty).toBe(false);
    expect(document.documentElement).toHaveClass('dark');
    expect(document.body).toHaveClass('table-compact');
    expect(localStorage.getItem(APPEARANCE_THEME_STORAGE_KEY)).toBe('dark');
  });

  it('keeps the browser theme when settings are reset on the server', async () => {
    localStorage.setItem(APPEARANCE_THEME_STORAGE_KEY, 'dark');
    const { result } = await loadPreferences([
      setting('appearance.theme', 'system'), setting('appearance.density', 'compact'),
    ]);
    mocks.post.mockResolvedValue([setting('appearance.theme', 'light'), setting('appearance.density', 'comfortable')]);

    await act(async () => { await result.current.resetAll(); });

    expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/settings/reset');
    expect(result.current.preferences).toMatchObject({ theme: 'dark', density: 'comfortable' });
    expect(result.current.settings['appearance.theme']?.value).toBe('light');
    expect(document.documentElement).toHaveClass('dark');
    expect(document.body).not.toHaveClass('table-compact');
  });

  it('retains the applied theme when settings fail to load', async () => {
    setAppearance({ theme: 'dark' });
    const error = { code: 'NETWORK_ERROR', message: 'Offline' };
    mocks.get.mockRejectedValue(error);
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe(error);
    expect(result.current.preferences.theme).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
  });
});
