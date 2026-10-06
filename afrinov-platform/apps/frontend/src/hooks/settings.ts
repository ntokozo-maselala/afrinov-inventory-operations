// Lightweight user-preferences store backed by localStorage.
// Keeps the Settings page truly persistent without inventing a server-side
// settings engine that the current backend does not support.
const KEY = 'afrinov.settings.v1';

export type ThemePreference = 'system' | 'light' | 'dark';
export type TableDensity = 'comfortable' | 'compact';

export interface UserSettings {
  theme: ThemePreference;
  density: TableDensity;
  showLowStockAlerts: boolean;
  defaultReportingRange: 'TODAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';
}

const DEFAULTS: UserSettings = {
  theme: 'system',
  density: 'comfortable',
  showLowStockAlerts: true,
  defaultReportingRange: 'MONTH',
};

export function loadSettings(): UserSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(next: UserSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // localStorage may be unavailable (private mode); silently no-op.
  }
}

export function applyTheme(theme: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', isDark);
}