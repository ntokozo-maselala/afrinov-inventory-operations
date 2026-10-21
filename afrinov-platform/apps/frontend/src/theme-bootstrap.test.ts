import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import html from '../index.html?raw';
import { APPEARANCE_THEME_STORAGE_KEY } from './hooks/useAppearance';

// Run the actual inline script: a copy of its logic would miss regressions in
// the first paint before React and the appearance store have initialized.
const bootstrap = new DOMParser().parseFromString(html, 'text/html').querySelector('head script:not([src])');
if (!bootstrap?.textContent) throw new Error('The initial theme script is missing from index.html');
const applyInitialTheme = new Function('localStorage', 'matchMedia', 'document', bootstrap.textContent);

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.add('dark', 'unrelated');
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark', 'unrelated');
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
});

describe('initial document theme', () => {
  it.each([
    [null, true, 'light', false],
    ['light', true, 'light', false],
    ['dark', false, 'dark', true],
    ['system', true, 'system', true],
    ['system', false, 'system', false],
  ] as const)('resolves stored %s with OS dark=%s before React starts', (stored, systemDark, expectedTheme, expectedDark) => {
    if (stored !== null) localStorage.setItem(APPEARANCE_THEME_STORAGE_KEY, stored);
    const matchMedia = vi.fn(() => ({ matches: systemDark }));

    applyInitialTheme(localStorage, matchMedia, document);

    expect(document.documentElement.classList.contains('dark')).toBe(expectedDark);
    expect(document.documentElement).toHaveClass('unrelated');
    expect(document.documentElement.dataset.theme).toBe(expectedTheme);
    expect(document.documentElement.style.colorScheme).toBe(expectedDark ? 'dark' : 'light');
    if (stored === 'system') expect(matchMedia).toHaveBeenCalledExactlyOnceWith('(prefers-color-scheme: dark)');
    else expect(matchMedia).not.toHaveBeenCalled();
  });

  it.each(['light', 'dark', 'system'] as const)('prefers a current %s choice over conflicting legacy data', (theme) => {
    localStorage.setItem(APPEARANCE_THEME_STORAGE_KEY, theme);
    localStorage.setItem('afrinov.settings.v1', JSON.stringify({ theme: theme === 'dark' ? 'light' : 'dark' }));

    applyInitialTheme(localStorage, () => ({ matches: true }), document);

    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(document.documentElement.classList.contains('dark')).toBe(theme !== 'light');
  });

  it.each(['light', 'dark', 'system'] as const)('recovers a legacy %s choice when current storage is invalid', (theme) => {
    localStorage.setItem(APPEARANCE_THEME_STORAGE_KEY, 'invalid');
    localStorage.setItem('afrinov.settings.v1', JSON.stringify({ theme }));

    applyInitialTheme(localStorage, () => ({ matches: false }), document);

    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(document.documentElement.classList.contains('dark')).toBe(theme === 'dark');
  });

  it.each(['{broken', 'null', '[]', '42', '{"theme":"DARK"}', '{"theme":null}'])('falls back to light for invalid legacy data %s', (legacy) => {
    localStorage.setItem('afrinov.settings.v1', legacy);

    applyInitialTheme(localStorage, () => ({ matches: true }), document);

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('falls back to light when storage access throws', () => {
    const storage = { getItem: () => { throw new Error('Storage is blocked'); } };

    expect(() => applyInitialTheme(storage, () => ({ matches: true }), document)).not.toThrow();

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('applies System as light when matchMedia is unavailable', () => {
    localStorage.setItem(APPEARANCE_THEME_STORAGE_KEY, 'system');

    applyInitialTheme(localStorage, undefined, document);

    expect(document.documentElement.dataset.theme).toBe('system');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });
});
