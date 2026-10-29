// Return stock at the store counter: who is bringing it back, then how much of
// each item, against the issues it came from (GET /inventory-returns/returnable),
// booked all-or-nothing (POST /inventory-returns). Consumables are mostly used
// up, so the list covers a recent period, 30 days unless changed.
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
import { formatDate } from '../lib/format';
import { daysAgo, today } from '../lib/dates';
import { useIdempotencyKey } from '../lib/idempotency';
import type { ReturnableLine } from '../api/types';
import { locationLabel } from '../lib/locations';
import { StaleDataNotice } from '../components/StaleDataNotice';

interface Location { id: string; name: string; active: boolean; parent?: { name: string } | null }

/** The typed quantity, or null when blank; NaN when it is not a usable number. */
function parseQty(text: string | undefined): number | null {
  if (text === undefined || text.trim() === '') return null;
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
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
  const [qty, setQty] = useState<Record<string, string>>({});
  const [into, setInto] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The return just booked, kept on the page (a toast fades) with a way to see it in the report.
  const [last, setLast] = useState<{ who: string; recipientId: string; count: number } | null>(null);
  const toast = useToast();
  const idem = useIdempotencyKey('return-stock');

  const activeLocations = useMemo(() => (locations.data ?? []).filter((l) => l.active).sort((a, b) => a.name.localeCompare(b.name)), [locations.data]);
  const who = (recipients.data ?? []).find((r) => r.id === recipientId)?.name;
  const rows = lines.data ?? [];

  /** Where a line goes back: the choice, else where it was issued from if that is still in use. */
  const target = (l: ReturnableLine) => into[l.issueTransactionId] ?? (l.locationActive ? l.locationId : '');
  const entered = rows.filter((l) => parseQty(qty[l.issueTransactionId]) !== null);
  const problem = (l: ReturnableLine): string | null => {
    const q = parseQty(qty[l.issueTransactionId]);
    if (q === null) return null;
    if (Number.isNaN(q) || q <= 0) return 'Enter a number above 0';
    if (q > Number(l.outstanding)) return `At most ${l.outstanding}`;
    if (!target(l)) return 'Choose where it goes back';
    return null;
  };

  function chooseRecipient(id: string) {
    // A different recipient is a different return, so the draft is cleared and
    // the pending submission key for the previous one is left in place (it may
    // still need reconciling) while the next submit mints its own key from its
    // own payload. Nothing to rotate here: keys are per payload.
    setRecipientId(id);
    setQty({});
    setInto({});
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!recipientId) { setError('Choose who is bringing the stock back.'); return; }
    if (entered.length === 0) { setError('Enter how much of at least one item is coming back.'); return; }
    if (entered.some((l) => problem(l))) { setError('Check the highlighted lines.'); return; }

    setBusy(true);
    try {
      const returnBody = {
        reason: note.trim() || undefined,
        lines: entered.map((l) => ({
          issueTransactionId: l.issueTransactionId,
          quantity: parseQty(qty[l.issueTransactionId])!,
          locationId: target(l) !== l.locationId ? target(l) : undefined,
        })),
      };
      await api.post('/inventory-returns', returnBody, { idempotencyKey: idem.keyFor(returnBody) });
      toast.success(`Returned ${entered.length} item${entered.length === 1 ? '' : 's'}${who ? ` from ${who}` : ''}`);
      setLast({ who: who ?? 'them', recipientId, count: entered.length });
      setQty({});
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

  return (
    <div>
      <PageHeader
        title="Return stock"
        description="Record unused stock coming back from a job: who brought it, and how much of each item. Each line goes back against the issue it came from, so its project's stock used goes down."
        breadcrumb={[{ label: 'Stock', to: '/stock' }, { label: 'Return stock' }]}
      />

      {loadFailed && <ErrorState error={hardError} onRetry={() => { recipients.reload(); locations.reload(); }} />}
      {loadStale && <StaleDataNotice error={sources.find((s) => s.stale)?.error} onRetry={() => { recipients.reload(); locations.reload(); }} label="Some lists could not be refreshed" />}

      {last && (
        <Alert tone="success" title={`Returned ${last.count} item${last.count === 1 ? '' : 's'} from ${last.who}`} className="mb-4 max-w-5xl">
          <Link to={`/movements?report=returned&recipientId=${encodeURIComponent(last.recipientId)}&from=${today()}&to=${today()}`} className="btn-link">
            See it in Returned stock
          </Link>
          {' '}under Movements. The list below shows what is still out.
        </Alert>
      )}

      {!loadFailed && (
        <form onSubmit={submit} className="surface-card p-4 space-y-5 max-w-5xl" noValidate>
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
                        <th scope="col" className="text-right">Coming back</th>
                        <th scope="col">Back into</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((l) => {
                        const id = l.issueTransactionId;
                        const bad = problem(l);
                        return (
                          <tr key={id}>
                            <td className="whitespace-nowrap text-surface-600">{formatDate(l.postedAt)}</td>
                            <td>
                              <span className="font-mono text-xs">{l.sku}</span> {l.name}
                              {Number(l.returned) > 0 && <span className="block text-xs text-surface-500">{l.returned} of {l.issued} already back</span>}
                            </td>
                            <td className="text-surface-600">{l.projectNumber ?? <span className="text-surface-300">—</span>}</td>
                            <td className="text-right tabular-nums whitespace-nowrap">{l.outstanding} <span className="text-meta">{l.unitOfMeasure}</span></td>
                            <td className="text-right">
                              <Input
                                aria-label={`Coming back: ${l.name}, issued ${formatDate(l.postedAt)}`}
                                className="w-24 ml-auto text-right"
                                type="text"
                                inputMode="decimal"
                                value={qty[id] ?? ''}
                                onChange={(e) => setQty((s) => ({ ...s, [id]: e.target.value }))}
                                invalid={!!bad}
                              />
                              {bad && <span className="block text-xs text-danger-700 mt-1">{bad}</span>}
                            </td>
                            <td>
                              <Select
                                aria-label={`Back into: ${l.name}, issued ${formatDate(l.postedAt)}`}
                                value={target(l)}
                                onChange={(e) => setInto((s) => ({ ...s, [id]: e.target.value }))}
                                disabled={locations.loading}
                              >
                                <option value="">— choose —</option>
                                {activeLocations.map((loc) => <option key={loc.id} value={loc.id}>{locationLabel(loc)}{loc.id === l.locationId ? ' (issued from)' : ''}</option>)}
                              </Select>
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
            <Field label="Note (optional)" htmlFor="return-note" help="Kept with every line, e.g. why it came back.">
              <Textarea id="return-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Job finished early" />
            </Field>
          )}

          {error && <Alert tone="danger" title="Cannot return">{error}</Alert>}

          <div className="entry-actions flex justify-end gap-2 py-3 border-t border-surface-200">
            <Link to="/stock"><Button type="button" variant="ghost" disabled={busy}>Back to stock</Button></Link>
            <Button type="submit" variant="primary" loading={busy} disabled={!recipientId || rows.length === 0}>Return stock</Button>
          </div>
        </form>
      )}
    </div>
  );
}
