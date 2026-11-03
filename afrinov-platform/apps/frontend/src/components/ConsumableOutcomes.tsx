// What became of an issue of a tracked consumable (a disc, a blade, a bit), in
// the movement detail: how much was used up, broken or is still out, each
// outcome recorded, and a form to record another when the stub or the broken
// piece comes back (GET/POST /inventory-transactions/:id/outcomes). No stock
// moves: it left the shelf at the issue. An outcome recorded by mistake is
// withdrawn with a reason (POST /consumable-outcomes/:id/withdrawal); both are
// kept, as a reversal is in the ledger.
import { useState } from 'react';
import { Button } from './Button';
import { Badge } from './Badge';
import { Field, Input, Select, Textarea } from './Field';
import { api, type ApiError } from '../api/client';
import { useApi } from '../hooks/useApi';
import { usePermissions } from '../hooks/usePermissions';
import { useIdempotencyKey } from '../lib/idempotency';
import { formatDateTime, formatNumber } from '../lib/format';
import type { IssueOutcomes, MovementRow } from '../api/types';

const LABEL: Record<'USED_UP' | 'BROKEN', string> = { USED_UP: 'Used up', BROKEN: 'Broken' };

/** Issued less returned, used up and broken, from a Movements row. */
export function stillOutOf(t: Pick<MovementRow, 'quantity' | 'returnedQuantity' | 'usedUpQuantity' | 'brokenQuantity'>): number {
  return -Number(t.quantity) - Number(t.returnedQuantity ?? 0) - Number(t.usedUpQuantity ?? 0) - Number(t.brokenQuantity ?? 0);
}

export function ConsumableOutcomes({ transaction, onChanged, onError }: {
  transaction: Omit<MovementRow, 'cursor'>;
  /** After an outcome is recorded or withdrawn, with what to tell the user. */
  onChanged: (message: string) => void;
  onError: (err: ApiError) => void;
}) {
  const { hasPermission } = usePermissions();
  const detail = useApi<IssueOutcomes>(`/inventory-transactions/${transaction.id}/outcomes`);
  const d = detail.data;
  const unit = transaction.unitOfMeasure ?? '';
  const stillOut = d ? Number(d.stillOut) : stillOutOf(transaction);
  const canMark = hasPermission('inventory:outcome') && !!transaction.trackUse && !transaction.reversedById && stillOut > 0;

  return (
    <section className="space-y-3 border-t border-surface-200 pt-4" aria-labelledby="issue-use">
      <h3 id="issue-use" className="text-h3 text-surface-900">Used up or broken</h3>
      <p className="text-sm text-surface-600">
        Used up {formatNumber(Number(d?.usedUp ?? transaction.usedUpQuantity ?? 0))}
        {' · '}Broken {formatNumber(Number(d?.broken ?? transaction.brokenQuantity ?? 0))}
        {' · '}<span className={stillOut > 0 ? 'font-medium text-surface-900' : undefined}>Still out {formatNumber(stillOut)}</span> {unit}
      </p>
      {detail.error && !d && <p className="text-sm text-surface-600">What was recorded against this issue couldn&apos;t be loaded.</p>}
      {d && d.outcomes.length > 0 && (
        <ul className="text-sm divide-y divide-surface-100">
          {d.outcomes.map((o) => (
            <OutcomeItem key={o.id} outcome={o} unit={unit} onChanged={onChanged} onError={onError} />
          ))}
        </ul>
      )}
      {canMark && <MarkForm transaction={transaction} stillOut={stillOut} onChanged={onChanged} onError={onError} />}
      {!transaction.trackUse && <p className="text-meta">This item no longer tracks use after issue, so nothing more is recorded here.</p>}
    </section>
  );
}

function OutcomeItem({ outcome: o, unit, onChanged, onError }: {
  outcome: IssueOutcomes['outcomes'][number]; unit: string; onChanged: (message: string) => void; onError: (err: ApiError) => void;
}) {
  const { hasPermission } = usePermissions();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const idem = useIdempotencyKey(`outcome-withdrawal-${o.id}`);

  async function withdraw() {
    setValidation(null);
    if (reason.trim().length < 3) { setValidation('Say why this is being withdrawn.'); return; }
    setBusy(true);
    const body = { reason: reason.trim() };
    try {
      await api.post(`/consumable-outcomes/${o.id}/withdrawal`, body, { idempotencyKey: idem.keyFor(body) });
      idem.confirm();
      onChanged(`${LABEL[o.outcome]} withdrawn`);
    } catch (err) {
      const e = err as ApiError;
      idem.resolve(err);
      if (['VALIDATION_ERROR', 'INVALID_STATE', 'CONFLICT', 'NOT_FOUND'].includes(e.code)) setValidation(e.message);
      else if (e.code === 'FORBIDDEN') onError({ code: 'FORBIDDEN', message: 'You do not have permission to withdraw this.' });
      else onError({ code: 'NETWORK_ERROR', message: 'Unable to withdraw it. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-2 space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={o.withdrawn ? 'text-surface-400 line-through' : 'text-surface-900'}>
          <Badge tone={o.outcome === 'BROKEN' ? 'danger' : 'neutral'}>{LABEL[o.outcome]}</Badge> {formatNumber(Number(o.quantity))} {unit}
        </span>
        <span className="text-meta">{formatDateTime(o.recordedAt)} · {o.recordedBy}</span>
      </div>
      {o.note && <p className="text-surface-600">{o.note}</p>}
      {o.withdrawn && <p className="text-surface-600">Withdrawn by {o.withdrawn.by}, {formatDateTime(o.withdrawn.at)}: {o.withdrawn.reason}</p>}
      {!o.withdrawn && hasPermission('inventory:reverse') && (open ? (
        <div className="space-y-2">
          <Field label="Why withdraw it" htmlFor={`withdraw-${o.id}`} required>
            <Textarea id={`withdraw-${o.id}`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!validation} placeholder="e.g. Booked against the wrong issue" />
          </Field>
          {validation && <p className="text-sm text-danger-700">{validation}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" type="button" onClick={() => { setOpen(false); setValidation(null); }} disabled={busy}>Cancel</Button>
            <Button variant="danger" size="sm" type="button" onClick={withdraw} loading={busy}>Withdraw</Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" size="sm" type="button" onClick={() => setOpen(true)}>Withdraw</Button>
      ))}
    </li>
  );
}

function MarkForm({ transaction, stillOut, onChanged, onError }: {
  transaction: Omit<MovementRow, 'cursor'>; stillOut: number; onChanged: (message: string) => void; onError: (err: ApiError) => void;
}) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<'USED_UP' | 'BROKEN'>('USED_UP');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  // Scoped to this issue, so another issue opened in the same drawer gets its own key.
  const idem = useIdempotencyKey(`outcome-${transaction.id}`);

  async function submit() {
    setValidation(null);
    const qty = Number(quantity);
    if (!(qty > 0)) { setValidation('Enter how many.'); return; }
    if (qty > stillOut) { setValidation(`Only ${formatNumber(stillOut)} is still out.`); return; }
    setBusy(true);
    const body = { outcome, quantity: qty, note: note.trim() || undefined };
    try {
      await api.post(`/inventory-transactions/${transaction.id}/outcomes`, body, { idempotencyKey: idem.keyFor(body) });
      idem.confirm();
      onChanged(outcome === 'BROKEN' ? 'Marked broken' : 'Marked used up');
    } catch (err) {
      const e = err as ApiError;
      idem.resolve(err);
      if (['VALIDATION_ERROR', 'INVALID_STATE', 'NOT_FOUND'].includes(e.code)) setValidation(e.message);
      else if (e.code === 'FORBIDDEN') onError({ code: 'FORBIDDEN', message: 'You do not have permission to mark issued stock used up or broken.' });
      else onError({ code: 'NETWORK_ERROR', message: 'Unable to record it. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Mark used up or broken</Button>;
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-surface-600">When the stub or the broken piece comes back. Stock is not changed: it left the shelf when it was issued.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label="What happened" htmlFor="outcome-kind" required>
          <Select id="outcome-kind" value={outcome} onChange={(e) => setOutcome(e.target.value as 'USED_UP' | 'BROKEN')}>
            <option value="USED_UP">Used up</option>
            <option value="BROKEN">Broken</option>
          </Select>
        </Field>
        <Field label="How many" htmlFor="outcome-qty" required help={`Up to ${formatNumber(stillOut)}.`}>
          <Input id="outcome-qty" type="number" inputMode="decimal" min="0" max={stillOut} step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} invalid={!!validation} />
        </Field>
      </div>
      <Field label="Note" htmlFor="outcome-note">
        <Textarea id="outcome-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. disc shattered on the grinder" />
      </Field>
      {validation && <p className="text-sm text-danger-700">{validation}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" type="button" onClick={() => { setOpen(false); setValidation(null); }} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="button" onClick={submit} loading={busy}>Record</Button>
      </div>
    </div>
  );
}
