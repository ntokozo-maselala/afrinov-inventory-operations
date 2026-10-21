// Unit tests for the shared appearance cache and its theme persistence rules.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  APPEARANCE_THEME_STORAGE_KEY,
  applyTheme,
  getAppearance,
  getStoredThemePreference,
  prefersDark,
  resolveInitialTheme,
  setAppearance,
  useAppearance,
} from './useAppearance';

describe('useAppearance cache', () => {
  beforeEach(() => {
    setAppearance({ theme: 'light', density: 'comfortable' });
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    setAppearance({ theme: 'light', density: 'comfortable' });
    localStorage.clear();
  });

  it('uses light when there is no saved preference, regardless of the OS preference', () => {
    expect(resolveInitialTheme(null)).toBe('light');
    expect(prefersDark(resolveInitialTheme(null), true)).toBe(false);
  });

  it('follows the OS only when System was explicitly selected', () => {
    expect(prefersDark('system', true)).toBe(true);
    expect(prefersDark('system', false)).toBe(false);
  });

  it.each(['light', 'dark', 'system'] as const)('retains an explicitly saved %s preference', (theme) => {
    expect(resolveInitialTheme(theme)).toBe(theme);
  });

  it('reads current and legacy browser preference storage safely', () => {
    const values = new Map<string, string>([[APPEARANCE_THEME_STORAGE_KEY, 'dark']]);
    const storage = { getItem: (key: string) => values.get(key) ?? null };
    expect(getStoredThemePreference(storage)).toBe('dark');

    values.delete(APPEARANCE_THEME_STORAGE_KEY);
    values.set('afrinov.settings.v1', JSON.stringify({ theme: 'light' }));
    expect(getStoredThemePreference(storage)).toBe('light');
    values.set('afrinov.settings.v1', '{invalid');
    expect(getStoredThemePreference(storage)).toBeNull();
    expect(getStoredThemePreference({ getItem: () => { throw new Error('blocked'); } })).toBeNull();
  });

  it('setAppearance updates the cache immutably', () => {
    const before = getAppearance();
    setAppearance({ theme: 'dark' });
    const after = getAppearance();
    expect(after.theme).toBe('dark');
    // The previous value object must not have been mutated.
    expect(before.theme).not.toBe(after.theme);
  });

  it('setAppearance merges partial updates', () => {
    setAppearance({ theme: 'dark' });
    setAppearance({ density: 'compact' });
    const s = getAppearance();
    expect(s.theme).toBe('dark');
    expect(s.density).toBe('compact');
  });

  it('applies theme changes to the document and stores the choice', () => {
    setAppearance({ theme: 'dark' });
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(localStorage.getItem(APPEARANCE_THEME_STORAGE_KEY)).toBe('dark');

    setAppearance({ theme: 'light' });
    expect(document.documentElement).not.toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it.each(['light', 'dark', 'system'] as const)('prefers the current %s choice over conflicting legacy settings', (theme) => {
    localStorage.setItem(APPEARANCE_THEME_STORAGE_KEY, theme);
    localStorage.setItem('afrinov.settings.v1', JSON.stringify({ theme: theme === 'dark' ? 'light' : 'dark' }));

    expect(getStoredThemePreference()).toBe(theme);
  });

  it.each(['light', 'dark', 'system'] as const)('recovers legacy %s when the current value is invalid', (theme) => {
    localStorage.setItem(APPEARANCE_THEME_STORAGE_KEY, 'automatic');
    localStorage.setItem('afrinov.settings.v1', JSON.stringify({ theme }));

    expect(getStoredThemePreference()).toBe(theme);
  });

  it.each(['null', '[]', 'true', '42', '"dark"', '{}', '{"theme":"DARK"}', '{"theme":false}', '{broken'])('rejects an invalid legacy payload %s', (legacy) => {
    localStorage.setItem(APPEARANCE_THEME_STORAGE_KEY, 'invalid');
    localStorage.setItem('afrinov.settings.v1', legacy);

    expect(getStoredThemePreference()).toBeNull();
  });

  it('accepts unavailable storage and ignores malformed legacy data when a current choice exists', () => {
    expect(getStoredThemePreference(null)).toBeNull();
    localStorage.setItem(APPEARANCE_THEME_STORAGE_KEY, 'dark');
    localStorage.setItem('afrinov.settings.v1', '{broken');
    expect(getStoredThemePreference()).toBe('dark');
  });

  it.each([
    ['light', false, false], ['light', true, false],
    ['dark', false, true], ['dark', true, true],
    ['system', false, false], ['system', true, true],
  ] as const)('applies %s with OS dark=%s as dark=%s without saving a choice', (theme, systemDark, expectedDark) => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: systemDark } as MediaQueryList);
    document.documentElement.classList.add('unrelated');
    document.documentElement.classList.toggle('dark', !expectedDark);

    applyTheme(theme);

    expect(document.documentElement.classList.contains('dark')).toBe(expectedDark);
    expect(document.documentElement).toHaveClass('unrelated');
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(document.documentElement.style.colorScheme).toBe(expectedDark ? 'dark' : 'light');
    expect(localStorage.getItem(APPEARANCE_THEME_STORAGE_KEY)).toBeNull();
    document.documentElement.classList.remove('unrelated');
  });

  it('falls back to light for System when matchMedia is unavailable', () => {
    const original = window.matchMedia;
    try {
      window.matchMedia = undefined as unknown as typeof window.matchMedia;
      applyTheme('system');
      expect(document.documentElement).not.toHaveClass('dark');
      expect(document.documentElement.dataset.theme).toBe('system');
      expect(document.documentElement.style.colorScheme).toBe('light');
    } finally {
      window.matchMedia = original;
    }
  });

  it('updates subscribers and the document even when saving to storage fails', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    const { result } = renderHook(() => useAppearance());

    act(() => setAppearance({ theme: 'dark' }));

    expect(result.current.theme).toBe('dark');
    expect(getAppearance().theme).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('does not create a browser theme choice when only density changes', () => {
    const { result } = renderHook(() => useAppearance());

    act(() => setAppearance({ density: 'compact' }));

    expect(result.current).toEqual({ theme: 'light', density: 'compact' });
    expect(document.body).toHaveClass('table-compact');
    expect(localStorage.getItem(APPEARANCE_THEME_STORAGE_KEY)).toBeNull();
  });
});
