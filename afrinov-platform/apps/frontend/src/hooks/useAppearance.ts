// Lightweight settings cache used outside the Settings subtree.
//
// The Settings page has its own provider with the full catalog + draft
// semantics. This module is a tiny cache of the last-known applied
// preferences so any page (e.g. GlobalPreferencesApplier, the login page,
// public views) can read the user's chosen theme/density without hitting
// the API. The SettingsProvider mirrors the latest server values into this
// cache on every successful load/save, keeping the two in sync.
//
// No external state-management dependency — the project standard is plain
// React state + a tiny module-level cache.
import { useEffect, useState } from 'react';

export type AppTheme = 'system' | 'light' | 'dark';
export type AppDensity = 'comfortable' | 'compact';

export const APPEARANCE_THEME_STORAGE_KEY = 'afrinov.appearance.theme.v1';
const LEGACY_SETTINGS_STORAGE_KEY = 'afrinov.settings.v1';

/** Recognize the supported browser theme preference values. */
function isAppTheme(value: unknown): value is AppTheme {
  return value === 'system' || value === 'light' || value === 'dark';
}

/**
 * Read a valid theme from the current storage key, falling back to legacy settings.
 * Omitted `storage` uses browser localStorage; null disables storage reads.
 * Returns null when no valid theme is found or storage access/JSON parsing fails.
 */
export function getStoredThemePreference(storage?: Pick<Storage, 'getItem'> | null): AppTheme | null {
  try {
    const source = storage === undefined
      ? (typeof window === 'undefined' ? null : window.localStorage)
      : storage;
    if (!source) return null;

    const savedTheme = source.getItem(APPEARANCE_THEME_STORAGE_KEY);
    if (isAppTheme(savedTheme)) return savedTheme;

    // Read preferences saved by the earlier local settings store, if present.
    const legacy = source.getItem(LEGACY_SETTINGS_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as { theme?: unknown };
      if (isAppTheme(parsed.theme)) return parsed.theme;
    }
  } catch {
    // Storage may be unavailable or contain invalid JSON. Use the product default.
  }
  return null;
}

/** A fresh install always starts light, regardless of the OS color scheme. */
export function resolveInitialTheme(storedTheme: AppTheme | null): AppTheme {
  return storedTheme ?? 'light';
}

/** Resolve dark mode, using the device preference only for the `system` theme. */
export function prefersDark(theme: AppTheme, systemPrefersDark: boolean): boolean {
  return theme === 'dark' || (theme === 'system' && systemPrefersDark);
}

interface AppearanceState {
  theme: AppTheme;
  density: AppDensity;
}

const subscribers = new Set<(s: AppearanceState) => void>();
let current: AppearanceState = { theme: resolveInitialTheme(getStoredThemePreference()), density: 'comfortable' };

export function getAppearance(): AppearanceState {
  return current;
}

/**
 * Merge preferences into the shared cache and notify subscribers synchronously.
 * When a document is available, apply supplied theme/density values and attempt
 * to persist the supplied theme in localStorage. Storage write errors are ignored;
 * subscriber or document update errors propagate after the cache has changed.
 */
export function setAppearance(next: Partial<AppearanceState>): void {
  current = { ...current, ...next };
  for (const fn of subscribers) fn(current);
  if (typeof document !== 'undefined') {
    if (next.theme !== undefined) {
      applyTheme(next.theme);
      try {
        window.localStorage.setItem(APPEARANCE_THEME_STORAGE_KEY, next.theme);
      } catch {
        // Theme still applies for this page when storage is unavailable.
      }
    }
    if (next.density !== undefined) applyDensity(next.density);
  }
}

/**
 * Set the root dark class, theme marker, and browser color scheme.
 * `system` uses the current device preference, falling back to light when
 * matchMedia is unavailable. Does nothing when there is no document.
 */
export function applyTheme(theme: AppTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const systemPrefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
  const isDark = prefersDark(theme, systemPrefersDark);
  root.classList.toggle('dark', isDark);
  root.dataset['theme'] = theme;
  root.style.colorScheme = isDark ? 'dark' : 'light';
}

export function applyDensity(density: AppDensity): void {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle('table-compact', density === 'compact');
}

export function useAppearance(): AppearanceState {
  const [s, setS] = useState<AppearanceState>(current);
  useEffect(() => {
    subscribers.add(setS);
    return () => { subscribers.delete(setS); };
  }, []);
  return s;
}
