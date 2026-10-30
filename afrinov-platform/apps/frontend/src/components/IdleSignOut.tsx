// Signs the user out after `security.sessionTimeoutMinutes` without activity
// (PRA-11). Stores PCs are shared: a session left open must not stay usable
// for the token's full 12 hours.
//
// Activity in any tab counts: the last activity time is shared through
// localStorage, so working in one tab keeps another from signing out. Storage
// can be unavailable (private mode, blocked site data); the timer then works
// per tab.
//
// Mounted once at the protected-route boundary (see App.tsx). Renders nothing.
import { useEffect, useRef } from 'react';
import { api, FRONTEND_ONLY } from '../api/client';
import { useAuth } from '../auth';

const SETTING_KEY = 'security.sessionTimeoutMinutes';
const ACTIVITY_KEY = 'afrinov.lastActivity';
/** Used until the setting is read, and when it cannot be. Matches the server default. */
export const DEFAULT_TIMEOUT_MINUTES = 60;
const CHECK_EVERY_MS = 15_000;
/** Activity is recorded at most this often, so typing does not write storage on every key. */
const RECORD_EVERY_MS = 5_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

function readShared(): number | null {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeShared(at: number): void {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(at));
  } catch {
    /* storage unavailable: this tab's own timer still applies */
  }
}

export function IdleSignOut(): null {
  const { expireSession } = useAuth();
  const timeoutMs = useRef(DEFAULT_TIMEOUT_MINUTES * 60_000);
  // Set when the activity effect starts.
  const lastActivity = useRef(0);

  useEffect(() => {
    if (FRONTEND_ONLY) return;
    let cancelled = false;
    api
      .get<Record<string, unknown>>(`/settings/values?keys=${SETTING_KEY}`)
      .then((values) => {
        const minutes = Number(values[SETTING_KEY]);
        if (!cancelled && Number.isFinite(minutes) && minutes > 0) timeoutMs.current = minutes * 60_000;
      })
      .catch(() => { /* keep the default */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (FRONTEND_ONLY) return;
    const start = Date.now();
    lastActivity.current = start;
    writeShared(start);

    const onActivity = () => {
      const now = Date.now();
      if (now - lastActivity.current < RECORD_EVERY_MS) return;
      lastActivity.current = now;
      writeShared(now);
    };
    const check = () => {
      const latest = Math.max(lastActivity.current, readShared() ?? 0);
      if (Date.now() - latest >= timeoutMs.current) expireSession();
    };

    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true });
    // A laptop that slept past the timeout signs out as soon as it wakes.
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity);
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
    };
  }, [expireSession]);

  return null;
}
