// The tool forms, each in a drawer on the Tools page. Check out: one person
// (and project), any number of tools, as one slip due back on one date (POST
// /tools/check-out). Check in: each open loan of one tool, how many came back
// and in what condition; a lost tool needs a note and is written off (POST
// /tools/check-in). Extend: a later due date for one loan, with a reason (POST
// /tools/loans/:id/extend).
import { useMemo, useState } from 'react';
import { Button } from './Button';
import { Badge } from './Badge';
import { Field, Input, Select, Textarea } from './Field';
import { SearchSelect, type SearchOption } from './SearchSelect';
import { Alert } from './Alert';
import { Icon } from './Icon';
import { RecipientSelect, ProjectSelect, useIssueOptions } from './IssueFields';
import { api, type ApiError } from '../api/client';
import { formatDate, formatNumber } from '../lib/format';
import { useIdempotencyKey } from '../lib/idempotency';
import { LOAN_STATE, addDays, formatDay, latestDueOn, lateness, overdueBlocks, suggestedDueOn, useLoanTerms } from '../lib/toolLoans';
import { today } from '../lib/dates';
import { useIsAdmin } from '../hooks/usePermissions';
import type { OpenLoan, ToolRow } from '../api/types';
import { useLocationLabel } from '../hooks/useLocationLabel';

const stockKey = (materialId: string, locationId: string) => `${materialId}|${locationId}`;

interface Line { key: number; stockKey: string; quantity: string }
let nextKey = 1;
const line = (key = ''): Line => ({ key: nextKey++, stockKey: key, quantity: key ? '1' : '' });

/** A loan's state and due date, as one line: "Overdue · due 4 Nov 2026, 2 days late". */
export function LoanDue({ loan }: { loan: OpenLoan }) {
  const s = LOAN_STATE[loan.state];
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={s.tone}>{s.label}</Badge>
      <span className={`text-xs ${loan.overdue ? 'text-danger-600 font-medium' : 'text-surface-500'}`}>
        due {formatDay(loan.dueOn)}, {lateness(loan)}{loan.extensions.length > 0 ? ` · extended ${loan.extensions.length === 1 ? 'once' : `${loan.extensions.length} times`}` : ''}
      </span>
    </span>
  );
}

export function CheckOutForm({ tools, start, onCancel, onDone }: {
  tools: ToolRow[];
  /** The tool the drawer was opened from, at its first location with any in store. */
  start?: ToolRow;
  onCancel: () => void;
  onDone: (summary: string) => void;
}) {
  const { recipients, projects, loading, error: optionsError } = useIssueOptions();
  const terms = useLoanTerms();
  const isAdmin = useIsAdmin();
  const [recipientId, setRecipientId] = useState('');
  const [projectNumber, setProjectNumber] = useState('');
  const [note, setNote] = useState('');
  // Empty: follow the suggested date, which moves with the project.
  const [dueOn, setDueOn] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [serverWantsReason, setServerWantsReason] = useState(false);
  const [lines, setLines] = useState<Line[]>(() => [line(start?.locations[0] ? stockKey(start.materialId, start.locations[0].locationId) : '')]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locationName = useLocationLabel();

  // What is in store, per tool and location.
  const available = useMemo(() => tools.flatMap((t) => t.locations.map((l) => ({ tool: t, ...l }))), [tools]);
  const byKey = useMemo(() => new Map(available.map((a) => [stockKey(a.tool.materialId, a.locationId), a])), [available]);
  const options = useMemo<SearchOption[]>(() => available.map((a) => ({
    value: stockKey(a.tool.materialId, a.locationId),
    label: `${a.tool.name} (${a.tool.sku}${a.tool.serialNumber ? ` · S/N ${a.tool.serialNumber}` : ''}) · ${locationName(a.locationId, a.locationName)}`,
    detail: `${formatNumber(Number(a.quantity))} in store`,
  })), [available, locationName]);

  const asked = new Map<string, number>();
  for (const l of lines) if (l.stockKey && Number(l.quantity) > 0) asked.set(l.stockKey, (asked.get(l.stockKey) ?? 0) + Number(l.quantity));
  const over = new Set([...asked].filter(([k, q]) => q > Number(byKey.get(k)?.quantity ?? 0)).map(([k]) => k));
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // The due date: suggested from the loan period and the project, unless chosen.
  const outDay = today();
  const projectEnd = projects.find((p) => p.projectNumber === projectNumber)?.endDate?.slice(0, 10) ?? null;
  const suggestion = suggestedDueOn(outDay, terms, projectEnd);
  const due = dueOn || suggestion.dueOn;
  const latest = latestDueOn(outDay, terms, projectEnd, isAdmin);
  const dueProblem = due < outDay ? 'The due date cannot be before today.'
    : latest && due > latest ? `The latest due date is ${formatDay(latest)}${projectEnd && latest === projectEnd ? ', when the project ends' : ''}.`
      : null;

  // What the person already has out past its due date.
  const recipient = recipients.find((r) => r.id === recipientId);
  const overdue = recipientId
    ? tools.flatMap((t) => t.loans.filter((l) => l.recipientId === recipientId && l.overdue).map((loan) => ({ tool: t, loan })))
      .sort((a, b) => b.loan.daysLate - a.loan.daysLate)
    : [];
  const blocked = overdue.length > 0 && overdueBlocks(terms, recipient?.type);
  const needsReason = !blocked && (overdue.length > 0 || serverWantsReason);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const filled = lines.filter((l) => l.stockKey || l.quantity);
    if (!recipientId) { setError('Choose who the tools are checked out to.'); return; }
    if (blocked) { setError(`${recipient?.name ?? 'This person'} has overdue tools. Check them in or extend their loans first.`); return; }
    if (filled.length === 0) { setError('Add at least one tool.'); return; }
    if (filled.some((l) => !l.stockKey || !(Number(l.quantity) > 0))) { setError('Every line needs a tool and a quantity above zero.'); return; }
    if (over.size > 0) { setError('Some lines ask for more than is in store.'); return; }
    if (dueProblem) { setError(dueProblem); return; }
    if (needsReason && !overrideReason.trim()) { setError(`Say why tools are lent to ${recipient?.name ?? 'this person'} while they have an overdue tool.`); return; }
    setBusy(true);
    try {
      await api.post('/tools/check-out', {
        recipientId,
        projectNumber: projectNumber || undefined,
        note: note.trim() || undefined,
        dueOn: due,
        overrideReason: needsReason ? overrideReason.trim() : undefined,
        lines: filled.map((l) => {
          const a = byKey.get(l.stockKey)!;
          return { materialId: a.tool.materialId, locationId: a.locationId, quantity: Number(l.quantity) };
        }),
      });
      const who = recipient?.name ?? 'recipient';
      onDone(`Checked out ${filled.length} tool${filled.length === 1 ? '' : 's'} to ${who}, due back ${formatDay(due)}`);
    } catch (err) {
      const apiErr = err as ApiError;
      // The list on screen was older than the server's: it found an overdue tool this form did not know of.
      if (apiErr.details?.['overrideReasonRequired'] === true) setServerWantsReason(true);
      setError(apiErr.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <RecipientSelect
        id="loan-recipient" value={recipientId} onChange={(id) => { setRecipientId(id); setServerWantsReason(false); }} recipients={recipients} disabled={loading}
        invalid={!!error && !recipientId} label="Checked out to" help="Who takes the tools: a worker, machine, site or contractor."
      />
      {overdue.length > 0 && (
        <Alert tone={blocked ? 'danger' : 'warning'} title={`${recipient?.name ?? 'They'} ${overdue.length === 1 ? 'has an overdue tool' : `have ${overdue.length} overdue tools`}`}>
          <ul className="space-y-0.5">
            {overdue.map(({ tool, loan }) => (
              <li key={loan.loanId}>
                {tool.name} ({tool.sku}){Number(loan.out) > 1 ? ` × ${formatNumber(Number(loan.out))}` : ''}: due {formatDay(loan.dueOn)}, {lateness(loan)}
              </li>
            ))}
          </ul>
          <p className="mt-1">{blocked
            ? 'Check them in or extend their loans on the Tools page before lending more.'
            : 'You can still lend tools, but say why below.'}</p>
        </Alert>
      )}
      <ProjectSelect id="loan-project" value={projectNumber} onChange={setProjectNumber} projects={projects} disabled={loading} help="The project the tools are used on, if any." />
      {optionsError && <Alert tone="danger" title="Couldn't load recipients and projects">{optionsError.message}</Alert>}

      <fieldset className="space-y-3">
        <legend className="text-h3 text-surface-900 mb-2">Tools</legend>
        {lines.map((l, i) => {
          const a = byKey.get(l.stockKey);
          const tooMany = over.has(l.stockKey);
          return (
            <div key={l.key} className="grid grid-cols-1 sm:grid-cols-[1fr_6rem_auto] gap-2 items-start">
              <Field label={`Tool ${i + 1}`} htmlFor={`loan-tool-${l.key}`} help={a ? `In store at ${locationName(a.locationId, a.locationName)}: ${formatNumber(Number(a.quantity))}` : undefined}>
                <SearchSelect
                  id={`loan-tool-${l.key}`} value={l.stockKey} onChange={(v) => update(l.key, { stockKey: v, quantity: l.quantity || '1' })}
                  options={options} placeholder="Search by name, code, serial number or location" noMatchText="No tool in store matches"
                />
              </Field>
              <Field label="Quantity" htmlFor={`loan-qty-${l.key}`} error={tooMany ? 'More than in store' : null}>
                <Input id={`loan-qty-${l.key}`} type="number" inputMode="numeric" min="0" step="1" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} invalid={tooMany} />
              </Field>
              <Button
                type="button" variant="ghost" aria-label={`Remove tool ${i + 1}`} className="sm:mt-6"
                onClick={() => setLines((ls) => (ls.length === 1 ? [line()] : ls.filter((x) => x.key !== l.key)))}
              >
                <Icon.Trash size={14} />
              </Button>
            </div>
          );
        })}
        <Button type="button" variant="secondary" size="sm" leadingIcon={<Icon.Plus size={14} />} onClick={() => setLines((ls) => [...ls, line()])} disabled={lines.length >= 50}>
          Add another tool
        </Button>
      </fieldset>

      <Field
        label="Due back" htmlFor="loan-due" required error={dueProblem}
        help={dueOn && dueOn !== suggestion.dueOn
          ? `Suggested: ${formatDay(suggestion.dueOn)}, from ${suggestion.rule}.`
          : `From ${suggestion.rule}. Tell the person taking the tools this date.`}
      >
        <Input id="loan-due" type="date" min={outDay} max={latest} value={due} onChange={(e) => setDueOn(e.target.value)} invalid={!!dueProblem} required />
      </Field>
      {needsReason && (
        <Field label="Reason to lend anyway" htmlFor="loan-override" required help="Kept with the check-out in the activity log.">
          <Textarea id="loan-override" rows={2} maxLength={500} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="e.g. Second crew on the boiler job" />
        </Field>
      )}
      <Field label="Note (optional)" htmlFor="loan-note">
        <Textarea id="loan-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. For the Northam shutdown" />
      </Field>
      {error && <Alert tone="danger" title="Cannot check out">{error}</Alert>}
      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy} disabled={blocked}>Check out</Button>
      </div>
    </form>
  );
}

type Condition = 'GOOD' | 'DAMAGED' | 'LOST';
interface Back { quantity: string; condition: Condition; note: string }

export function CheckInForm({ tool, onCancel, onDone }: {
  tool: ToolRow;
  onCancel: () => void;
  onDone: (summary: string) => void;
}) {
  // With one loan, all of it is coming back; with several, the storeman fills in the ones that are.
  const [back, setBack] = useState<Record<string, Back>>(() => Object.fromEntries(tool.loans.map((l) => [
    l.loanId, { quantity: tool.loans.length === 1 ? l.out : '', condition: 'GOOD' as Condition, note: '' },
  ])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (loanId: string, patch: Partial<Back>) => setBack((b) => ({ ...b, [loanId]: { ...b[loanId]!, ...patch } }));
  const tooMany = (l: OpenLoan) => Number(back[l.loanId]?.quantity) > Number(l.out);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const lines = tool.loans.filter((l) => Number(back[l.loanId]?.quantity) > 0);
    if (lines.length === 0) { setError('Enter how many came back.'); return; }
    if (lines.some(tooMany)) { setError('Some check-outs get back more than is out.'); return; }
    if (lines.some((l) => back[l.loanId]!.condition === 'LOST' && !back[l.loanId]!.note.trim())) { setError('Say what happened to a lost tool.'); return; }
    setBusy(true);
    try {
      await api.post('/tools/check-in', {
        lines: lines.map((l) => {
          const b = back[l.loanId]!;
          return { loanId: l.loanId, quantity: Number(b.quantity), condition: b.condition, note: b.note.trim() || undefined };
        }),
      });
      const count = lines.reduce((n, l) => n + Number(back[l.loanId]!.quantity), 0);
      onDone(`Checked in ${formatNumber(count)} × ${tool.name}`);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {tool.loans.map((l) => {
        const b = back[l.loanId]!;
        return (
          <fieldset key={l.loanId} className="surface-muted rounded p-3 space-y-3">
            <legend className="sr-only">Checked out to {l.recipientName ?? 'not recorded'}</legend>
            <div className="text-sm">
              <span className="font-medium text-surface-900">{l.recipientName ?? 'Not recorded'}</span>
              <span className="text-surface-600"> · {formatNumber(Number(l.out))} out since {formatDate(l.checkedOutAt)}{l.projectNumber ? ` · ${l.projectNumber}` : ''}</span>
              <div><LoanDue loan={l} /></div>
              <div className="text-xs text-surface-500">From {l.locationName}; it goes back there. Checked out by {l.checkedOutBy}.{l.note ? ` ${l.note}` : ''}</div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[6rem_10rem_1fr] gap-2 items-start">
              <Field label="Back now" htmlFor={`back-qty-${l.loanId}`} error={tooMany(l) ? 'More than out' : null}>
                <Input id={`back-qty-${l.loanId}`} type="number" inputMode="numeric" min="0" step="1" value={b.quantity} onChange={(e) => update(l.loanId, { quantity: e.target.value })} invalid={tooMany(l)} />
              </Field>
              <Field label="Condition" htmlFor={`back-cond-${l.loanId}`}>
                <Select id={`back-cond-${l.loanId}`} value={b.condition} onChange={(e) => update(l.loanId, { condition: e.target.value as Condition })}>
                  <option value="GOOD">Good</option>
                  <option value="DAMAGED">Damaged</option>
                  <option value="LOST">Lost (write off)</option>
                </Select>
              </Field>
              <Field label={b.condition === 'LOST' ? 'What happened' : 'Note (optional)'} htmlFor={`back-note-${l.loanId}`} required={b.condition === 'LOST'}>
                <Input id={`back-note-${l.loanId}`} maxLength={500} value={b.note} onChange={(e) => update(l.loanId, { note: e.target.value })} placeholder={b.condition === 'DAMAGED' ? 'e.g. Chuck damaged' : undefined} />
              </Field>
            </div>
          </fieldset>
        );
      })}
      {error && <Alert tone="danger" title="Cannot check in">{error}</Alert>}
      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>Check in</Button>
      </div>
    </form>
  );
}

export function ExtendLoanForm({ tool, loan, onCancel, onDone }: {
  tool: ToolRow;
  loan: OpenLoan;
  onCancel: () => void;
  onDone: (summary: string) => void;
}) {
  const terms = useLoanTerms();
  const isAdmin = useIsAdmin();
  const { projects } = useIssueOptions();
  // Retry-safe: a retry after a lost response replays the extension instead of adding a second.
  const idem = useIdempotencyKey('extend-tool-loan');
  const projectEnd = projects.find((p) => p.projectNumber === loan.projectNumber)?.endDate?.slice(0, 10) ?? null;
  // The server counts the longest loan from the day it went out, in UTC.
  const latest = latestDueOn(loan.checkedOutAt.slice(0, 10), terms, projectEnd, isAdmin);
  const now = today();
  const earliest = addDays(loan.dueOn, 1) > now ? addDays(loan.dueOn, 1) : now;
  const suggested = (() => {
    const from = loan.dueOn > now ? loan.dueOn : now;
    const pick = addDays(from, terms.defaultDays);
    return latest && pick > latest ? latest : pick;
  })();
  const atLimit = latest !== undefined && latest < earliest;
  const [dueOn, setDueOn] = useState(atLimit ? '' : suggested);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!dueOn) { setError('Choose the new due date.'); return; }
    if (dueOn < earliest) { setError(`The new due date must be ${formatDay(earliest)} or later.`); return; }
    if (latest && dueOn > latest) { setError(`The latest due date is ${formatDay(latest)}.`); return; }
    if (!reason.trim()) { setError('Say why the loan is extended.'); return; }
    const body = { dueOn, reason: reason.trim() };
    setBusy(true);
    try {
      await api.post(`/tools/loans/${loan.loanId}/extend`, body, { idempotencyKey: idem.keyFor({ loanId: loan.loanId, ...body }) });
      idem.confirm();
      onDone(`${tool.name} with ${loan.recipientName ?? 'its borrower'} is now due back ${formatDay(dueOn)}`);
    } catch (err) {
      idem.resolve(err);
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="surface-muted rounded p-3 text-sm space-y-1">
        <div>
          <span className="font-medium text-surface-900">{loan.recipientName ?? 'Not recorded'}</span>
          <span className="text-surface-600"> · {formatNumber(Number(loan.out))} out since {formatDate(loan.checkedOutAt)}{loan.projectNumber ? ` · ${loan.projectNumber}` : ''}</span>
        </div>
        <LoanDue loan={loan} />
        {loan.extensions.length > 0 && (
          <ul className="text-xs text-surface-500 space-y-0.5">
            {loan.extensions.map((x) => (
              <li key={x.extendedAt}>Extended to {formatDay(x.dueOn)} by {x.extendedBy} on {formatDate(x.extendedAt)}: {x.reason}</li>
            ))}
          </ul>
        )}
      </div>
      {atLimit ? (
        <Alert tone="warning" title="This loan cannot be extended further">
          {projectEnd && latest === projectEnd
            ? `Project ${loan.projectNumber} ends on ${formatDay(projectEnd)}. Move the project's end date to lend the tool for longer, or check it in.`
            : `A tool can be lent for at most ${terms.maxDays} days. Only an administrator can set a later date; otherwise check it in.`}
        </Alert>
      ) : (
        <>
          <Field label="New due date" htmlFor="extend-due" required help={latest ? `Latest: ${formatDay(latest)}.` : undefined}>
            <Input id="extend-due" type="date" min={earliest} max={latest} value={dueOn} onChange={(e) => setDueOn(e.target.value)} required />
          </Field>
          <Field label="Why it is needed longer" htmlFor="extend-reason" required>
            <Textarea id="extend-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Shutdown over-ran by a week" />
          </Field>
        </>
      )}
      {error && <Alert tone="danger" title="Cannot extend">{error}</Alert>}
      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy} disabled={atLimit}>Extend loan</Button>
      </div>
    </form>
  );
}
