// The sign-in log for Admins (system audit F3): who signed in, when, from
// where, the attempts that failed or were held back, and sign-outs. Kept 12
// months on the server.
import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { Alert } from './Alert';
import { Badge } from './Badge';
import { Button } from './Button';
import { Field, Input, Select } from './Field';
import { Skeleton } from './Skeleton';
import { formatDateTime } from '../lib/format';
import { FRONTEND_ONLY } from '../api/client';
import { presentError } from '../lib/errorPresentation';

export type SignInOutcome = 'SIGN_IN' | 'FAILED' | 'THROTTLED' | 'SIGN_OUT';

export interface SignInRow {
  id: string;
  at: string;
  outcome: SignInOutcome;
  email: string;
  user: { id: string; name: string } | null;
  ip: string | null;
  userAgent: string | null;
}

export const OUTCOME_LABEL: Record<SignInOutcome, string> = {
  SIGN_IN: 'Signed in',
  FAILED: 'Wrong email or password',
  THROTTLED: 'Held back: too many wrong passwords',
  SIGN_OUT: 'Signed out',
};

const OUTCOME_TONE: Record<SignInOutcome, 'success' | 'danger' | 'warning' | 'neutral'> = {
  SIGN_IN: 'success', FAILED: 'danger', THROTTLED: 'warning', SIGN_OUT: 'neutral',
};

const PAGE = 50;

/** The query string for the filters, leaving out those not set. */
export function signInQuery(f: { outcome: string; email: string; from: string; to: string; offset: number }): string {
  const q = new URLSearchParams();
  if (f.outcome) q.set('outcome', f.outcome);
  if (f.email.trim()) q.set('email', f.email.trim());
  if (f.from) q.set('from', f.from);
  if (f.to) q.set('to', f.to);
  q.set('limit', String(PAGE));
  if (f.offset) q.set('offset', String(f.offset));
  return q.toString();
}

export function SignInLog() {
  const [outcome, setOutcome] = useState('');
  const [email, setEmail] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const log = useApi<{ total: number; items: SignInRow[] }>(FRONTEND_ONLY ? null : `/sign-ins?${signInQuery({ outcome, email, from, to, offset })}`);
  const filter = (set: (v: string) => void) => (v: string) => { set(v); setOffset(0); };

  if (FRONTEND_ONLY) {
    return <p className="text-sm text-surface-500">The sign-in log is kept by the server, so it is empty in this demo.</p>;
  }
  const rows = log.data?.items ?? [];
  const total = log.data?.total ?? 0;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Field label="What happened" htmlFor="si-outcome">
          <Select id="si-outcome" value={outcome} onChange={(e) => filter(setOutcome)(e.target.value)}>
            <option value="">Everything</option>
            {(Object.keys(OUTCOME_LABEL) as SignInOutcome[]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
          </Select>
        </Field>
        <Field label="Email" htmlFor="si-email">
          <Input id="si-email" value={email} onChange={(e) => filter(setEmail)(e.target.value)} placeholder="Any account" />
        </Field>
        <Field label="From" htmlFor="si-from">
          <Input id="si-from" type="date" value={from} onChange={(e) => filter(setFrom)(e.target.value)} />
        </Field>
        <Field label="To" htmlFor="si-to">
          <Input id="si-to" type="date" value={to} onChange={(e) => filter(setTo)(e.target.value)} />
        </Field>
      </div>

      {log.error && <Alert tone="danger" title="Couldn't load the sign-in log">{presentError(log.error).message}</Alert>}
      {log.loading && !log.data ? (
        <div className="space-y-2"><Skeleton h={28} /><Skeleton h={28} /><Skeleton h={28} /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-surface-500 py-4 text-center">Nothing on the log for these filters.</p>
      ) : (
        <ul className="divide-y divide-surface-200 surface-card p-0 overflow-hidden" aria-label="Sign-in log">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="tabular-nums text-surface-600 w-40 shrink-0">{formatDateTime(r.at)}</span>
              <Badge tone={OUTCOME_TONE[r.outcome]}>{OUTCOME_LABEL[r.outcome]}</Badge>
              <span className="font-medium text-surface-900">{r.user?.name ?? r.email}</span>
              {r.user && <span className="text-surface-500">{r.email}</span>}
              <span className="text-xs text-surface-500 ml-auto truncate max-w-full" title={r.userAgent ?? undefined}>
                {r.ip ?? 'Address not known'}{r.userAgent ? ` · ${r.userAgent.slice(0, 60)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      {total > PAGE && (
        <div className="flex items-center justify-between text-sm text-surface-600">
          <span>{offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Newer</Button>
            <Button size="sm" variant="secondary" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Older</Button>
          </div>
        </div>
      )}
    </div>
  );
}
