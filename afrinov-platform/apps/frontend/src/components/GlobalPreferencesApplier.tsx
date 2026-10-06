// Global preference applier: reads just the theme + density settings from
// the public values endpoint and applies them to the document. This means
// the user's chosen theme and density take effect on every page, not only
// inside Settings.
//
// Mounted once at the protected-route boundary (see App.tsx).
import { useEffect } from 'react';
import { api, FRONTEND_ONLY } from '../api/client';
import { applyTheme, applyDensity, setAppearance, getAppearance, type AppTheme, type AppDensity } from '../hooks/useAppearance';

const THEME_KEYS = ['appearance.theme', 'appearance.density'] as const;

export function GlobalPreferencesApplier(): null {
  useEffect(() => {
    if (FRONTEND_ONLY) {
      // In mock mode, MOCK_SETTINGS already contains the latest values. The
      // mock layer mirrors theme/density into the global cache when the
      // settings PATCH endpoint is hit; here we just read the defaults.
      applyTheme('system');
      applyDensity('comfortable');
      return;
    }
    let cancelled = false;
    api
      .get<{ 'appearance.theme'?: string; 'appearance.density'?: string }>(`/settings/values?keys=${THEME_KEYS.join(',')}`)
      .then((values) => {
        if (cancelled) return;
        const theme = (values['appearance.theme'] as AppTheme | undefined) ?? 'system';
        const density = (values['appearance.density'] as AppDensity | undefined) ?? 'comfortable';
        setAppearance({ theme, density });
      })
      .catch(() => {
        // Network or auth error — leave defaults.
      });
    return () => { cancelled = true; };
  }, []);

  // Apply the OS-level theme change for `system` mode.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      // Re-apply the user's current stored theme so that OS-level changes
      // only take effect when the user has chosen 'system'.
      const current = getAppearance().theme;
      applyTheme(current);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return null;
}
