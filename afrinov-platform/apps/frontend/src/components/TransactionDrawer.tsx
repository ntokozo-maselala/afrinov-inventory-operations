import { useEffect, useState } from 'react';
import { Button } from './Button';
import { Field, Input, Select, Textarea } from './Field';
import { api, type ApiError } from '../api/client';
import { useApi } from '../hooks/useApi';
import { usePermissions } from '../hooks/usePermissions';
import type { MovementRow } from '../api/types';


interface Props {
  transaction: MovementRow;
  onClose: () => void;
  onReversed: () => void;
  /** Called after stock is returned against this issue. */
  onReturned?: () => void;
  onError: (err: ApiError) => void;
}

// The ledger is never edited. A mistaken movement is corrected by posting a
// reversing entry (POST /inventory-transactions/:id/reversal).
export function TransactionDrawer({ transaction, onClose: _onClose, onReversed, onReturned, onError }: Props) {
  const { hasPermission } = usePermissions();
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  // eslint-disable react-hooks/set-state-in-effect
  useEffect(() => {
    setReversing(false); // eslint-disable-line react-hooks/set-state-in-effect
    setReason(''); // eslint-disable-line react-hooks/set-state-in-effect
    setValidation(null); // eslint-disable-line react-hooks/set-state-in-effect
  }, [transaction.id]);
  // eslint-enable react-hooks/set-state-in-effect

  const isTransfer = transaction.type === 'TRANSFER_IN' || transaction.type === 'TRANSFER_OUT';
  const isGoodsReceipt = transaction.referenceType === 'GoodsReceipt';
  const issued = transaction.type === 'ISSUE' ? -Number(transaction.quantity) : 0;
  const returned = Number(transaction.returnedQuantity ?? 0);
  const hasReturns = transaction.type === 'ISSUE' && returned > 0;
  const canReturn = hasPermission('inventory:return')
    && transaction.type === 'ISSUE'
    && !transaction.reversesId
    && !transaction.reversedById
    && issued - returned > 0;
  const canReverse = hasPermission('inventory:reverse')
    && !hasReturns
    && !transaction.reversesId
    && !transaction.reversedById
    && !isGoodsReceipt;

  function handleCancel() {
    setReversing(false);
    setReason('');
    setValidation(null);
  }

  async function handleReverse() {
    setValidation(null);
    if (reason.trim().length < 3) {
      setValidation('Say why this movement is being reversed.');
      return;
    }

    setBusy(true);
    try {
      await api.post(`/inventory-transactions/${transaction.id}/reversal`, { reason: reason.trim() });
      setReversing(false);
      setReason('');
      onReversed();
    } catch (err) {
      const e = err as ApiError;
      if (['CONFLICT', 'INVALID_STATE', 'INSUFFICIENT_BALANCE', 'VALIDATION_ERROR', 'NOT_FOUND'].includes(e.code)) {
        setValidation(e.message);
      } else if (e.code === 'FORBIDDEN') {
        onError({ code: 'FORBIDDEN', message: 'You do not have permission to reverse movements.' });
      } else {
        onError({ code: 'NETWORK_ERROR', message: 'Unable to reverse the movement. Please try again.' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="text-h3 text-surface-900">Transaction details</h3>
        <dl className="text-sm grid grid-cols-1 sm:grid-cols-3 gap-y-2">
          <dt className="text-surface-500">When</dt>
          <dd className="col-span-2">{new Date(transaction.postedAt).toLocaleString()}</dd>
          <dt className="text-surface-500">Type</dt>
          <dd className="col-span-2">{transaction.type}</dd>
          <dt className="text-surface-500">Material</dt>
          <dd className="col-span-2">{transaction.materialSku} — {transaction.materialName}</dd>
          <dt className="text-surface-500">Location</dt>
          <dd className="col-span-2">{transaction.locationName}</dd>
          <dt className="text-surface-500">Quantity</dt>
          <dd className="col-span-2 text-num">{transaction.quantity}</dd>
          <dt className="text-surface-500">Recorded by</dt>
          <dd className="col-span-2">{transaction.actorName || '—'}</dd>
          {transaction.supplierName && (
            <>
              <dt className="text-surface-500">Supplier</dt>
              <dd className="col-span-2">{transaction.supplierName}</dd>
            </>
          )}
          {transaction.deliveryRef && (
            <>
              <dt className="text-surface-500">Invoice / delivery</dt>
              <dd className="col-span-2">{transaction.deliveryRef}{transaction.receiptNumber ? <span className="text-surface-400"> · {transaction.receiptNumber}</span> : null}</dd>
            </>
          )}
          {transaction.recipientName && (
            <>
              <dt className="text-surface-500">Issued to</dt>
              <dd className="col-span-2">{transaction.recipientName}</dd>
            </>
          )}
          {transaction.projectNumber && (
            <>
              <dt className="text-surface-500">Project</dt>
              <dd className="col-span-2 text-mono text-xs">{transaction.projectNumber}</dd>
            </>
          )}
          {transaction.reasonCode && (
            <>
              <dt className="text-surface-500">Reason</dt>
              <dd className="col-span-2">{transaction.reasonCode.replace(/_/g, ' ').toLowerCase()}</dd>
            </>
          )}
          {transaction.reasonNote && (
            <>
              <dt className="text-surface-500">Note</dt>
              <dd className="col-span-2">{transaction.reasonNote}</dd>
            </>
          )}
        </dl>
      </section>

      {transaction.reversesId && (
        <p className="text-sm text-surface-600 border-t border-surface-200 pt-4">
          This entry reverses an earlier movement.
        </p>
      )}
      {transaction.reversedById && (
        <p className="text-sm text-surface-600 border-t border-surface-200 pt-4">
          This movement has been reversed.
        </p>
      )}

      {hasReturns && (
        <p className="text-sm text-surface-600 border-t border-surface-200 pt-4">
          {returned} of {issued} returned to stock.{!transaction.reversedById && ' To reverse this issue, reverse its returns first.'}
        </p>
      )}

      {canReturn && (
        <ReturnSection
          transaction={transaction}
          returnable={issued - returned}
          onReturned={() => onReturned?.()}
          onError={onError}
        />
      )}

      {canReverse && (
        <section className="space-y-3 border-t border-surface-200 pt-4">
          <h3 className="text-h3 text-surface-900">Correct a mistake</h3>
          <p className="text-sm text-surface-600">
            Movements cannot be edited. Reversing posts an opposite entry and keeps both in the history
            {isTransfer ? '; both legs of the transfer are reversed together' : ''}.
          </p>
          {reversing ? (
            <div className="space-y-2">
              <Field label="Reason" htmlFor="reversal-reason" required>
                <Textarea
                  id="reversal-reason"
                  required
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  invalid={!!validation}
                  placeholder="e.g. Wrong item issued"
                />
              </Field>
              {validation && <p className="text-sm text-danger-700">{validation}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" type="button" onClick={handleCancel} disabled={busy}>Cancel</Button>
                <Button variant="danger" type="button" onClick={handleReverse} loading={busy}>
                  Reverse movement
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setReversing(true)}>Reverse this movement</Button>
          )}
        </section>
      )}
    </div>
  );
}

// Unused stock coming back from this issue (POST /inventory-transactions/:id/returns).
function ReturnSection({ transaction, returnable, onReturned, onError }: {
  transaction: MovementRow;
  returnable: number;
  onReturned: () => void;
  onError: (err: ApiError) => void;
}) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [locationId, setLocationId] = useState(transaction.locationId);
  const [reason, setReason] = useState('');
  const locations = useApi<Array<{ id: string; name: string; active: boolean }>>(open ? '/locations' : null);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  async function submit() {
    setValidation(null);
    const qty = Number(quantity);
    if (!(qty > 0)) { setValidation('Enter how much is coming back.'); return; }
    if (qty > returnable) { setValidation(`At most ${returnable} can come back.`); return; }
    setBusy(true);
    try {
      await api.post(`/inventory-transactions/${transaction.id}/returns`, {
        quantity: qty,
        locationId: locationId !== transaction.locationId ? locationId : undefined,
        reason: reason.trim() || undefined,
      });
      setOpen(false);
      setQuantity('');
      setReason('');
      onReturned();
    } catch (err) {
      const e = err as ApiError;
      if (['VALIDATION_ERROR', 'INVALID_STATE', 'NOT_FOUND'].includes(e.code)) setValidation(e.message);
      else if (e.code === 'FORBIDDEN') onError({ code: 'FORBIDDEN', message: 'You do not have permission to return stock.' });
      else onError({ code: 'NETWORK_ERROR', message: 'Unable to return the stock. Please try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 border-t border-surface-200 pt-4">
      <h3 className="text-h3 text-surface-900">Return to stock</h3>
      <p className="text-sm text-surface-600">Unused stock coming back from this issue. Up to {returnable} can come back.</p>
      {open ? (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Field label="Quantity returned" htmlFor="return-qty" required>
              <Input id="return-qty" type="number" inputMode="decimal" min="0" max={returnable} step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} invalid={!!validation} />
            </Field>
            <Field label="Back into" htmlFor="return-loc" error={locations.error ? "Couldn't load locations. Close and reopen to try again." : null}>
              <Select id="return-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value={transaction.locationId}>{transaction.locationName}</option>
                {(locations.data ?? []).filter((l) => l.active && l.id !== transaction.locationId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Note" htmlFor="return-reason">
            <Textarea id="return-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional, e.g. job finished early" />
          </Field>
          {validation && <p className="text-sm text-danger-700">{validation}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" type="button" onClick={() => { setOpen(false); setValidation(null); }} disabled={busy}>Cancel</Button>
            <Button variant="primary" type="button" onClick={submit} loading={busy}>Return to stock</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Return to stock</Button>
      )}
    </section>
  );
}
