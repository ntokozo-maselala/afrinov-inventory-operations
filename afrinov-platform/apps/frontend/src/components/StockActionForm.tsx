import { useEffect, useState } from 'react';
import { Button } from './Button';
import { Field, Input, Select, Textarea } from './Field';
import { Alert } from './Alert';
import { api, type ApiError } from '../api/client';
import { RecipientSelect, ProjectSelect, useIssueOptions } from './IssueFields';

export type StockActionKind = 'issue' | 'transfer' | 'adjust';

interface Row {
  materialId: string; materialSku: string; materialName: string;
  locationId: string; locationName: string;
  unitOfMeasure: string; quantity: string; requiredStock: string;
}

interface Props {
  kind: StockActionKind;
  row: Row;
  onDone: () => void;
  onError: (err: ApiError) => void;
  onSuccess: (message: string) => void;
}

interface Location { id: string; name: string; }

const REASONS = [
  { value: 'COUNT_VARIANCE', label: 'Count variance' },
  { value: 'DAMAGE', label: 'Damage' },
  { value: 'LOSS', label: 'Loss' },
  { value: 'SCRAP', label: 'Scrap' },
  { value: 'OTHER', label: 'Other' },
];

/** Render and submit an issue, transfer, or adjustment for the selected stock row. */
export function StockActionForm({ kind, row, onDone, onError, onSuccess }: Props) {
  const [quantity, setQuantity] = useState('');
  const [project, setProject] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const issueOptions = useIssueOptions();
  const [note, setNote] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [reasonCode, setReasonCode] = useState(REASONS[0]!.value);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);

  useEffect(() => {
    api.get<Location[]>('/locations').then(setLocations).catch(() => undefined);
  }, []);

  /** Clear quantity, issue attribution, notes, and validation after a successful operation. */
  function reset() { setQuantity(''); setProject(''); setRecipientId(''); setNote(''); setValidation(null); }

  /** Validate the selected stock action, post its payload, and notify the parent of the outcome. */
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
    if (kind !== 'adjust' && qty < 0) { setValidation('Enter a positive quantity.'); return; }
    if (kind === 'issue' && !recipientId) { setValidation('Choose who the stock is issued to.'); return; }

    setBusy(true);
    try {
      if (kind === 'issue') {
        await api.post('/inventory-issues', {
          recipientId,
          projectNumber: project || undefined,
          lines: [{ materialId: row.materialId, locationId: row.locationId, quantity: qty }],
        });
        onSuccess(`Issued ${qty} × ${row.materialSku}`);
      } else if (kind === 'transfer') {
        await api.post('/inventory-transfers', {
          materialId: row.materialId, fromLocationId: row.locationId, toLocationId, quantity: qty,
        });
        onSuccess(`Transferred ${qty} × ${row.materialSku}`);
      } else {
        // Adjustments accept a signed quantity: positive to add, negative to remove.
        await api.post('/inventory-adjustments', {
          materialId: row.materialId, locationId: row.locationId, quantity: qty, reasonCode, reasonNote: note || undefined,
        });
        onSuccess(`Adjusted ${row.materialSku} by ${qty > 0 ? '+' : ''}${qty}`);
      }
      reset();
      onDone();
    } catch (err) {
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
          {kind !== 'adjust' && (
            <div className="text-right">
              <div className="text-eyebrow">Reorder at</div>
              <div className="text-h2 font-mono text-surface-500">{row.requiredStock}</div>
            </div>
          )}
        </div>
      </div>

      {kind === 'issue' && (
        <>
          <Field label="Quantity to issue" htmlFor="qty" required help={`Available: ${row.quantity} ${row.unitOfMeasure}`}>
            <Input id="qty" type="number" min="0.0001" step="0.0001" required value={quantity} onChange={(e) => setQuantity(e.target.value)} invalid={!!validation} />
          </Field>
          <RecipientSelect id="issue-recipient" value={recipientId} onChange={setRecipientId} recipients={issueOptions.recipients} disabled={issueOptions.loading} invalid={!!validation && !recipientId} />
          <ProjectSelect id="proj" value={project} onChange={setProject} projects={issueOptions.projects} disabled={issueOptions.loading} />
        </>
      )}

      {kind === 'transfer' && (
        <>
          <Field label="Quantity to transfer" htmlFor="qty" required help={`Available at source: ${row.quantity} ${row.unitOfMeasure}`}>
            <Input id="qty" type="number" min="0.0001" step="0.0001" required value={quantity} onChange={(e) => setQuantity(e.target.value)} invalid={!!validation} />
          </Field>
          <Field label="Destination location" htmlFor="to" required>
            <Select id="to" required value={toLocationId} onChange={(e) => setToLocationId(e.target.value)} invalid={!!validation}>
              <option value="">— select —</option>
              {locations.filter((l) => l.id !== row.locationId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
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
          <Field label="Reason" htmlFor="reason" required help="Adjustments are immutable and require a reason.">
            <Select id="reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </Field>
          <Field label="Note (optional)" htmlFor="note">
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Found three extra behind the rack" />
          </Field>
        </>
      )}

      {validation && <Alert tone="danger" title="Cannot submit">{validation}</Alert>}

      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onDone} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>
          {kind === 'issue' ? 'Issue stock' : kind === 'transfer' ? 'Transfer' : 'Post adjustment'}
        </Button>
      </div>
    </form>
  );
}