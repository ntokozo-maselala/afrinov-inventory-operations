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

interface AppearanceState {
  theme: AppTheme;
  density: AppDensity;
}

const subscribers = new Set<(s: AppearanceState) => void>();
let current: AppearanceState = { theme: 'system', density: 'comfortable' };

export function getAppearance(): AppearanceState {
  return current;
}

export function setAppearance(next: Partial<AppearanceState>): void {
  current = { ...current, ...next };
  for (const fn of subscribers) fn(current);
  if (typeof document !== 'undefined') {
    if (next.theme !== undefined) applyTheme(next.theme);
    if (next.density !== undefined) applyDensity(next.density);
  }
}

export function applyTheme(theme: AppTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', isDark);
  root.dataset['theme'] = theme;
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
