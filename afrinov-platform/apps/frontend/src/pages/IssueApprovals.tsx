// Project material leaves the store only on the Workshop Manager's approval,
// or the Director standing in (ADR-043). The storeman asks for it on Issue
// stock and it waits here. Approving, possibly for less than was asked, posts
// the issue and stands as the slip's confirmation; rejecting posts nothing;
// whoever asked may cancel their own while it waits.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePagedList } from '../hooks/usePagedList';
import { usePermissions } from '../hooks/usePermissions';
import { useAuth } from '../auth';
import { useUnits } from '../hooks/useUnits';
import { PageHeader } from '../components/PageHeader';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Button } from '../components/Button';
import { Field, Select, Textarea } from '../components/Field';
import { Modal } from '../components/Modal';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { NoAccess } from '../components/NoAccess';
import { Badge } from '../components/Badge';
import { Alert } from '../components/Alert';
import { QuantityInput } from '../components/QuantityInput';
import { useToast } from '../components/Toast';
import { api, type ApiError } from '../api/client';
import { errorToast } from '../lib/errorPresentation';
import { useIdempotencyKey } from '../lib/idempotency';
import { formatDateTime, formatNumber } from '../lib/format';
import { parseQuantity } from '../lib/quantity';
import { waitedText } from './WriteOffApprovals';

type Status = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface IssueRequestLine {
  id: string;
  lineNo: number;
  material: { id: string; sku: string; name: string; unitOfMeasure: string };
  location: { id: string; name: string };
  quantity: string;
  approvedQuantity: string | null;
  /** Held for the project there now; only on a waiting request. */
  onHand: string | null;
}

export interface IssueRequest {
  id: string;
  projectNumber: string;
  projectName: string | null;
  recipient: { id: string; name: string; type: string };
  note: string | null;
  status: Status;
  requestedBy: { id: string; name: string };
  requestedAt: string;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** The Director decided in the Workshop Manager's place. */
  standIn: boolean;
  issueId: string | null;
  cursor: string;
  daysWaiting?: number;
  lines: IssueRequestLine[];
}

const STATUS_LABELS: Record<Status, string> = { PENDING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };

/** Who decides: the Workshop Manager, or the Director standing in. Admin alone doesn't (the server asks for the role). */
const DECIDING_ROLES = ['WORKSHOP_MANAGER', 'DIRECTOR'];

const qty = (q: string, unit: string) => `${formatNumber(Number(q))} ${unit}`;

export function IssueApprovals() {
  const [status, setStatus] = useState<Status>('PENDING');
  const requests = usePagedList<IssueRequest>(`/issue-requests?status=${status}`, 50);
  const { hasPermission } = usePermissions();
  const { user } = useAuth();
  const me = user?.id;
  const decides = (user?.roles ?? []).some((r) => DECIDING_ROLES.includes(r.toUpperCase()));
  const { kindOf } = useUnits();
  const toast = useToast();
  const [approving, setApproving] = useState<IssueRequest | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [approveNote, setApproveNote] = useState('');
  const [approveError, setApproveError] = useState<string | null>(null);
  // Rejecting someone's, or cancelling one's own: both need a reason and post nothing.
  const [closing, setClosing] = useState<{ request: IssueRequest; as: 'reject' | 'cancel' } | null>(null);
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const approveKey = useIdempotencyKey('approve-project-issue');
  const closeKey = useIdempotencyKey('close-project-issue');

  function openApprove(r: IssueRequest) {
    setApproving(r);
    setAmounts(Object.fromEntries(r.lines.map((l) => [l.id, l.quantity])));
    setApproveNote('');
    setApproveError(null);
  }

  async function approve() {
    if (!approving) return;
    const lines: Array<{ lineId: string; quantity: number }> = [];
    for (const l of approving.lines) {
      const parsed = parseQuantity(amounts[l.id] ?? '', kindOf(l.material.unitOfMeasure), l.material.unitOfMeasure, { allowZero: true });
      if (!parsed.ok) { setApproveError(`Line ${l.lineNo}: ${parsed.error}`); return; }
      if (parsed.value > Number(l.quantity)) { setApproveError(`Line ${l.lineNo}: approve at most the ${qty(l.quantity, l.material.unitOfMeasure)} asked for.`); return; }
      lines.push({ lineId: l.id, quantity: parsed.value });
    }
    if (lines.every((l) => l.quantity === 0)) { setApproveError('Approve at least one line, or reject the request.'); return; }
    setBusy(true);
    try {
      const body = { lines, ...(approveNote.trim() ? { note: approveNote.trim() } : {}) };
      await api.post(`/issue-requests/${approving.id}/approve`, body, { idempotencyKey: approveKey.keyFor({ id: approving.id, ...body }) });
      approveKey.confirm();
      toast.success(`Approved: issued to ${approving.recipient.name} for ${approving.projectNumber}`);
      setApproving(null);
      requests.reload();
    } catch (err) {
      approveKey.resolve(err);
      setApproveError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!closing) return;
    if (!reason.trim()) { setReasonMissing(true); return; }
    setBusy(true);
    try {
      const body = { reason: reason.trim() };
      await api.post(`/issue-requests/${closing.request.id}/${closing.as}`, body, { idempotencyKey: closeKey.keyFor({ id: closing.request.id, as: closing.as, ...body }) });
      closeKey.confirm();
      toast.success(closing.as === 'cancel' ? 'Cancelled: nothing was issued' : 'Rejected: nothing was issued');
      endClose();
      requests.reload();
    } catch (err) {
      closeKey.resolve(err);
      const { title, description } = errorToast(err);
      toast.error(title, description);
    } finally {
      setBusy(false);
    }
  }

  function endClose() { setClosing(null); setReason(''); setReasonMissing(false); }

  const columns: DataTableColumn<IssueRequest>[] = [
    {
      key: 'asked', header: 'Asked for',
      render: (r) => (
        <>
          <div>{formatDateTime(r.requestedAt)}</div>
          <div className="text-meta text-xs">by {r.requestedBy.name}</div>
          {r.daysWaiting !== undefined && <div className={`text-xs ${status === 'PENDING' && r.daysWaiting >= 2 ? 'text-warning-700 font-medium' : 'text-meta'}`}>{waitedText(r.daysWaiting, status === 'PENDING')}</div>}
        </>
      ),
    },
    {
      key: 'project', header: 'Project and recipient',
      render: (r) => (
        <>
          <div className="font-mono text-xs">{r.projectNumber}</div>
          {r.projectName && <div>{r.projectName}</div>}
          <div className="text-meta text-xs">To {r.recipient.name}</div>
          {r.note && <div className="text-meta text-xs">“{r.note}”</div>}
        </>
      ),
    },
    {
      key: 'items', header: 'Items',
      render: (r) => (
        <ul className="space-y-1">
          {r.lines.map((l) => {
            const short = l.onHand !== null && Number(l.onHand) < Number(l.quantity);
            return (
              <li key={l.id}>
                <span className="font-mono text-xs">{l.material.sku}</span> {l.material.name}
                <span className="font-mono"> · {qty(l.quantity, l.material.unitOfMeasure)}</span>
                {l.approvedQuantity !== null && l.approvedQuantity !== l.quantity && (
                  <span className="text-meta text-xs"> (approved {qty(l.approvedQuantity, l.material.unitOfMeasure)})</span>
                )}
                <div className={`text-xs ${short ? 'text-danger-700' : 'text-meta'}`}>
                  {l.location.name}{l.onHand !== null ? ` · ${qty(l.onHand, l.material.unitOfMeasure)} held for the project now` : ''}
                </div>
              </li>
            );
          })}
        </ul>
      ),
    },
    status === 'PENDING'
      ? {
        key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right',
        render: (r) => {
          if (r.requestedBy.id === me) {
            return (
              <div className="flex flex-col items-end gap-1">
                <span className="text-meta text-xs">Waiting for the Workshop Manager</span>
                <Button size="sm" variant="ghost" onClick={() => setClosing({ request: r, as: 'cancel' })}>Cancel</Button>
              </div>
            );
          }
          if (!decides) return <span className="text-meta text-xs">Waiting for the Workshop Manager</span>;
          return (
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setClosing({ request: r, as: 'reject' })}>Reject</Button>
              <Button size="sm" variant="primary" onClick={() => openApprove(r)}>Approve</Button>
            </div>
          );
        },
      }
      : {
        key: 'decided', header: 'Decided',
        render: (r) => (
          <>
            <Badge tone={r.status === 'APPROVED' ? 'success' : 'neutral'}>{STATUS_LABELS[r.status]}</Badge>
            <div className="text-meta text-xs mt-1">
              {r.decidedBy?.name}{r.standIn ? ' (Director, standing in)' : ''}{r.decidedAt ? `, ${formatDateTime(r.decidedAt)}` : ''}
            </div>
            {r.decisionNote && <div className="text-meta text-xs">{r.decisionNote}</div>}
          </>
        ),
      },
  ];

  if (!hasPermission('issues:view')) return <NoAccess title="Issues to approve" action="see project issues waiting for approval" />;

  return (
    <div>
      <PageHeader
        title="Issues to approve"
        description={<>Project material waits here until the Workshop Manager approves it, or the Director standing in. Nothing leaves the store until then. The storeman asks for it on <Link to="/stock/issue" className="btn-link">Issue stock</Link>.</>}
        breadcrumb={[{ label: 'Store' }, { label: 'Issues to approve' }]}
        actions={(
          <Field label="Show" htmlFor="ir-status" className="min-w-40">
            <Select id="ir-status" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              <option value="PENDING">Waiting</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </Select>
          </Field>
        )}
      />
      {requests.error
        ? <ErrorState error={requests.error} onRetry={requests.reload} />
        : (
          <DataTable
            ariaLabel="Issues to approve"
            columns={columns}
            rows={requests.rows}
            rowKey={(r) => r.id}
            isLoading={requests.loading && !requests.loaded}
            emptyState={<EmptyState title={status === 'PENDING' ? 'Nothing is waiting' : `Nothing ${STATUS_LABELS[status].toLowerCase()} yet`} description={status === 'PENDING' ? 'Stores stock is issued at once; only project material waits for approval.' : undefined} />}
          />
        )}
      {requests.hasMore && (
        <div className="flex justify-center py-3">
          <Button variant="secondary" onClick={requests.loadMore} loading={requests.loadingMore}>Load more</Button>
        </div>
      )}

      <Modal
        open={!!approving}
        onClose={() => setApproving(null)}
        title="Approve this issue?"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setApproving(null)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={approve} loading={busy}>Approve and issue</Button>
          </>
        )}
      >
        {approving && (
          <div className="space-y-3">
            <p className="text-sm text-surface-700">
              It issues to {approving.recipient.name} for {approving.projectNumber}, booked to {approving.requestedBy.name}. Your approval stands as the slip’s confirmation.
              Approve less where less should go: 0 leaves a line out.
            </p>
            {approving.lines.map((l) => (
              <Field
                key={l.id}
                label={`${l.material.sku} · ${l.material.name}`}
                htmlFor={`ir-qty-${l.id}`}
                help={`Asked for ${qty(l.quantity, l.material.unitOfMeasure)} at ${l.location.name}${l.onHand !== null ? `; ${qty(l.onHand, l.material.unitOfMeasure)} held for the project there now` : ''}.`}
              >
                <QuantityInput
                  id={`ir-qty-${l.id}`}
                  kind={kindOf(l.material.unitOfMeasure)}
                  unit={l.material.unitOfMeasure}
                  value={amounts[l.id] ?? ''}
                  onChange={(e) => { setAmounts((a) => ({ ...a, [l.id]: e.target.value })); setApproveError(null); }}
                />
              </Field>
            ))}
            <Field label="Note (optional)" htmlFor="ir-approve-note">
              <Textarea id="ir-approve-note" value={approveNote} onChange={(e) => setApproveNote(e.target.value)} placeholder="e.g. The rest once the first plates are used" />
            </Field>
            {approveError && <Alert tone="danger" title="Cannot approve">{approveError}</Alert>}
          </div>
        )}
      </Modal>

      <Modal
        open={!!closing}
        onClose={endClose}
        title={closing?.as === 'cancel' ? 'Cancel this request?' : 'Reject this issue?'}
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={endClose} disabled={busy}>Keep it</Button>
            <Button variant="danger" onClick={close} loading={busy}>{closing?.as === 'cancel' ? 'Cancel request' : 'Reject'}</Button>
          </>
        )}
      >
        <p className="text-sm text-surface-700 mb-3">Nothing is issued. {closing ? `${closing.request.projectNumber}, to ${closing.request.recipient.name}.` : ''}</p>
        <Field label="Why" htmlFor="ir-reason" required error={reasonMissing ? 'Say why.' : null}>
          <Textarea id="ir-reason" value={reason} onChange={(e) => { setReason(e.target.value); setReasonMissing(false); }} placeholder={closing?.as === 'cancel' ? 'e.g. Wrong recipient' : 'e.g. Use the offcuts first'} invalid={reasonMissing} />
        </Field>
      </Modal>
    </div>
  );
}
