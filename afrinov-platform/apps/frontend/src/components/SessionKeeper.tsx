// Idle sign-out (ADR-035), mounted once in the app shell. The server refuses
// a token once the idle time set in Settings → Security has passed; this keeps
// a working person signed in by renewing it, warns in the last minute when
// nothing has happened, and ends the session when the token runs out, the
// same way a refused request does. A screen left alone on the store counter
// signs itself out.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, FRONTEND_ONLY, getToken, setToken, SESSION_EXPIRED_EVENT, type SessionExpiredDetail } from '../api/client';
import { canRenew, readLastActivity, readSessionTimes, recordActivity, sessionPhase, type SessionTimes } from '../lib/session';
import { Modal } from './Modal';
import { Button } from './Button';

const TICK_MS = 1000;
/** After a renewal fails for a reason other than a refused token, wait this long before the next. */
const RETRY_AFTER_MS = 30_000;
/** Activity is written to storage at most this often; pointer and key events come in bursts. */
const RECORD_EVERY_MS = 5000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

interface Warning { endsAt: number; renewable: boolean }

function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function SessionKeeper({ onSignOut }: { onSignOut: () => void }) {
  const [warning, setWarning] = useState<Warning | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const renewing = useRef(false);
  const retryAt = useRef(0);
  const endedFor = useRef<string | null>(null);
  const lastRecorded = useRef(0);
  const parsed = useRef<{ token: string | null; times: SessionTimes | null }>({ token: null, times: null });

  /** The current token and its times, read again only when the token changes (another tab may renew it). */
  const current = useCallback(() => {
    const token = getToken();
    if (token !== parsed.current.token) parsed.current = { token, times: readSessionTimes(token) };
    return parsed.current;
  }, []);

  const renew = useCallback(async () => {
    const sent = current().token;
    if (renewing.current || !sent || Date.now() < retryAt.current) return;
    renewing.current = true;
    try {
      const res = await api.post<{ token?: unknown }>('/auth/refresh');
      // Only for the sign-in it was asked for: a sign-out or a new sign-in meanwhile wins.
      if (typeof res?.token === 'string' && readSessionTimes(res.token) && getToken() === sent) setToken(res.token);
    } catch {
      // A refused token is announced by the API client and ends the session there.
      // Anything else (offline, a timeout) is tried again shortly, while there is time.
      retryAt.current = Date.now() + RETRY_AFTER_MS;
    } finally {
      renewing.current = false;
    }
  }, [current]);

  useEffect(() => {
    if (FRONTEND_ONLY) return;
    const onActivity = () => {
      const t = Date.now();
      if (t - lastRecorded.current < RECORD_EVERY_MS) return;
      lastRecorded.current = t;
      recordActivity(t);
    };
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, onActivity, { capture: true, passive: true });
    return () => {
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, onActivity, { capture: true });
    };
  }, []);

  useEffect(() => {
    if (FRONTEND_ONLY) return;
    const check = () => {
      const t = Date.now();
      setNow(t);
      const { token, times } = current();
      if (!token || !times) { setWarning(null); return; }
      const phase = sessionPhase({ now: t, times, lastActivity: readLastActivity() });
      if (phase === 'ended') {
        setWarning(null);
        if (endedFor.current === token) return;
        endedFor.current = token;
        window.dispatchEvent(new CustomEvent<SessionExpiredDetail>(SESSION_EXPIRED_EVENT, { detail: { token } }));
        return;
      }
      if (phase === 'renew') void renew();
      setWarning(phase === 'warn' ? { endsAt: times.expiresAt, renewable: canRenew(times) } : null);
    };
    check();
    const id = setInterval(check, TICK_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [current, renew]);

  const stay = useCallback(() => {
    recordActivity(Date.now());
    retryAt.current = 0;
    void renew();
  }, [renew]);

  if (!warning) return null;
  const left = countdown(warning.endsAt - now);
  return (
    <Modal
      open
      // Escape or a tap outside: the person is here, so it counts as staying.
      onClose={warning.renewable ? stay : () => {}}
      title={warning.renewable ? 'Are you still there?' : 'Your sign-in is ending'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onSignOut}>Sign out</Button>
          {warning.renewable && <Button onClick={stay}>Stay signed in</Button>}
        </>
      }
    >
      <p className="text-sm text-surface-700" aria-live="polite">
        {warning.renewable
          ? <>Nothing has happened here for a while, so you will be signed out in {left}. Anything not saved will be lost.</>
          : <>A sign-in lasts 12 hours. You will be signed out in {left}; save your work and sign in again.</>}
      </p>
    </Modal>
  );
}
