import { useState } from 'react';
import { Button } from './Button';
import { Field, Input, Select, Textarea } from './Field';
import { Alert } from './Alert';
import { RecipientSelect, type RecipientOption } from './IssueFields';
import { api, type ApiError } from '../api/client';
import { useApi } from '../hooks/useApi';
import type { CurrentStockRow } from '../api/types';
import { locationLabel } from '../lib/locations';
import { useIdempotencyKey } from '../lib/idempotency';

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

// Count differences are posted from Count stock, which checks the quantity
// the counter saw; an adjustment records a known reason instead.
const REASONS = [
  { value: 'DAMAGE', label: 'Damage' },
  { value: 'LOSS', label: 'Loss' },
  { value: 'SCRAP', label: 'Scrap' },
  { value: 'OTHER', label: 'Other' },
];

// Damage, loss and scrap say who was responsible, or that nobody is known;
// the choice is never left blank. Naming someone needs a note saying what happened.
const RESPONSIBLE_HELP: Partial<Record<string, string>> = {
  DAMAGE: 'Who or what damaged it: a worker, machine, site or contractor.',
  LOSS: 'Who had it last. Choose Not known if it went missing from the store.',
  SCRAP: 'Scrap is often nobody’s fault (expired, obsolete, offcuts). Choose Not known if so.',
};
const NOT_KNOWN = '__none__';

export function StockActionForm({ kind, row, onDone, onError, onSuccess }: Props) {
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [reasonCode, setReasonCode] = useState(REASONS[0]!.value);
  const [responsible, setResponsible] = useState('');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const locations = useApi<Location[]>('/locations');
  const recipients = useApi<RecipientOption[]>(kind === 'adjust' ? '/recipients?active=true' : null);
  const idem = useIdempotencyKey(`stock-action-${kind}`);

  const responsibleHelp = RESPONSIBLE_HELP[reasonCode];
  const named = !!responsibleHelp && responsible !== '' && responsible !== NOT_KNOWN;

  function reset() { setQuantity(''); setNote(''); setResponsible(''); setValidation(null); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty === 0) {
      setValidation('Enter a non-zero quantity.');
      return;
    }
    if (kind === 'transfer' && !toLocationId) { setValidation('Choose a destination location.'); return; }
    if (kind === 'transfer' && toLocationId === row.locationId) { setValidation('Source and destination must differ.'); return; }
    if (kind === 'transfer' && qty < 0) { setValidation('Enter a positive quantity.'); return; }
    if (kind === 'adjust' && responsibleHelp && !responsible) { setValidation('Choose who was responsible, or Not known.'); return; }
    if (kind === 'adjust' && named && !note.trim()) { setValidation('Say what happened when naming who was responsible.'); return; }

    setBusy(true);
    try {
      if (kind === 'transfer') {
        const transferBody = { materialId: row.materialId, fromLocationId: row.locationId, toLocationId, quantity: qty };
        await api.post('/inventory-transfers', transferBody, { idempotencyKey: idem.keyFor(transferBody) });
        onSuccess(`Transferred ${qty} × ${row.materialSku}`);
      } else {
        // Adjustments accept a signed quantity: positive to add, negative to remove.
        // recipientId: who was responsible, null for nobody known; other reasons send none.
        const adjustBody = {
          materialId: row.materialId, locationId: row.locationId, quantity: qty, reasonCode, reasonNote: note || undefined,
          recipientId: responsibleHelp ? (named ? responsible : null) : undefined,
        };
        await api.post('/inventory-adjustments', adjustBody, { idempotencyKey: idem.keyFor(adjustBody) });
        onSuccess(`Adjusted ${row.materialSku} by ${qty > 0 ? '+' : ''}${qty}`);
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

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="rounded border border-surface-200 bg-surface-50 p-3 text-sm">
        <div className="flex justify-between gap-3">
          <div>
            <div className="text-eyebrow">On hand</div>
            <div className="text-h2 font-mono">{row.quantity} <span className="text-meta text-xs">{row.unitOfMeasure}</span></div>
          </div>
          {kind === 'transfer' && (
            <div className="text-right">
              <div className="text-eyebrow">Required</div>
              <div className="text-h2 font-mono text-surface-500">{row.requiredStock}</div>
            </div>
          )}
        </div>
      </div>

      {kind === 'transfer' && (
        <>
          <Field label="Quantity to transfer" htmlFor="qty" required help={`Available at source: ${row.quantity} ${row.unitOfMeasure}`}>
            <Input id="qty" type="number" min="0.0001" step="0.0001" required value={quantity} onChange={(e) => setQuantity(e.target.value)} invalid={!!validation} />
          </Field>
          <Field label="Destination location" htmlFor="to" required error={locations.error ? "Couldn't load locations. Close and reopen to try again." : null}>
            <Select id="to" required value={toLocationId} onChange={(e) => setToLocationId(e.target.value)} invalid={!!validation}>
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
          <Field label="Quantity" htmlFor="qty" required help="Positive to add stock, negative to remove.">
            <Input id="qty" type="number" step="0.0001" required value={quantity} onChange={(e) => setQuantity(e.target.value)} invalid={!!validation} />
          </Field>
          <Field label="Reason" htmlFor="reason" required help="Adjustments are immutable and require a reason. To correct a count, use Count stock.">
            <Select id="reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </Field>
          {responsibleHelp && (
            <RecipientSelect
              id="responsible"
              label="Responsible"
              help={responsibleHelp}
              value={responsible}
              onChange={setResponsible}
              recipients={recipients.data ?? []}
              notKnownValue={NOT_KNOWN}
              invalid={!!validation && !responsible}
            />
          )}
          <Field label={named ? 'What happened' : 'Note (optional)'} htmlFor="note" required={named}>
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Two discs cracked in the grinder" invalid={!!validation && named && !note.trim()} />
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
        <Button variant="primary" type="submit" loading={busy}>
          {kind === 'transfer' ? 'Transfer' : 'Post adjustment'}
        </Button>
      </div>
    </form>
  );
}