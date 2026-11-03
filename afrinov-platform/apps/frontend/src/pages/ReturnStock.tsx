// Return stock at the store counter: who is bringing it back, then for each
// issue it came from (GET /inventory-returns/returnable) how much goes back on
// the shelf and, for items that track use, how much was used up or broken
// (ADR-026), booked all-or-nothing (POST /inventory-returns). Consumables are
// mostly used up, so the list covers a recent period, 30 days unless changed.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field, Input, Select, Textarea } from '../components/Field';
import { Alert } from '../components/Alert';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { RecipientSelect, type RecipientOption } from '../components/IssueFields';
import { usePermissions } from '../hooks/usePermissions';
import { NoAccess } from '../components/NoAccess';
import { api, type ApiError } from '../api/client';
import { formatDate, formatNumber } from '../lib/format';
import { daysAgo, today } from '../lib/dates';
import { useIdempotencyKey } from '../lib/idempotency';
import type { ReturnableLine } from '../api/types';
import { locationLabel } from '../lib/locations';
import { StaleDataNotice } from '../components/StaleDataNotice';

interface Location { id: string; name: string; active: boolean; parent?: { name: string } | null }

/** What is typed on one line: back on the shelf, used up, broken. */
type Entry = { back?: string; usedUp?: string; broken?: string };
type Amounts = { back: number | null; usedUp: number | null; broken: number | null };

/** The typed quantity, or null when blank; NaN when it is not a usable number. */
function parseQty(text: string | undefined): number | null {
  if (text === undefined || text.trim() === '') return null;
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

const positive = (n: number | null) => (n !== null && n > 0 ? n : 0);

/** "2 back on the shelf, 6 used up, 1 broken": the parts that are there. */
function describe(t: { back: number; usedUp: number; broken: number }): string {
  return [
    t.back > 0 && `${formatNumber(t.back)} back on the shelf`,
    t.usedUp > 0 && `${formatNumber(t.usedUp)} used up`,
    t.broken > 0 && `${formatNumber(t.broken)} broken`,
  ].filter(Boolean).join(', ');
}

export function ReturnStock() {
  // The Recipients page links here with ?recipientId=.
  const [params] = useSearchParams();
  const [recipientId, setRecipientId] = useState(() => params.get('recipientId') ?? '');
  const [since, setSince] = useState(() => daysAgo(30));
  // Anyone who was issued stock can bring it back, including someone since made inactive.
  const recipients = useApi<RecipientOption[]>('/recipients');
  const locations = useApi<Location[]>('/locations');
  const badSince = !since || since > today();
  const lines = useApi<ReturnableLine[]>(recipientId && !badSince
    ? `/inventory-returns/returnable?${new URLSearchParams({ recipientId, from: since, to: today() }).toString()}`
    : null);
  const [entry, setEntry] = useState<Record<string, Entry>>({});
  const [into, setInto] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The booking just made, kept on the page (a toast fades) with a way to see it in the report.
  const [last, setLast] = useState<{ title: string; recipientId: string; returned: boolean } | null>(null);
  const toast = useToast();
  const idem = useIdempotencyKey('return-stock');

  const activeLocations = useMemo(() => (locations.data ?? []).filter((l) => l.active).sort((a, b) => a.name.localeCompare(b.name)), [locations.data]);
  const who = (recipients.data ?? []).find((r) => r.id === recipientId)?.name;
  const rows = lines.data ?? [];
  // Used up and broken appear only when one of the lines is an item that tracks use.
  const anyTracked = rows.some((l) => l.trackUse);

  const setField = (id: string, key: keyof Entry, value: string) => setEntry((s) => ({ ...s, [id]: { ...s[id], [key]: value } }));
  const amounts = (l: ReturnableLine): Amounts => {
    const e = entry[l.issueTransactionId] ?? {};
    return { back: parseQty(e.back), usedUp: l.trackUse ? parseQty(e.usedUp) : null, broken: l.trackUse ? parseQty(e.broken) : null };
  };
  const total = (a: Amounts) => positive(a.back) + positive(a.usedUp) + positive(a.broken);
  /** Where a line goes back: the choice, else where it was issued from if that is still in use. */
  const target = (l: ReturnableLine) => into[l.issueTransactionId] ?? (l.locationActive ? l.locationId : '');
  const touched = (l: ReturnableLine) => Object.values(amounts(l)).some((v) => v !== null);
  const entered = rows.filter(touched);
  const problem = (l: ReturnableLine): string | null => {
    const a = amounts(l);
    const typed = Object.values(a).filter((v): v is number => v !== null);
    if (typed.length === 0) return null;
    if (typed.some((v) => Number.isNaN(v) || v < 0)) return 'Enter a number above 0';
    if (total(a) <= 0) return 'Enter a number above 0';
    if (total(a) > Number(l.outstanding)) return `At most ${l.outstanding}`;
    if (positive(a.back) > 0 && !target(l)) return 'Choose where it goes back';
    return null;
  };

  function chooseRecipient(id: string) {
    // A different recipient is a different booking, so the draft is cleared and
    // the pending submission key for the previous one is left in place (it may
    // still need reconciling) while the next submit mints its own key from its
    // own payload. Nothing to rotate here: keys are per payload.
    setRecipientId(id);
    setEntry({});
    setInto({});
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!recipientId) { setError('Choose who is bringing the stock back.'); return; }
    if (entered.length === 0) { setError('Enter how much of at least one item is coming back.'); return; }
    if (entered.some((l) => problem(l))) { setError('Check the highlighted lines.'); return; }

    const sum = { back: 0, usedUp: 0, broken: 0 };
    const returnBody = {
      reason: note.trim() || undefined,
      lines: entered.map((l) => {
        const a = amounts(l);
        sum.back += positive(a.back); sum.usedUp += positive(a.usedUp); sum.broken += positive(a.broken);
        const back = positive(a.back) > 0;
        return {
          issueTransactionId: l.issueTransactionId,
          ...(back ? { quantity: a.back! } : {}),
          ...(positive(a.usedUp) > 0 ? { usedUp: a.usedUp! } : {}),
          ...(positive(a.broken) > 0 ? { broken: a.broken! } : {}),
          locationId: back && target(l) !== l.locationId ? target(l) : undefined,
        };
      }),
    };
    setBusy(true);
    try {
      await api.post('/inventory-returns', returnBody, { idempotencyKey: idem.keyFor(returnBody) });
      const title = sum.usedUp + sum.broken > 0
        ? `${who ?? 'Booked'}: ${describe(sum)}`
        : `Returned ${entered.length} item${entered.length === 1 ? '' : 's'}${who ? ` from ${who}` : ''}`;
      toast.success(title);
      setLast({ title, recipientId, returned: sum.back > 0 });
      setEntry({});
      setInto({});
      setNote('');
      idem.confirm();
      lines.reload();
    } catch (err) {
      idem.resolve(err);
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  // Each required list is judged on its own: a stale result from one must not
  // conceal a hard failure in another and leave the form with an empty list.
  const sources = [recipients, locations];
  const hardError = sources.find((s) => s.error && !s.stale)?.error ?? null;
  const loadFailed = hardError !== null;
  const loadStale = !loadFailed && sources.some((s) => s.stale);

  // Reached by a typed or old link: say so rather than offer a form the server would refuse.
  const allowed = usePermissions().hasPermission('inventory:return');
  if (!allowed) return <NoAccess title="Return stock" action="book stock returns" />;

  const qtyBox = (l: ReturnableLine, key: keyof Entry, label: string, bad: boolean) => (
    <Input
      aria-label={`${label}: ${l.name}, issued ${formatDate(l.postedAt)}`}
      className="w-20 ml-auto text-right"
      type="text"
      inputMode="decimal"
      value={entry[l.issueTransactionId]?.[key] ?? ''}
      onChange={(e) => setField(l.issueTransactionId, key, e.target.value)}
      invalid={bad}
    />
  );

  return (
    <div>
      <PageHeader
        title="Return stock"
        description="Record what comes back from a job: who brought it, and against each issue how much goes back on the shelf and, for items that track use, how much was used up or broken. What goes back on the shelf lowers its project's stock used."
        breadcrumb={[{ label: 'Stock', to: '/stock' }, { label: 'Return stock' }]}
      />

      {loadFailed && <ErrorState error={hardError} onRetry={() => { recipients.reload(); locations.reload(); }} />}
      {loadStale && <StaleDataNotice error={sources.find((s) => s.stale)?.error} onRetry={() => { recipients.reload(); locations.reload(); }} label="Some lists could not be refreshed" />}

      {last && (
        <Alert tone="success" title={last.title} className="mb-4 max-w-6xl">
          {last.returned && (
            <>
              <Link to={`/movements?report=returned&recipientId=${encodeURIComponent(last.recipientId)}&from=${today()}&to=${today()}`} className="btn-link">
                See it in Returned stock
              </Link>
              {' '}under Movements.{' '}
            </>
          )}
          The list below shows what is still out.
        </Alert>
      )}

      {!loadFailed && (
        <form onSubmit={submit} className="surface-card p-4 space-y-5 max-w-6xl" noValidate>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RecipientSelect
              id="return-recipient"
              label="Returned by"
              help="Who is bringing the stock back."
              value={recipientId}
              onChange={chooseRecipient}
              recipients={recipients.data ?? []}
              disabled={recipients.loading}
              invalid={!!error && !recipientId}
            />
            <Field label="Issued since" htmlFor="return-since" help="Issues before this date are not listed. Go further back for a long job." error={badSince ? 'Choose a date up to today.' : null}>
              <Input id="return-since" type="date" value={since} max={today()} onChange={(e) => setSince(e.target.value)} invalid={badSince} />
            </Field>
          </div>

          {recipientId && !badSince && lines.error && !lines.stale && <ErrorState error={lines.error} onRetry={lines.reload} />}
          {recipientId && !badSince && lines.stale && <StaleDataNotice error={lines.error} onRetry={lines.reload} />}

          {recipientId && !badSince && (!lines.error || lines.stale) && (
            <fieldset className="space-y-3">
              <legend className="text-h3 text-surface-900 mb-2">Still out{who ? ` with ${who}` : ''}</legend>
              {anyTracked && (
                <p className="text-sm text-surface-600">
                  For items that track use, also enter what came back worn out (used up) or broken. Those don&apos;t go back on the shelf: they left it when they were issued.
                </p>
              )}
              {lines.loading && <p className="text-sm text-surface-500">Loading…</p>}
              {!lines.loading && rows.length === 0 && (
                <EmptyState
                  title="Nothing to return"
                  description={`Nothing issued to ${who ?? 'them'} since ${formatDate(since)} is still out. Choose an earlier date to look further back.`}
                />
              )}
              {!lines.loading && rows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Issued</th>
                        <th scope="col">Item</th>
                        <th scope="col">Project</th>
                        <th scope="col" className="text-right">Still out</th>
                        <th scope="col" className="text-right">Back on the shelf</th>
                        {anyTracked && <th scope="col" className="text-right">Used up</th>}
                        {anyTracked && <th scope="col" className="text-right">Broken</th>}
                        <th scope="col">Back into</th>
                        <th scope="col" className="text-right">Still out after</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((l) => {
                        const id = l.issueTransactionId;
                        const bad = problem(l);
                        const a = amounts(l);
                        const after = Number(l.outstanding) - total(a);
                        const backing = positive(a.back) > 0;
                        return (
                          <tr key={id}>
                            <td className="whitespace-nowrap text-surface-600">{formatDate(l.postedAt)}</td>
                            <td>
                              <span className="font-mono text-xs">{l.sku}</span> {l.name}
                              {l.trackUse && <span className="block text-xs text-surface-500">Tracks use after issue</span>}
                              {Number(l.returned) > 0 && <span className="block text-xs text-surface-500">{l.returned} of {l.issued} already back</span>}
                              {Number(l.closedOff ?? 0) > 0 && <span className="block text-xs text-surface-500">{l.closedOff} of {l.issued} marked used up or broken</span>}
                            </td>
                            <td className="text-surface-600">{l.projectNumber ?? <span className="text-surface-300">—</span>}</td>
                            <td className="text-right tabular-nums whitespace-nowrap">{l.outstanding} <span className="text-meta">{l.unitOfMeasure}</span></td>
                            <td className="text-right">{qtyBox(l, 'back', 'Back on the shelf', !!bad && a.back !== null)}</td>
                            {anyTracked && <td className="text-right">{l.trackUse ? qtyBox(l, 'usedUp', 'Used up', !!bad && a.usedUp !== null) : <span className="text-surface-300" title="This item does not track use after issue">—</span>}</td>}
                            {anyTracked && <td className="text-right">{l.trackUse ? qtyBox(l, 'broken', 'Broken', !!bad && a.broken !== null) : <span className="text-surface-300" title="This item does not track use after issue">—</span>}</td>}
                            <td>
                              <Select
                                aria-label={`Back into: ${l.name}, issued ${formatDate(l.postedAt)}`}
                                className="min-w-48"
                                value={target(l)}
                                onChange={(e) => setInto((s) => ({ ...s, [id]: e.target.value }))}
                                disabled={locations.loading || (touched(l) && !backing)}
                              >
                                <option value="">— choose —</option>
                                {activeLocations.map((loc) => <option key={loc.id} value={loc.id}>{locationLabel(loc)}{loc.id === l.locationId ? ' (issued from)' : ''}</option>)}
                              </Select>
                            </td>
                            <td className="text-right tabular-nums whitespace-nowrap">
                              {touched(l) && !bad ? formatNumber(after) : <span className="text-surface-300">—</span>}
                              {bad && <span className="block text-xs text-danger-700 mt-1">{bad}</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </fieldset>
          )}

          {recipientId && rows.length > 0 && (
            <Field label="Note (optional)" htmlFor="return-note" help="Kept with every line, e.g. why it came back or how a disc broke.">
              <Textarea id="return-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Job finished early" />
            </Field>
          )}

          {error && <Alert tone="danger" title="Cannot return">{error}</Alert>}

          <div className="entry-actions flex justify-end gap-2 py-3 border-t border-surface-200">
            <Link to="/stock"><Button type="button" variant="ghost" disabled={busy}>Back to stock</Button></Link>
            <Button type="submit" variant="primary" loading={busy} disabled={!recipientId || rows.length === 0}>
              {entered.length > 0 ? `Book ${entered.length} line${entered.length === 1 ? '' : 's'}` : 'Return stock'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
