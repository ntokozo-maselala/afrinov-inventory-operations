import { useEffect, useState } from 'react';
import { Button } from './Button';
import { Field, Input, Select, Textarea } from './Field';
import { api, type ApiError } from '../api/client';
import { useApi } from '../hooks/useApi';
import { usePermissions } from '../hooks/usePermissions';
import type { MovementRow } from '../api/types';
import { locationLabel } from '../lib/locations';
import { useIdempotencyKey } from '../lib/idempotency';
import { formatDay, lateBy } from '../lib/toolLoans';
import { LoanHistory } from './LoanHistory';
import { ConsumableOutcomes } from './ConsumableOutcomes';
import { round4 } from '../lib/movementReason';


interface Props {
  transaction: Omit<MovementRow, 'cursor'>;
  onClose: () => void;
  onReversed: () => void;
  /** Called after stock is returned against this issue. */
  onReturned?: () => void;
  /** Called after part of this issue is marked used up or broken, or that is withdrawn; with what to tell the user. */
  onOutcomeChanged?: (message: string) => void;
  onError: (err: ApiError) => void;
}

/** The kind of row, in words, for the rows that are not a plain movement type. */
const TYPE_TEXT: Record<string, string> = {
  DUE_DATE_CHANGE: 'Due date moved',
  USED_UP: 'Used up (no stock moved)',
  BROKEN: 'Broken (no stock moved)',
  OUTCOME_WITHDRAWN: 'Used up or broken withdrawn (no stock moved)',
};

/** What the recipient was to a movement: who it was issued to, unless the movement says otherwise. */
export function recipientLabel(type: string): string {
  if (type === 'ADJUSTMENT') return 'Responsible';
  if (type === 'LOAN' || type === 'LOAN_RETURN' || type === 'DUE_DATE_CHANGE') return 'Checked out to';
  if (type === 'RETURN' || type === 'USED_UP' || type === 'BROKEN' || type === 'OUTCOME_WITHDRAWN') return 'Returned by';
  return 'Issued to';
}

/** The tool loan a row belongs to: a check-out is the loan; its check-ins, write-off and due date changes name it. */
export function loanOf(t: Pick<MovementRow, 'id' | 'type' | 'referenceType' | 'referenceId'>): string | null {
  if (t.type === 'LOAN') return t.id;
  return t.referenceType === 'ToolLoan' ? t.referenceId ?? null : null;
}

// The ledger is never edited. A mistaken movement is corrected by posting a
// reversing entry (POST /inventory-transactions/:id/reversal). A tool loan's
// due date change is not a movement: it is shown here with its loan, and put
// right by another change on the Tools page.
export function TransactionDrawer({ transaction, onClose: _onClose, onReversed, onReturned, onOutcomeChanged, onError }: Props) {
  const { hasPermission } = usePermissions();
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  // One key per movement: the transaction id is part of the operation name, so
  // a different movement gets its own key without an effect rotating anything.
  const idem = useIdempotencyKey(`reversal-${transaction.id}`);

  // eslint-disable react-hooks/set-state-in-effect
  useEffect(() => {
    setReversing(false); // eslint-disable-line react-hooks/set-state-in-effect
    setReason('');  
    setValidation(null);  
  }, [transaction.id]);
  // eslint-enable react-hooks/set-state-in-effect

  const isTransfer = transaction.type === 'TRANSFER_IN' || transaction.type === 'TRANSFER_OUT';
  const isDueDateChange = transaction.type === 'DUE_DATE_CHANGE';
  // A used up or broken mark of its own, or its withdrawal: no stock moved; put right on the issue.
  const isMark = transaction.referenceType === 'ConsumableOutcome';
  const loanId = loanOf(transaction);
  // A receipt against a purchase order also moved the order's received
  // quantities, so the server only lets it be put right on the order. A
  // counter receipt (Receive stock) is reversed like any other movement.
  const fromPurchaseOrder = transaction.referenceType === 'GoodsReceipt' && !!transaction.fromPurchaseOrder;
  const issued = transaction.type === 'ISSUE' ? -Number(transaction.quantity) : 0;
  const returned = Number(transaction.returnedQuantity ?? 0);
  const hasReturns = transaction.type === 'ISSUE' && returned > 0;
  // Tracked consumables: what was marked used up or broken is no longer out, so it can't come back either.
  const usedUp = Number(transaction.usedUpQuantity ?? 0);
  const broken = Number(transaction.brokenQuantity ?? 0);
  const hasOutcomes = transaction.type === 'ISSUE' && usedUp + broken > 0;
  const showsUse = transaction.type === 'ISSUE' && !transaction.reversesId && (!!transaction.trackUse || hasOutcomes);
  const canReturn = hasPermission('inventory:return')
    && transaction.type === 'ISSUE'
    && !transaction.reversesId
    && !transaction.reversedById
    && round4(issued - returned - usedUp - broken) > 0;
  // A return booked with used up or broken in the same visit: those are withdrawn first (Qodo, PR #144).
  const returnWithMarks = transaction.type === 'RETURN' && !transaction.reversesId && usedUp + broken > 0;
  const canReverse = hasPermission('inventory:reverse')
    && !hasReturns
    && !hasOutcomes
    && !returnWithMarks
    && !transaction.reversesId
    && !transaction.reversedById
    && !fromPurchaseOrder
    && !isMark
    // Tool loans are put right by checking the tool in or out again.
    && transaction.type !== 'LOAN' && transaction.type !== 'LOAN_RETURN' && transaction.referenceType !== 'ToolLoan';

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
    const reversalBody = { reason: reason.trim() };
    try {
      await api.post(`/inventory-transactions/${transaction.id}/reversal`, reversalBody, { idempotencyKey: idem.keyFor(reversalBody) });
      idem.confirm();
      setReversing(false);
      setReason('');
      onReversed();
    } catch (err) {
      const e = err as ApiError;
      idem.resolve(err);
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
          <dd className="col-span-2">{TYPE_TEXT[transaction.type] ?? transaction.type}</dd>
          <dt className="text-surface-500">Material</dt>
          <dd className="col-span-2">{transaction.materialSku} — {transaction.materialName}</dd>
          <dt className="text-surface-500">Location</dt>
          <dd className="col-span-2">{transaction.locationName}</dd>
          <dt className="text-surface-500">Quantity</dt>
          <dd className="col-span-2 text-num">{transaction.quantity ?? 'No stock moved'}</dd>
          {(transaction.type === 'RETURN' || isMark) && usedUp > 0 && (
            <>
              <dt className="text-surface-500">{transaction.type === 'OUTCOME_WITHDRAWN' ? 'Used up withdrawn' : 'Used up'}</dt>
              <dd className="col-span-2 text-num">{usedUp}</dd>
            </>
          )}
          {(transaction.type === 'RETURN' || isMark) && broken > 0 && (
            <>
              <dt className="text-surface-500">{transaction.type === 'OUTCOME_WITHDRAWN' ? 'Broken withdrawn' : 'Broken'}</dt>
              <dd className="col-span-2 text-num">{broken}</dd>
            </>
          )}
          {isMark && transaction.returnOf && (
            <>
              <dt className="text-surface-500">Against the issue of</dt>
              <dd className="col-span-2">{new Date(transaction.returnOf.postedAt).toLocaleString()} · {transaction.returnOf.locationName}</dd>
            </>
          )}
          {transaction.dueOn && (
            <>
              <dt className="text-surface-500">{isDueDateChange ? 'Due date' : 'Due back'}</dt>
              <dd className="col-span-2">
                {isDueDateChange && transaction.previousDueOn ? `${formatDay(transaction.previousDueOn)} → ` : ''}
                {formatDay(transaction.dueOn)}
                {transaction.type === 'LOAN' && transaction.currentDueOn && transaction.currentDueOn !== transaction.dueOn && ` (now ${formatDay(transaction.currentDueOn)})`}
                {transaction.type === 'LOAN_RETURN' && transaction.daysLate != null && ` · ${lateBy(transaction.daysLate).toLowerCase()}`}
              </dd>
            </>
          )}
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
              <dt className="text-surface-500">{recipientLabel(transaction.type)}</dt>
              <dd className="col-span-2">{transaction.recipientName}</dd>
            </>
          )}
          {transaction.projectNumber && (
            <>
              <dt className="text-surface-500">Project</dt>
              <dd className="col-span-2 text-mono text-xs">{transaction.projectNumber}</dd>
            </>
          )}
          {/* Whose stock moved, when it is a project's own: not who it was used for (Qodo, PR #145). */}
          {transaction.heldForProject && (
            <>
              <dt className="text-surface-500">Held for</dt>
              <dd className="col-span-2 text-mono text-xs">{transaction.heldForProject}</dd>
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
              <dt className="text-surface-500">{isDueDateChange || transaction.type === 'OUTCOME_WITHDRAWN' ? 'Why' : 'Note'}</dt>
              <dd className="col-span-2">{transaction.reasonNote}</dd>
            </>
          )}
          {transaction.overdueOverrideReason && (
            <>
              <dt className="text-surface-500">Lent while overdue</dt>
              <dd className="col-span-2">{transaction.overdueOverrideReason}</dd>
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
      {fromPurchaseOrder && !transaction.reversedById && hasPermission('inventory:reverse') && (
        <p className="text-sm text-surface-600 border-t border-surface-200 pt-4">
          This stock was received against a purchase order{transaction.receiptNumber ? ` (${transaction.receiptNumber})` : ''}, so it cannot be reversed here: correct it on the order.
        </p>
      )}

      {hasReturns && (
        <p className="text-sm text-surface-600 border-t border-surface-200 pt-4">
          {returned} of {issued} returned to stock.{!transaction.reversedById && ' To reverse this issue, reverse its returns first.'}
        </p>
      )}
      {returnWithMarks && !transaction.reversedById && hasPermission('inventory:reverse') && (
        <p className="text-sm text-surface-600 border-t border-surface-200 pt-4">
          Used up or broken was booked with this return. To reverse it, withdraw those on the issue first.
        </p>
      )}
      {hasOutcomes && !hasReturns && !transaction.reversedById && hasPermission('inventory:reverse') && (
        <p className="text-sm text-surface-600 border-t border-surface-200 pt-4">
          Part of this issue is marked used up or broken. To reverse it, withdraw those first.
        </p>
      )}

      {showsUse && (
        <ConsumableOutcomes
          transaction={transaction}
          onChanged={(message) => onOutcomeChanged?.(message)}
          onError={onError}
        />
      )}

      {canReturn && (
        <ReturnSection
          transaction={transaction}
          returnable={issued - returned - usedUp - broken}
          onReturned={() => onReturned?.()}
          onError={onError}
        />
      )}

      {loanId && <LoanHistory loanId={loanId} />}

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
  transaction: Omit<MovementRow, 'cursor'>;
  returnable: number;
  onReturned: () => void;
  onError: (err: ApiError) => void;
}) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [locationId, setLocationId] = useState(transaction.locationId);
  const [reason, setReason] = useState('');
  const locations = useApi<Array<{ id: string; name: string; active: boolean; parent?: { name: string } | null }>>(open ? '/locations' : null);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  // Scoped to this issue, so another issue opening in the same drawer position
  // gets its own key rather than inheriting this one's.
  const idem = useIdempotencyKey(`issue-return-${transaction.id}`);

  async function submit() {
    setValidation(null);
    const qty = Number(quantity);
    if (!(qty > 0)) { setValidation('Enter how much is coming back.'); return; }
    if (qty > returnable) { setValidation(`At most ${returnable} can come back.`); return; }
    setBusy(true);
    const returnBody = {
      quantity: qty,
      locationId: locationId !== transaction.locationId ? locationId : undefined,
      reason: reason.trim() || undefined,
    };
    try {
      await api.post(`/inventory-transactions/${transaction.id}/returns`, returnBody, { idempotencyKey: idem.keyFor(returnBody) });
      idem.confirm();
      setOpen(false);
      setQuantity('');
      setReason('');
      onReturned();
    } catch (err) {
      const e = err as ApiError;
      idem.resolve(err);
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
                <option value={transaction.locationId}>{locationLabel((locations.data ?? []).find((l) => l.id === transaction.locationId) ?? { name: transaction.locationName })}</option>
                {(locations.data ?? []).filter((l) => l.active && l.id !== transaction.locationId).map((l) => <option key={l.id} value={l.id}>{locationLabel(l)}</option>)}
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
