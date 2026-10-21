// Unit tests for the shared appearance cache and its theme persistence rules.
import { describe, it, expect } from 'vitest';
import {
  APPEARANCE_THEME_STORAGE_KEY,
  getAppearance,
  getStoredThemePreference,
  prefersDark,
  resolveInitialTheme,
  setAppearance,
} from './useAppearance';

describe('useAppearance cache', () => {
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
});
