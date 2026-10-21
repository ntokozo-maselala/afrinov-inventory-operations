// Global preference applier: reads just the theme + density settings from
// the authenticated values endpoint and applies them to the document. This means
// the user's chosen theme and density take effect on every page, not only
// inside Settings.
//
// Mounted once at the protected-route boundary (see App.tsx).
import { useEffect, useRef } from 'react';
import { api, FRONTEND_ONLY } from '../api/client';
import { applyTheme, applyDensity, setAppearance, getAppearance, getStoredThemePreference, type AppTheme, type AppDensity } from '../hooks/useAppearance';

const THEME_KEYS = ['appearance.theme', 'appearance.density'] as const;

export function GlobalPreferencesApplier({ onReady }: { onReady?: () => void }): null {
  const readyRef = useRef(false);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    let cancelled = false;
    const markReady = () => {
      if (cancelled || readyRef.current) return;
      readyRef.current = true;
      onReadyRef.current?.();
    };
    if (FRONTEND_ONLY) {
      // In mock mode, MOCK_SETTINGS already contains the latest values. The
      // Settings provider applies mock settings after loading. Keep the
      // synchronously bootstrapped browser choice while density initializes.
      applyTheme(getAppearance().theme);
      applyDensity('comfortable');
      markReady();
      return () => { cancelled = true; };
    }
    api
      .get<{ 'appearance.theme'?: string; 'appearance.density'?: string }>(`/settings/values?keys=${THEME_KEYS.join(',')}`)
      .then((values) => {
        if (cancelled) return;
        const serverTheme = (values['appearance.theme'] as AppTheme | undefined) ?? 'light';
        const theme = getStoredThemePreference() ?? serverTheme;
        const density = (values['appearance.density'] as AppDensity | undefined) ?? 'comfortable';
        setAppearance({ theme, density });
      })
      .catch(() => {
        // Network or auth error — leave defaults.
      })
      .finally(() => {
        markReady();
      });
    return () => { cancelled = true; };
  }, []);

  return null;
}
