// Global settings provider: loads settings from the backend, applies theme
// and density to the document, tracks unsaved changes, and exposes save /
// reset helpers. All routes that need preference data use the `useSettings`
// hook instead of calling the API directly — this guarantees a single source
// of truth and that theme/density always reflect the last server response.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, type ApiError } from '../api/client';
import { setAppearance as setGlobalAppearance } from './useAppearance';

export type SettingType = 'string' | 'number' | 'boolean' | 'enum';
export type SettingCategory =
  | 'general' | 'inventory' | 'purchase_orders' | 'notifications'
  | 'users' | 'appearance' | 'security' | 'system' | 'data';

export interface SettingValue {
  key: string;
  value: unknown;
  type: SettingType;
  category: SettingCategory;
  description: string;
  isEditable: boolean;
  enumOptions: string[] | null;
  updatedAt: string;
  updatedById: string | null;
}

export type SettingMap = Record<string, SettingValue>;
export type DraftMap = Record<string, unknown>;

interface SettingsContextValue {
  // Server state
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
  settings: SettingMap;

  // Local draft (edits not yet persisted)
  draft: DraftMap;
  setDraft: (key: string, value: unknown) => void;
  resetDraft: () => void;
  dirty: boolean;

  // Persistence
  save: () => Promise<{ updated: number }>;
  resetAll: () => Promise<{ updated: number }>;
  saving: boolean;
  resetting: boolean;

  // Validation: a key→error string map for invalid draft values.
  errors: Record<string, string>;

  // Live-applied preferences (always reflect the most recently persisted
  // server value; the draft is not applied until saved).
  preferences: {
    theme: 'system' | 'light' | 'dark';
    density: 'comfortable' | 'compact';
    enableInAppNotifications: boolean;
  };
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function asString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v);
}
function asBool(v: unknown): boolean { return v === true; }
function asNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function validate(def: SettingValue, raw: unknown): string | null {
  switch (def.type) {
    case 'string': {
      if (typeof raw !== 'string') return 'Must be text.';
      const v = raw.trim();
      const max = def.key === 'general.companyName' ? 120 : def.key === 'general.systemDescription' ? 500 : def.key === 'inventory.defaultUnitOfMeasure' ? 20 : 500;
      if (def.key === 'general.companyName' && v.length < 1) return 'Company name is required.';
      if (v.length > max) return `Must be at most ${max} characters.`;
      return null;
    }
    case 'number': {
      if (raw === '' || raw === null || raw === undefined) return 'Required.';
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return 'Must be a number.';
      if (!Number.isInteger(n)) return 'Must be a whole number.';
      const min = def.key === 'general.defaultPageSize' ? 5 : 0;
      const max = def.key === 'general.defaultPageSize' ? 200
        : def.key === 'inventory.urgentBelowPercent' ? 100
        : def.key === 'inventory.warningBelowPercent' ? 1000
        : def.key === 'security.sessionTimeoutMinutes' ? 720 : 1_000_000;
      if (n < min) return `Must be at least ${min}.`;
      if (n > max) return `Must be at most ${max}.`;
      return null;
    }
    case 'boolean':
      if (typeof raw === 'boolean') return null;
      return 'Must be true or false.';
    case 'enum': {
      if (typeof raw !== 'string' || !raw) return 'Selection is required.';
      if (!def.enumOptions || !def.enumOptions.includes(raw)) return 'Selected value is not supported.';
      return null;
    }
  }
}

function applyTheme(theme: 'system' | 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', isDark);
  root.dataset['theme'] = theme;
}

function applyDensity(density: 'comfortable' | 'compact'): void {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle('table-compact', density === 'compact');
}

export function SettingsProvider({ children, canEdit }: { children: ReactNode; canEdit: boolean }) {
  const [all, setAll] = useState<SettingValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);
  const [draft, setDraftState] = useState<DraftMap>({});
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const savedRef = useRef<SettingMap>({});

  // eslint-disable react-hooks/set-state-in-effect
  useEffect(() => {
    let cancelled = false;
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
    setError(null); // eslint-disable-line react-hooks/set-state-in-effect
    api
      .get<SettingValue[]>('/settings')
      .then((rows) => {
        if (cancelled) return;
        setAll(rows); // eslint-disable-line react-hooks/set-state-in-effect
        const map: SettingMap = {};
        for (const r of rows) map[r.key] = r;
        savedRef.current = map;
        setDraftState(buildInitialDraft(rows)); // eslint-disable-line react-hooks/set-state-in-effect
      })
      .catch((e: ApiError) => {
        if (!cancelled) setError(e); // eslint-disable-line react-hooks/set-state-in-effect
      })
      .finally(() => {
        if (!cancelled) setLoading(false); // eslint-disable-line react-hooks/set-state-in-effect
      });
    return () => { cancelled = true; };
  }, [nonce]);
  // eslint-enable react-hooks/set-state-in-effect

  const settings = useMemo<SettingMap>(() => {
    const map: SettingMap = {};
    for (const r of all) map[r.key] = r;
    return map;
  }, [all]);

  // Apply theme + density from the most recent server state. We only do
  // this when not actively saving — otherwise the user could be looking at
  // a stale applied state mid-edit. Also mirror into the global cache so
  // any page can read the last applied value without a re-fetch.
  useEffect(() => {
    if (loading) return;
    const t = (settings['appearance.theme']?.value as 'system' | 'light' | 'dark' | undefined) ?? 'system';
    const d = (settings['appearance.density']?.value as 'comfortable' | 'compact' | undefined) ?? 'comfortable';
    applyTheme(t);
    applyDensity(d);
    setGlobalAppearance({ theme: t, density: d });
  }, [loading, settings]);

  const setDraft = useCallback((key: string, value: unknown) => {
    setDraftState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetDraft = useCallback(() => {
    setDraftState(buildInitialDraft(all));
  }, [all]);

  // eslint-disable-next-line react-hooks/refs
  const dirty = useMemo(() => {
    // eslint-disable-next-line react-hooks/refs
    return Object.keys(draft).some((k) => {
      // eslint-disable-next-line react-hooks/refs
      const def = savedRef.current[k];
      if (!def) return true;
      return !valuesEqual(def.value, draft[k]);
    });
  }, [draft]);

  // eslint-disable react-hooks/refs
  const errors = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const key of Object.keys(draft)) {
      const def = savedRef.current[key]; // eslint-disable-line react-hooks/refs
      if (!def) continue; // eslint-disable-line react-hooks/refs
      const err = validate(def, draft[key]); // eslint-disable-line react-hooks/refs
      if (err) out[key] = err;
    }
    return out;
  }, [draft]);
  // eslint-enable react-hooks/refs

  const save = useCallback(async (): Promise<{ updated: number }> => {
    if (!canEdit) throw { code: 'FORBIDDEN', message: 'You do not have permission to modify settings.' } as ApiError;
    const updates: Record<string, unknown> = {};
    for (const key of Object.keys(draft)) {
      const def = savedRef.current[key];
      if (!def) continue;
      if (valuesEqual(def.value, draft[key])) continue;
      updates[key] = coerceForApi(def, draft[key]);
    }
    if (Object.keys(updates).length === 0) return { updated: 0 };
    setSaving(true);
    try {
      const updated = await api.patch<SettingValue[]>('/settings', { updates });
      const map: SettingMap = {};
      for (const r of updated) map[r.key] = r;
      // Re-merge with the existing rows for keys we didn't update.
      const merged: SettingValue[] = all.map((r) => map[r.key] ?? r);
      setAll(merged);
      const newSaved: SettingMap = {};
      for (const r of merged) newSaved[r.key] = r;
      savedRef.current = newSaved;
      setDraftState(buildInitialDraft(merged));
      return { updated: updated.length };
    } finally {
      setSaving(false);
    }
  }, [all, canEdit, draft]);

  const resetAll = useCallback(async (): Promise<{ updated: number }> => {
    if (!canEdit) throw { code: 'FORBIDDEN', message: 'You do not have permission to reset settings.' } as ApiError;
    setResetting(true);
    try {
      const updated = await api.post<SettingValue[]>('/settings/reset');
      const map: SettingMap = {};
      for (const r of updated) map[r.key] = r;
      const merged: SettingValue[] = all.map((r) => map[r.key] ?? r);
      setAll(merged);
      const newSaved: SettingMap = {};
      for (const r of merged) newSaved[r.key] = r;
      savedRef.current = newSaved;
      setDraftState(buildInitialDraft(merged));
      return { updated: updated.length };
    } finally {
      setResetting(false);
    }
  }, [all, canEdit]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const preferences = useMemo(() => ({
    theme: (settings['appearance.theme']?.value as 'system' | 'light' | 'dark') ?? 'system',
    density: (settings['appearance.density']?.value as 'comfortable' | 'compact') ?? 'comfortable',
    enableInAppNotifications: asBool(settings['notifications.enableInAppNotifications']?.value ?? true),
  }), [settings]);

  const value: SettingsContextValue = {
    loading, error, reload, settings,
    draft, setDraft, resetDraft, dirty,
    save, resetAll, saving, resetting,
    errors,
    preferences,
  };
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
  return ctx;
}

function buildInitialDraft(rows: SettingValue[]): DraftMap {
  const out: DraftMap = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'string') return String(a) === b;
  if (typeof a === 'string' && typeof b === 'number') return a === String(b);
  if (typeof a === 'boolean' && typeof b === 'string') return String(a) === b;
  if (typeof a === 'string' && typeof b === 'boolean') return a === String(b);
  return false;
}

function coerceForApi(def: SettingValue, raw: unknown): unknown {
  switch (def.type) {
    case 'string': return typeof raw === 'string' ? raw.trim() : raw;
    case 'number': return typeof raw === 'number' ? raw : Number(raw);
    case 'boolean': return typeof raw === 'boolean' ? raw : Boolean(raw);
    case 'enum': return raw;
  }
}

// Convenience hooks used by other pages.
export function useAppPreferences(): { theme: 'system' | 'light' | 'dark'; density: 'comfortable' | 'compact' } {
  const { preferences } = useSettings();
  return { theme: preferences.theme, density: preferences.density };
}

export { asString, asBool, asNumber };
