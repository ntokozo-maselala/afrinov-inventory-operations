import { useState } from 'react';
import { Button } from './Button';
import { Field, Select, Textarea } from './Field';
import { Alert } from './Alert';
import { QuantityInput } from './QuantityInput';
import { RecipientSelect, type RecipientOption } from './IssueFields';
import { api, type ApiError } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useUnits } from '../hooks/useUnits';
import type { CurrentStockRow } from '../api/types';
import { locationLabel } from '../lib/locations';
import { useIdempotencyKey } from '../lib/idempotency';
import { formatMoney } from '../lib/poMoney';
import { parseQuantity } from '../lib/quantity';
import { round4 } from '../lib/movementReason';

// Issuing has its own page (IssueStock), so the row drawer only transfers and adjusts.
export type StockActionKind = 'transfer' | 'adjust';


interface Props {
  kind: StockActionKind;
  row: CurrentStockRow;
  onDone: () => void;
  onError: (err: ApiError) => void;
  onSuccess: (message: string) => void;
}

interface Location { id: string; name: string; parent?: { name: string } | null }

type Direction = 'remove' | 'add';

// Count differences are posted from Count stock, which checks the quantity
// the counter saw; an adjustment records a known reason instead. The reason
// sets the direction, so nobody types a minus sign: only Other asks which way.
const REMOVE_REASONS = [
  { value: 'DAMAGE', label: 'Damage' },
  { value: 'LOSS', label: 'Loss' },
  { value: 'SCRAP', label: 'Scrap' },
];
const DIRECTION_OF: Partial<Record<string, Direction>> = { DAMAGE: 'remove', LOSS: 'remove', SCRAP: 'remove', FOUND: 'add' };

const REASON_HELP: Partial<Record<string, string>> = {
  DAMAGE: 'Removes stock.',
  LOSS: 'Removes stock.',
  SCRAP: 'Removes stock.',
  FOUND: 'Adds stock. If it came on a delivery, receive it against the purchase order instead.',
  OTHER: 'Choose whether it removes or adds stock, and say why.',
};

// Damage, loss and scrap say who was responsible, or that nobody is known;
// the choice is never left blank. Naming someone needs a note saying what happened.
const RESPONSIBLE_HELP: Partial<Record<string, string>> = {
  DAMAGE: 'Who or what damaged it: a worker, machine, site or contractor.',
  LOSS: 'Who had it last. Choose Not known if it went missing from the store.',
  SCRAP: 'Scrap is often nobody’s fault (expired, obsolete, offcuts). Choose Not known if so.',
};
const NOT_KNOWN = '__none__';

const WRITE_OFF_KEYS = ['inventory.requireWriteOffApproval', 'inventory.writeOffApprovalAbove'] as const;

/** Posted at once, or held for someone else's approval (202). */
type AdjustOutcome =
  | { status: 'POSTED'; transactionId: string }
  | { status: 'PENDING_APPROVAL'; requestId: string; value: string | null; limit: string };

export function StockActionForm({ kind, row, onDone, onError, onSuccess }: Props) {
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [otherDirection, setOtherDirection] = useState<Direction | null>(null);
  const [responsible, setResponsible] = useState('');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const locations = useApi<Location[]>('/locations');
  const recipients = useApi<RecipientOption[]>(kind === 'adjust' ? '/recipients?active=true' : null);
  const { kindOf } = useUnits();
  const idem = useIdempotencyKey(`stock-action-${kind}`);
  // Worth more than the limit, an adjustment waits for someone else to approve it.
  const writeOff = useApi<Record<string, unknown>>(kind === 'adjust' ? `/settings/values?keys=${WRITE_OFF_KEYS.join(',')}` : null);
  const approvalOn = writeOff.data?.[WRITE_OFF_KEYS[0]] !== false;
  const limit = writeOff.data ? String(Number(writeOff.data[WRITE_OFF_KEYS[1]] ?? 0)) : null;

  const unit = row.unitOfMeasure;
  const unitKind = kindOf(unit);
  const parsed = parseQuantity(quantity, unitKind, unit);
  const onHand = Number(row.quantity);

  const direction = DIRECTION_OF[reasonCode] ?? (reasonCode === 'OTHER' ? otherDirection : null);
  const responsibleHelp = RESPONSIBLE_HELP[reasonCode];
  const named = !!responsibleHelp && responsible !== '' && responsible !== NOT_KNOWN;
  const noteRequired = named || reasonCode === 'FOUND' || reasonCode === 'OTHER';
  const noteLabel = named ? 'What happened' : reasonCode === 'FOUND' ? 'Where was it found?' : reasonCode === 'OTHER' ? 'Why' : 'Note (optional)';
  // Rounded to the 4 places the server keeps: 41.3 - 0.1 is 41.199999999999996 in floating point.
  const after = kind === 'adjust' && direction && parsed.ok ? round4(direction === 'remove' ? onHand - parsed.value : onHand + parsed.value) : null;
  const tooMany = after !== null && after < 0;

  function chooseReason(value: string) {
    setReasonCode(value);
    setOtherDirection(null);
    setResponsible('');
    setValidation(null);
  }

  function reset() { setQuantity(''); setNote(''); setResponsible(''); setReasonCode(''); setOtherDirection(null); setValidation(null); }

  // The error is about what was entered: once any of it changes, it is cleared
  // until the next post checks again, rather than left saying something no longer true.
  const edited = <T,>(set: (value: T) => void) => (value: T) => { set(value); setValidation(null); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    if (kind === 'adjust' && !reasonCode) { setValidation('Choose what happened.'); return; }
    if (kind === 'adjust' && !direction) { setValidation('Choose whether this removes or adds stock.'); return; }
    if (!parsed.ok) { setValidation(parsed.error); return; }
    const qty = parsed.value;
    if (kind === 'transfer' && !toLocationId) { setValidation('Choose a destination location.'); return; }
    if (kind === 'transfer' && toLocationId === row.locationId) { setValidation('Source and destination must differ.'); return; }
    if (tooMany) { setValidation(`Only ${row.quantity} ${unit} on hand, so ${qty} can't be removed.`); return; }
    if (kind === 'adjust' && responsibleHelp && !responsible) { setValidation('Choose who was responsible, or Not known.'); return; }
    if (kind === 'adjust' && noteRequired && !note.trim()) {
      setValidation(named ? 'Say what happened when naming who was responsible.' : reasonCode === 'FOUND' ? 'Say where the stock was found.' : 'Say why the stock is adjusted.');
      return;
    }

    setBusy(true);
    try {
      if (kind === 'transfer') {
        const transferBody = { materialId: row.materialId, fromLocationId: row.locationId, toLocationId, quantity: qty };
        await api.post('/inventory-transfers', transferBody, { idempotencyKey: idem.keyFor(transferBody) });
        onSuccess(`Transferred ${qty} ${unit} of ${row.materialSku}`);
      } else {
        // The API takes the signed quantity the ledger records: the form turns
        // "Remove 80" into -80. recipientId: who was responsible, null for
        // nobody known; other reasons send none.
        const signed = direction === 'remove' ? -qty : qty;
        const adjustBody = {
          materialId: row.materialId, locationId: row.locationId, quantity: signed, reasonCode, reasonNote: note.trim() || undefined,
          recipientId: responsibleHelp ? (named ? responsible : null) : undefined,
        };
        const outcome = await api.post<AdjustOutcome>('/inventory-adjustments', adjustBody, { idempotencyKey: idem.keyFor(adjustBody) });
        const what = `${direction === 'remove' ? 'Remove' : 'Add'} ${qty} ${unit} of ${row.materialSku}`;
        onSuccess(outcome?.status === 'PENDING_APPROVAL'
          ? `Sent for approval: ${what}, worth ${outcome.value ? formatMoney(outcome.value) : 'an unknown amount (no unit cost)'}, over the ${formatMoney(outcome.limit)} limit. Nothing moves until someone else approves it under Write-offs to approve.`
          : `${direction === 'remove' ? 'Removed' : 'Added'} ${qty} ${unit} of ${row.materialSku}`);
      }
      idem.confirm();
      reset();
      onDone();
    } catch (err) {
      idem.resolve(err);
      onError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const submitLabel = kind === 'transfer'
    ? 'Transfer'
    : direction && parsed.ok && !tooMany ? `${direction === 'remove' ? 'Remove' : 'Add'} ${parsed.value} ${unit}` : 'Post adjustment';
  const quantityLabel = kind === 'transfer' ? 'Quantity to transfer' : direction === 'remove' ? 'Quantity to remove' : direction === 'add' ? 'Quantity to add' : 'Quantity';
  const quantityHelp = unitKind === 'COUNTED' ? `Counted in whole ${unit}: 1, 2, 3 …` : `Measured in ${unit}; decimals allowed, such as 2,5.`;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="rounded border border-surface-200 bg-surface-50 p-3 text-sm">
        <div className="flex justify-between gap-3">
          <div>
            <div className="text-eyebrow">On hand</div>
            <div className="text-h2 font-mono">{row.quantity} <span className="text-meta text-xs">{unit}</span></div>
          </div>
          {kind === 'transfer' && (
            <div className="text-right">
              <div className="text-eyebrow">Required</div>
              <div className="text-h2 font-mono text-surface-500">{row.requiredStock}</div>
            </div>
          )}
          {kind === 'adjust' && after !== null && (
            <div className="text-right" aria-live="polite">
              <div className="text-eyebrow">After</div>
              <div className={`text-h2 font-mono ${tooMany ? 'text-danger-600' : direction === 'remove' ? 'text-surface-700' : 'text-success-700'}`}>
                {after} <span className="text-meta text-xs">{unit}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {kind === 'transfer' && (
        <>
          <Field label={quantityLabel} htmlFor="qty" required help={`Available at source: ${row.quantity} ${unit}. ${quantityHelp}`}>
            <QuantityInput id="qty" kind={unitKind} unit={unit} required value={quantity} onChange={(e) => edited(setQuantity)(e.target.value)} invalid={!!validation && !parsed.ok} />
          </Field>
          <Field label="Destination location" htmlFor="to" required error={locations.error ? "Couldn't load locations. Close and reopen to try again." : null}>
            <Select id="to" required value={toLocationId} onChange={(e) => edited(setToLocationId)(e.target.value)} invalid={!!validation && !toLocationId}>
              <option value="">— select —</option>
              {(locations.data ?? []).filter((l) => l.id !== row.locationId).map((l) => <option key={l.id} value={l.id}>{locationLabel(l)}</option>)}
            </Select>
          </Field>
          <Alert tone="info" title="Atomic transfer">
            Stock is removed from <strong>{row.locationName}</strong> and added at the destination in the same transaction. Both ledger entries are linked.
          </Alert>
        </>
      )}

      {kind === 'adjust' && (
        <>
          <Field label="What happened" htmlFor="reason" required help={REASON_HELP[reasonCode] ?? 'The reason decides whether stock is removed or added. To correct a count, use Count stock.'}>
            <Select id="reason" value={reasonCode} onChange={(e) => chooseReason(e.target.value)} invalid={!!validation && !reasonCode}>
              <option value="">— choose —</option>
              <optgroup label="Removes stock">
                {REMOVE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </optgroup>
              <optgroup label="Adds stock">
                <option value="FOUND">Found</option>
              </optgroup>
              <option value="OTHER">Other (say which way)</option>
            </Select>
          </Field>
          {reasonCode === 'OTHER' && (
            <div className="field">
              <span id="direction-label" className="field-label field-required">Remove or add?</span>
              <div role="group" aria-labelledby="direction-label" className="grid grid-cols-2 gap-2">
                {(['remove', 'add'] as const).map((d) => (
                  <Button key={d} type="button" variant={otherDirection === d ? 'primary' : 'secondary'} aria-pressed={otherDirection === d} onClick={() => edited(setOtherDirection)(d)}>
                    {d === 'remove' ? '− Remove stock' : '+ Add stock'}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <Field
            label={quantityLabel}
            htmlFor="qty"
            required
            help={`${quantityHelp}${approvalOn && limit !== null ? ` Worth more than ${formatMoney(limit)} at the unit cost, or with no unit cost, it waits for someone else to approve it.` : ''}`}
          >
            <QuantityInput id="qty" kind={unitKind} unit={unit} required value={quantity} onChange={(e) => edited(setQuantity)(e.target.value)} invalid={(!!validation && !parsed.ok) || tooMany} />
          </Field>
          {responsibleHelp && (
            <RecipientSelect
              id="responsible"
              label="Responsible"
              help={responsibleHelp}
              value={responsible}
              onChange={edited(setResponsible)}
              recipients={recipients.data ?? []}
              notKnownValue={NOT_KNOWN}
              invalid={!!validation && !responsible}
            />
          )}
          <Field label={noteLabel} htmlFor="note" required={noteRequired}>
            <Textarea id="note" value={note} onChange={(e) => edited(setNote)(e.target.value)} placeholder={reasonCode === 'FOUND' ? 'e.g. Box behind rack B-2 after the stocktake' : 'e.g. Two discs cracked in the grinder'} invalid={!!validation && noteRequired && !note.trim()} />
          </Field>
          {named && (
            <Alert tone="info" title="This records who was involved, not who is at fault.">
              Any follow-up, such as a deduction from pay, is a manager&apos;s decision and needs the person&apos;s written agreement.
            </Alert>
          )}
        </>
      )}

      {validation && <Alert tone="danger" title="Cannot submit">{validation}</Alert>}

      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onDone} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}
