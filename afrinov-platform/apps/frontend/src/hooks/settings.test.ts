import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, loadSettings, saveSettings } from './settings';

beforeEach(() => { localStorage.clear(); });
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
});

describe('legacy appearance settings', () => {
  it.each([null, '{broken'])('defaults a missing or malformed preference (%s) to light on a dark OS', (stored) => {
    if (stored !== null) localStorage.setItem('afrinov.settings.v1', stored);
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);

    const settings = loadSettings();
    applyTheme(settings.theme);

    expect(settings.theme).toBe('light');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it.each(['light', 'dark', 'system'] as const)('preserves saved %s preferences with the new default', (theme) => {
    saveSettings({ ...loadSettings(), theme });

    expect(loadSettings().theme).toBe(theme);
  });

  it.each([
    ['light', true, false], ['dark', false, true], ['system', true, true], ['system', false, false],
  ] as const)('applies %s on OS dark=%s through the central document theme behavior', (theme, systemDark, expectedDark) => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: systemDark } as MediaQueryList);

    applyTheme(theme);

    expect(document.documentElement.classList.contains('dark')).toBe(expectedDark);
    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(document.documentElement.style.colorScheme).toBe(expectedDark ? 'dark' : 'light');
  });
});
