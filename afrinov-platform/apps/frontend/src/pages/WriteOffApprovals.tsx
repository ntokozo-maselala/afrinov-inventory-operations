// Write-offs and other adjustments over the limit set under Settings →
// Inventory wait here for someone other than whoever asked for them
// (segregation of duties). Nothing moves until one is approved: approving
// posts it, rejecting posts nothing, and whoever asked may withdraw their own.
// An approver may also send one back for changes: whoever asked amends it and
// sends it again, and every step is kept in its history (ADR-044). A tool's
// write-off (lost on loan, or held for repair) goes through the same steps,
// and its posting is a step of its own, COMPLETED (ADR-045).
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePagedList } from '../hooks/usePagedList';
import { useApi } from '../hooks/useApi';
import { useUnits } from '../hooks/useUnits';
import { usePermissions } from '../hooks/usePermissions';
import { useAuth } from '../auth';
import { PageHeader } from '../components/PageHeader';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Button } from '../components/Button';
import { Field, Select, Textarea } from '../components/Field';
import { QuantityInput } from '../components/QuantityInput';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Alert } from '../components/Alert';
import { Badge } from '../components/Badge';
import { useToast } from '../components/Toast';
import { api } from '../api/client';
import { errorToast } from '../lib/errorPresentation';
import { useIdempotencyKey } from '../lib/idempotency';
import { parseQuantity } from '../lib/quantity';
import { formatDateTime, formatNumber } from '../lib/format';
import { formatMoney } from '../lib/poMoney';

type Status = 'PENDING' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
type EventKind = 'SUBMITTED' | 'CHANGES_REQUESTED' | 'RESUBMITTED' | 'APPROVED' | 'COMPLETED' | 'REJECTED' | 'WITHDRAWN';
const STATUSES: Status[] = ['PENDING', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN'];

/** One step in a request's history, with the request as it stood then. */
export interface AdjustmentRequestEvent {
  id: string;
  kind: EventKind;
  at: string;
  actor: { id: string; name: string };
  note: string | null;
  quantity: string;
  reasonCode: string;
  reasonNote: string | null;
  value: string | null;
  /** COMPLETED: the movement it posted (ADR-045). */
  transactionId?: string | null;
}

export interface AdjustmentRequest {
  id: string;
  status: Status;
  quantity: string;
  reasonCode: string;
  reasonNote: string | null;
  value: string | null;
  heldForProject: string | null;
  requestedAt: string;
  /** A page at a time (system audit C8): the row's cursor, and the days it has waited, or waited before it was decided. */
  cursor: string;
  daysWaiting?: number;
  decidedAt: string | null;
  decisionNote: string | null;
  material: { id: string; sku: string; name: string; unitOfMeasure: string };
  location: { id: string; name: string };
  recipient: { id: string; name: string } | null;
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
  /**
   * What whoever asked may change once it is sent back (ADR-045): ALL for one
   * made by hand; QUANTITY and the note for a tool lost on loan; NOTE only for
   * a stock count's difference or a tool held for repair.
   */
  amendable?: 'ALL' | 'QUANTITY' | 'NOTE';
  /** What it comes from: StockCount, ToolLoan (lost on loan) or ToolRepair (held for repair); null when made by hand. */
  referenceType?: string | null;
  events?: AdjustmentRequestEvent[];
}

const REASON_LABELS: Record<string, string> = { DAMAGE: 'Damage', LOSS: 'Loss', SCRAP: 'Scrap', FOUND: 'Found', OTHER: 'Other', COUNT_VARIANCE: 'Count variance' };
const STATUS_LABELS: Record<Status, string> = { PENDING: 'Waiting', CHANGES_REQUESTED: 'Sent back for changes', APPROVED: 'Approved', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn' };

/**
 * Whether whoever asked took it back themselves. A withdrawal has its own
 * status; one from before it did is REJECTED by the person who asked.
 */
const isWithdrawn = (r: AdjustmentRequest) => r.status === 'WITHDRAWN' || (r.status === 'REJECTED' && !!r.decidedBy && r.decidedBy.id === r.requestedBy.id);

/** "Withdrawn by Thandi Nkosi": the decision and who made it, never a rejection for a withdrawal. */
export function decidedText(r: AdjustmentRequest): string {
  const word = r.status === 'APPROVED' ? 'Approved' : isWithdrawn(r) ? 'Withdrawn' : 'Rejected';
  return r.decidedBy ? `${word} by ${r.decidedBy.name}` : word;
}
const EVENT_LABELS: Record<EventKind, string> = {
  SUBMITTED: 'Asked for', CHANGES_REQUESTED: 'Sent back for changes', RESUBMITTED: 'Changed and sent again',
  APPROVED: 'Approved', COMPLETED: 'Completed', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn',
};

/** Where a request came from, when not made by hand. */
const SOURCE_LABELS: Record<string, string> = { StockCount: 'Stock count', ToolLoan: 'Tool lost on loan', ToolRepair: 'Tool held for repair' };

/** Why only the note of one sent back can change, and how to change the rest. */
function noteOnlyText(r: AdjustmentRequest): string {
  if (r.referenceType === 'ToolRepair') return `${signed(r)} writes off the whole repair, so only the note can be changed here. To deal with the tool another way, withdraw it.`;
  if (r.referenceType === 'StockCount' || r.reasonCode === 'COUNT_VARIANCE') return `${signed(r)} comes from a stock count, so only the note can be changed here. To change the quantity, withdraw it and count again.`;
  return `${signed(r)} comes from another record, so only the note can be changed here. To change the quantity, withdraw it and start again.`;
}
const REMOVE_REASONS = ['DAMAGE', 'LOSS', 'SCRAP', 'OTHER'];
const ADD_REASONS = ['FOUND', 'OTHER'];
const RESPONSIBLE_REASONS = ['DAMAGE', 'LOSS', 'SCRAP'];
const NOTE_REASONS = ['FOUND', 'OTHER'];

/** "−8 m" or "+30 m": which way the stock would move. */
function signedOf(quantity: string, unit: string): string {
  const n = Number(quantity);
  return `${n > 0 ? '+' : '−'}${formatNumber(Math.abs(n))} ${unit}`;
}
const signed = (r: AdjustmentRequest) => signedOf(r.quantity, r.material.unitOfMeasure);

/** "Waiting since today", "Waiting 3 days", or how long it waited before it was decided. */
export function waitedText(days: number, waiting: boolean): string {
  if (waiting) return days === 0 ? 'Waiting since today' : `Waiting ${days} day${days === 1 ? '' : 's'}`;
  return days === 0 ? 'Decided the same day' : `Decided after ${days} day${days === 1 ? '' : 's'}`;
}

/** Every time it was sent, sent back or decided, oldest first. */
function HistoryDialog({ request, onClose }: { request: AdjustmentRequest | null; onClose: () => void }) {
  const unit = request?.material.unitOfMeasure ?? '';
  return (
    <Modal open={!!request} onClose={onClose} title={request ? `History: ${request.material.sku}` : 'History'} size="md" footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      {request && (
        <ol className="space-y-3">
          {(request.events ?? []).map((e) => (
            <li key={e.id} className="border-l-2 border-surface-200 pl-3 text-sm">
              <div className="font-medium">{EVENT_LABELS[e.kind] ?? e.kind} by {e.actor.name}</div>
              <div className="text-meta text-xs">{formatDateTime(e.at)}</div>
              <div className="text-xs mt-1">
                <span className="font-mono">{signedOf(e.quantity, unit)}</span> · {REASON_LABELS[e.reasonCode] ?? e.reasonCode}
                {e.value !== null ? ` · ${formatMoney(e.value)}` : ''}
                {e.reasonNote ? ` · ${e.reasonNote}` : ''}
              </div>
              {e.note && <div className="text-xs mt-1">“{e.note}”</div>}
            </li>
          ))}
          {(request.events ?? []).length === 0 && <li className="text-meta text-sm">No history is kept for this adjustment.</li>}
        </ol>
      )}
    </Modal>
  );
}

/** Whoever asked amends the adjustment sent back to them and sends it for approval again. */
function ResubmitDialog({ request, onClose, onDone }: { request: AdjustmentRequest; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { kindOf } = useUnits();
  const unit = request.material.unitOfMeasure;
  const removes = Number(request.quantity) < 0;
  const noteOnly = request.amendable === 'NOTE';
  // A tool lost on loan: how many, not why or by whom (ADR-045).
  const quantityOnly = request.amendable === 'QUANTITY';
  const reasons = removes ? REMOVE_REASONS : ADD_REASONS;
  const [reasonCode, setReasonCode] = useState(request.reasonCode);
  const [quantity, setQuantity] = useState(String(Math.abs(Number(request.quantity))).replace('.', ','));
  const [note, setNote] = useState(request.reasonNote ?? '');
  const [comment, setComment] = useState('');
  const [validation, setValidation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idem = useIdempotencyKey('resubmit-write-off');
  const parsed = parseQuantity(quantity, kindOf(unit), unit);
  const keepsResponsible = !quantityOnly && !!request.recipient && RESPONSIBLE_REASONS.includes(reasonCode);
  const noteRequired = NOTE_REASONS.includes(reasonCode) || keepsResponsible || quantityOnly;

  async function send() {
    if (!noteOnly && !parsed.ok) { setValidation(parsed.error); return; }
    if (noteRequired && !note.trim()) { setValidation(quantityOnly ? 'Say what happened to the tool.' : keepsResponsible ? 'Say what happened when naming who was responsible.' : reasonCode === 'FOUND' ? 'Say where the stock was found.' : 'Say why the stock is adjusted.'); return; }
    const body: Record<string, unknown> = {};
    if (!noteOnly && parsed.ok) {
      const amended = removes ? -parsed.value : parsed.value;
      if (amended !== Number(request.quantity)) body.quantity = amended;
      if (!quantityOnly) {
        if (reasonCode !== request.reasonCode) body.reasonCode = reasonCode;
        // Only damage, loss and scrap record who was responsible.
        if (request.recipient && !RESPONSIBLE_REASONS.includes(reasonCode)) body.recipientId = null;
      }
    }
    if (note.trim() !== (request.reasonNote ?? '')) body.reasonNote = note.trim() || null;
    if (comment.trim()) body.comment = comment.trim();
    setBusy(true);
    try {
      await api.post(`/adjustment-requests/${request.id}/resubmit`, body, { idempotencyKey: idem.keyFor({ id: request.id, ...body }) });
      idem.confirm();
      toast.success(`Sent again: ${request.material.sku} waits for approval`);
      onDone();
    } catch (err) {
      idem.resolve(err);
      const { title, description } = errorToast(err);
      toast.error(title, description);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Change and send again"
      size="md"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={send} loading={busy}>Send for approval</Button>
        </>
      )}
    >
      <Alert tone="warning" title={`${request.decidedBy?.name ?? 'The approver'} asked for changes`} className="mb-4">{request.decisionNote}</Alert>
      <p className="text-sm text-surface-700 mb-3">
        {request.material.sku} {request.material.name} at {request.location.name}{request.heldForProject ? `, held for ${request.heldForProject}` : ''}. Nothing is posted until it is approved.
      </p>
      {noteOnly && <p className="text-sm text-surface-700 mb-3">{noteOnlyText(request)}</p>}
      {quantityOnly && (
        <div className="mb-3">
          <p className="text-sm text-surface-700 mb-3">
            Lost while checked out{request.recipient ? ` to ${request.recipient.name}` : ''}. The tool stays on loan until this is approved; if some turned up, write off fewer and check the rest in.
          </p>
          <Field label="How many were lost" htmlFor="rs-qty" required>
            <QuantityInput id="rs-qty" kind={kindOf(unit)} unit={unit} required value={quantity} onChange={(e) => { setQuantity(e.target.value); setValidation(null); }} invalid={!!validation && !parsed.ok} />
          </Field>
        </div>
      )}
      {!noteOnly && !quantityOnly && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <Field label="What happened" htmlFor="rs-reason" required>
              <Select id="rs-reason" value={reasonCode} onChange={(e) => { setReasonCode(e.target.value); setValidation(null); }}>
                {(reasons.includes(request.reasonCode) ? reasons : [request.reasonCode, ...reasons]).map((r) => <option key={r} value={r}>{REASON_LABELS[r] ?? r}</option>)}
              </Select>
            </Field>
            <Field label={removes ? 'Quantity to remove' : 'Quantity to add'} htmlFor="rs-qty" required>
              <QuantityInput id="rs-qty" kind={kindOf(unit)} unit={unit} required value={quantity} onChange={(e) => { setQuantity(e.target.value); setValidation(null); }} invalid={!!validation && !parsed.ok} />
            </Field>
          </div>
      )}
      <Field label={noteRequired ? 'Note' : 'Note (optional)'} htmlFor="rs-note" required={noteRequired} className="mb-3">
        <Textarea id="rs-note" value={note} onChange={(e) => { setNote(e.target.value); setValidation(null); }} invalid={!!validation && noteRequired && !note.trim()} />
      </Field>
      <Field label="What you changed (optional)" htmlFor="rs-comment" help="For the approver, kept in the history." error={validation}>
        <Textarea id="rs-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Recounted the bin with Sipho" />
      </Field>
    </Modal>
  );
}

export function WriteOffApprovals() {
  // Tools links here with ?status= to show a tool's write-off where it stands (ADR-045).
  const [params] = useSearchParams();
  const [status, setStatus] = useState<Status>(() => STATUSES.find((s) => s === params.get('status')) ?? 'PENDING');
  // A page at a time, so none is out of sight however many wait (system audit C8).
  const requests = usePagedList<AdjustmentRequest>(`/adjustment-requests?status=${status}`, 50);
  // What came back to the person looking: theirs sent back for changes, or rejected or approved lately (ADR-044, ADR-045).
  const summary = useApi<{ sentBackToMe?: number; rejectedForMe?: number; approvedForMe?: number }>('/adjustment-requests/summary');
  const { hasPermission } = usePermissions();
  const canApprove = hasPermission('writeoffs:approve');
  const me = useAuth().user?.id;
  const toast = useToast();
  const [approving, setApproving] = useState<AdjustmentRequest | null>(null);
  const [rejecting, setRejecting] = useState<AdjustmentRequest | null>(null);
  // Sending it back for changes asks the same question as rejecting it: why.
  const [sendingBack, setSendingBack] = useState(false);
  const [changing, setChanging] = useState<AdjustmentRequest | null>(null);
  const [history, setHistory] = useState<AdjustmentRequest | null>(null);
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const approveKey = useIdempotencyKey('approve-write-off');
  const rejectKey = useIdempotencyKey('reject-write-off');
  const sentBackToMe = summary.data?.sentBackToMe ?? 0;
  const rejectedForMe = summary.data?.rejectedForMe ?? 0;
  const approvedForMe = summary.data?.approvedForMe ?? 0;

  function reload() { requests.reload(); summary.reload(); }

  async function approve() {
    if (!approving) return;
    setBusy(true);
    try {
      await api.post(`/adjustment-requests/${approving.id}/approve`, undefined, { idempotencyKey: approveKey.keyFor({ id: approving.id }) });
      approveKey.confirm();
      toast.success(`Approved: ${approving.material.sku} ${signed(approving)} posted`);
      setApproving(null);
      reload();
    } catch (err) {
      approveKey.resolve(err);
      const { title, description } = errorToast(err);
      toast.error(title, description);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!rejecting) return;
    if (!reason.trim()) { setReasonMissing(true); return; }
    const own = rejecting.requestedBy.id === me;
    setBusy(true);
    try {
      const body = { reason: reason.trim() };
      const step = sendingBack ? 'request-changes' : 'reject';
      await api.post(`/adjustment-requests/${rejecting.id}/${step}`, body, { idempotencyKey: rejectKey.keyFor({ id: rejecting.id, step, ...body }) });
      rejectKey.confirm();
      toast.success(sendingBack
        ? `Sent back to ${rejecting.requestedBy.name}: nothing was posted for ${rejecting.material.sku}`
        : own ? `Withdrawn: nothing was posted for ${rejecting.material.sku}` : `Rejected: nothing was posted for ${rejecting.material.sku}`);
      closeReject();
      reload();
    } catch (err) {
      rejectKey.resolve(err);
      const { title, description } = errorToast(err);
      toast.error(title, description);
    } finally {
      setBusy(false);
    }
  }

  function closeReject() { setRejecting(null); setSendingBack(false); setReason(''); setReasonMissing(false); }
  function sendBack(r: AdjustmentRequest) { setSendingBack(true); setRejecting(r); }

  const open = status === 'PENDING' || status === 'CHANGES_REQUESTED';
  const historyButton = (r: AdjustmentRequest) => (r.events && r.events.length > 0
    ? <Button size="sm" variant="ghost" onClick={() => setHistory(r)} aria-label={`History of ${r.material.sku}`}>History</Button>
    : null);

  const columns: DataTableColumn<AdjustmentRequest>[] = [
    {
      key: 'asked', header: 'Asked for',
      render: (r) => (
        <>
          <div>{formatDateTime(r.requestedAt)}</div>
          <div className="text-meta text-xs">by {r.requestedBy.name}</div>
          {r.daysWaiting !== undefined && <div className={`text-xs ${status === 'PENDING' && r.daysWaiting >= 7 ? 'text-warning-700 font-medium' : 'text-meta'}`}>{waitedText(r.daysWaiting, open)}</div>}
          {(r.events ?? []).some((e) => e.kind === 'RESUBMITTED') && <div className="text-meta text-xs">Changed and sent again</div>}
        </>
      ),
    },
    {
      key: 'item', header: 'Item',
      render: (r) => (
        <>
          <div className="font-mono text-xs">{r.material.sku}</div>
          <div>{r.material.name}</div>
          <div className="text-meta text-xs">{r.location.name}{r.heldForProject ? ` · held for ${r.heldForProject}` : ''}</div>
        </>
      ),
    },
    { key: 'qty', header: 'Change', align: 'right', render: (r) => <span className="font-mono">{signed(r)}</span> },
    {
      key: 'reason', header: 'Reason',
      render: (r) => (
        <>
          <div>{REASON_LABELS[r.reasonCode] ?? r.reasonCode}{r.recipient ? ` · ${r.recipient.name}` : ''}</div>
          {r.referenceType && SOURCE_LABELS[r.referenceType] && <div className="text-xs"><Badge tone="neutral">{SOURCE_LABELS[r.referenceType]}</Badge></div>}
          {r.reasonNote && <div className="text-meta text-xs">{r.reasonNote}</div>}
        </>
      ),
    },
    {
      key: 'value', header: 'Value', align: 'right',
      render: (r) => r.value === null ? <span className="text-meta">No unit cost</span> : <span className="font-mono">{formatMoney(r.value)}</span>,
    },
    status === 'PENDING'
      ? {
        key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
        render: (r) => {
          const own = r.requestedBy.id === me;
          if (own) {
            return (
              <div className="flex flex-col items-end gap-1">
                <span className="text-meta text-xs">Waiting for someone else</span>
                <div className="flex justify-end gap-2">{historyButton(r)}<Button size="sm" variant="ghost" onClick={() => setRejecting(r)}>Withdraw</Button></div>
              </div>
            );
          }
          if (!canApprove) return <div className="flex flex-col items-end gap-1"><span className="text-meta text-xs">Waiting for approval</span>{historyButton(r)}</div>;
          return (
            <div className="flex flex-wrap justify-end gap-2">
              {historyButton(r)}
              <Button size="sm" variant="ghost" onClick={() => setRejecting(r)}>Reject</Button>
              <Button size="sm" variant="secondary" onClick={() => sendBack(r)}>Request changes</Button>
              <Button size="sm" variant="primary" onClick={() => setApproving(r)}>Approve</Button>
            </div>
          );
        },
      }
      : status === 'CHANGES_REQUESTED'
        ? {
          key: 'sent-back', header: 'Sent back',
          render: (r) => {
            const own = r.requestedBy.id === me;
            return (
              <>
                <div className="text-meta text-xs">{r.decidedBy?.name}{r.decidedAt ? `, ${formatDateTime(r.decidedAt)}` : ''}</div>
                {r.decisionNote && <div className="text-xs">“{r.decisionNote}”</div>}
                <div className="flex flex-wrap gap-2 mt-1">
                  {own && <Button size="sm" variant="primary" onClick={() => setChanging(r)}>Change and send again</Button>}
                  {own && <Button size="sm" variant="ghost" onClick={() => setRejecting(r)}>Withdraw</Button>}
                  {!own && canApprove && <Button size="sm" variant="ghost" onClick={() => setRejecting(r)}>Reject</Button>}
                  {historyButton(r)}
                </div>
                {!own && <div className="text-meta text-xs mt-1">Waiting for {r.requestedBy.name} to change it</div>}
              </>
            );
          },
        }
        : {
          key: 'decided', header: 'Decided',
          render: (r) => (
            <>
              <Badge tone={r.status === 'APPROVED' ? 'success' : 'neutral'}>{decidedText(r)}</Badge>
              <div className="text-meta text-xs mt-1">{r.decidedAt ? formatDateTime(r.decidedAt) : ''}</div>
              {r.decisionNote && <div className="text-meta text-xs">{r.decisionNote}</div>}
              {historyButton(r)}
            </>
          ),
        },
  ];

  const own = rejecting?.requestedBy.id === me;
  const decisionTitle = sendingBack ? 'Send this adjustment back for changes?' : own ? 'Withdraw this adjustment?' : 'Reject this adjustment?';

  return (
    <div>
      <PageHeader
        title="Write-offs to approve"
        description="Adjustments worth more than the limit under Settings → Inventory, or of an item with no unit cost, wait here. Nothing moves until someone other than whoever asked approves it."
        breadcrumb={[{ label: 'Store' }, { label: 'Write-offs to approve' }]}
        actions={(
          <Field label="Show" htmlFor="wo-status" className="min-w-40">
            <Select id="wo-status" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              <option value="PENDING">Waiting</option>
              <option value="CHANGES_REQUESTED">Sent back for changes</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="WITHDRAWN">Withdrawn</option>
            </Select>
          </Field>
        )}
      />
      {sentBackToMe > 0 && status !== 'CHANGES_REQUESTED' && (
        <Alert tone="warning" title={`${formatNumber(sentBackToMe)} of your adjustments ${sentBackToMe === 1 ? 'was' : 'were'} sent back to you for changes`} className="mb-4">
          Nothing is posted until you change {sentBackToMe === 1 ? 'it' : 'them'} and send {sentBackToMe === 1 ? 'it' : 'them'} again, or withdraw {sentBackToMe === 1 ? 'it' : 'them'}.{' '}
          <button type="button" className="underline font-medium" onClick={() => setStatus('CHANGES_REQUESTED')}>Show {sentBackToMe === 1 ? 'it' : 'them'}</button>
        </Alert>
      )}
      {rejectedForMe > 0 && status !== 'REJECTED' && (
        <Alert tone="info" title={`${formatNumber(rejectedForMe)} of your adjustments ${rejectedForMe === 1 ? 'was' : 'were'} rejected in the last 7 days`} className="mb-4">
          Nothing was posted.{' '}
          <button type="button" className="underline font-medium" onClick={() => setStatus('REJECTED')}>See why</button>
        </Alert>
      )}
      {approvedForMe > 0 && status !== 'APPROVED' && (
        <Alert tone="success" title={`${formatNumber(approvedForMe)} of your adjustments ${approvedForMe === 1 ? 'was' : 'were'} approved in the last 7 days`} className="mb-4">
          {approvedForMe === 1 ? 'It was' : 'They were'} posted to stock.{' '}
          <button type="button" className="underline font-medium" onClick={() => setStatus('APPROVED')}>Show {approvedForMe === 1 ? 'it' : 'them'}</button>
        </Alert>
      )}
      {requests.error
        ? <ErrorState error={requests.error} onRetry={requests.reload} />
        : (
          <DataTable
            ariaLabel="Write-offs to approve"
            columns={columns}
            rows={requests.rows}
            rowKey={(r) => r.id}
            isLoading={requests.loading && !requests.loaded}
            emptyState={<EmptyState title={status === 'PENDING' ? 'Nothing is waiting' : status === 'CHANGES_REQUESTED' ? 'Nothing is sent back for changes' : `Nothing ${STATUS_LABELS[status].toLowerCase()} yet`} description={status === 'PENDING' ? 'Adjustments within the limit post at once.' : undefined} />}
          />
        )}
      {requests.hasMore && (
        <div className="flex justify-center py-3">
          <Button variant="secondary" onClick={requests.loadMore} loading={requests.loadingMore}>Load more</Button>
        </div>
      )}

      <ConfirmDialog
        open={!!approving}
        onClose={() => setApproving(null)}
        onConfirm={approve}
        loading={busy}
        title="Approve this adjustment?"
        description={approving
          ? `It posts ${signed(approving)} of ${approving.material.sku} at ${approving.location.name}${approving.value ? `, worth ${formatMoney(approving.value)}` : ''}, booked to ${approving.requestedBy.name}.`
          : undefined}
        confirmLabel="Approve and post"
      />

      <Modal
        open={!!rejecting}
        onClose={closeReject}
        title={decisionTitle}
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={closeReject} disabled={busy}>Cancel</Button>
            <Button variant={sendingBack ? 'primary' : 'danger'} onClick={reject} loading={busy}>{sendingBack ? 'Send back' : own ? 'Withdraw' : 'Reject'}</Button>
          </>
        )}
      >
        <p className="text-sm text-surface-700 mb-3">
          Nothing is posted. {rejecting ? `${rejecting.material.sku} ${signed(rejecting)}.` : ''}
          {sendingBack && rejecting ? ` ${rejecting.requestedBy.name} can change it and send it again.` : ''}
        </p>
        <Field label={sendingBack ? 'What needs to change' : 'Why'} htmlFor="wo-reason" required error={reasonMissing ? (sendingBack ? 'Say what needs to change.' : 'Say why.') : null}>
          <Textarea id="wo-reason" value={reason} onChange={(e) => { setReason(e.target.value); setReasonMissing(false); }} placeholder={sendingBack ? 'e.g. Recount the bin and attach the count' : 'e.g. Count it first'} invalid={reasonMissing} />
        </Field>
      </Modal>

      {changing && <ResubmitDialog key={changing.id} request={changing} onClose={() => setChanging(null)} onDone={() => { setChanging(null); reload(); }} />}
      <HistoryDialog request={history} onClose={() => setHistory(null)} />
    </div>
  );
}
