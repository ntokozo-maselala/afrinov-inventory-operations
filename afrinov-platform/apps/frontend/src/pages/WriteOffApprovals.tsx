// Write-offs and other adjustments over the limit set under Settings →
// Inventory wait here for someone other than whoever asked for them
// (segregation of duties). Nothing moves until one is approved: approving
// posts it, rejecting posts nothing, and whoever asked may withdraw their own.
import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { usePermissions } from '../hooks/usePermissions';
import { useAuth } from '../auth';
import { PageHeader } from '../components/PageHeader';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Button } from '../components/Button';
import { Field, Select, Textarea } from '../components/Field';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Badge } from '../components/Badge';
import { useToast } from '../components/Toast';
import { api } from '../api/client';
import { errorToast } from '../lib/errorPresentation';
import { useIdempotencyKey } from '../lib/idempotency';
import { formatDateTime, formatNumber } from '../lib/format';
import { formatMoney } from '../lib/poMoney';

type Status = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AdjustmentRequest {
  id: string;
  status: Status;
  quantity: string;
  reasonCode: string;
  reasonNote: string | null;
  value: string | null;
  heldForProject: string | null;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  material: { id: string; sku: string; name: string; unitOfMeasure: string };
  location: { id: string; name: string };
  recipient: { id: string; name: string } | null;
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
}

const REASON_LABELS: Record<string, string> = { DAMAGE: 'Damage', LOSS: 'Loss', SCRAP: 'Scrap', OTHER: 'Other', COUNT_VARIANCE: 'Count variance' };
const STATUS_LABELS: Record<Status, string> = { PENDING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Rejected' };

/** "−8 m" or "+30 m": which way the stock would move. */
function signed(r: AdjustmentRequest): string {
  const n = Number(r.quantity);
  return `${n > 0 ? '+' : '−'}${formatNumber(Math.abs(n))} ${r.material.unitOfMeasure}`;
}

export function WriteOffApprovals() {
  const [status, setStatus] = useState<Status>('PENDING');
  const requests = useApi<AdjustmentRequest[]>(`/adjustment-requests?status=${status}`);
  const { hasPermission } = usePermissions();
  const canApprove = hasPermission('writeoffs:approve');
  const me = useAuth().user?.id;
  const toast = useToast();
  const [approving, setApproving] = useState<AdjustmentRequest | null>(null);
  const [rejecting, setRejecting] = useState<AdjustmentRequest | null>(null);
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const approveKey = useIdempotencyKey('approve-write-off');
  const rejectKey = useIdempotencyKey('reject-write-off');

  async function approve() {
    if (!approving) return;
    setBusy(true);
    try {
      await api.post(`/adjustment-requests/${approving.id}/approve`, undefined, { idempotencyKey: approveKey.keyFor({ id: approving.id }) });
      approveKey.confirm();
      toast.success(`Approved: ${approving.material.sku} ${signed(approving)} posted`);
      setApproving(null);
      requests.reload();
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
      await api.post(`/adjustment-requests/${rejecting.id}/reject`, body, { idempotencyKey: rejectKey.keyFor({ id: rejecting.id, ...body }) });
      rejectKey.confirm();
      toast.success(own ? `Withdrawn: nothing was posted for ${rejecting.material.sku}` : `Rejected: nothing was posted for ${rejecting.material.sku}`);
      closeReject();
      requests.reload();
    } catch (err) {
      rejectKey.resolve(err);
      const { title, description } = errorToast(err);
      toast.error(title, description);
    } finally {
      setBusy(false);
    }
  }

  function closeReject() { setRejecting(null); setReason(''); setReasonMissing(false); }

  const columns: DataTableColumn<AdjustmentRequest>[] = [
    {
      key: 'asked', header: 'Asked for',
      render: (r) => <><div>{formatDateTime(r.requestedAt)}</div><div className="text-meta text-xs">by {r.requestedBy.name}</div></>,
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
                <Button size="sm" variant="ghost" onClick={() => setRejecting(r)}>Withdraw</Button>
              </div>
            );
          }
          if (!canApprove) return <span className="text-meta text-xs">Waiting for approval</span>;
          return (
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRejecting(r)}>Reject</Button>
              <Button size="sm" variant="primary" onClick={() => setApproving(r)}>Approve</Button>
            </div>
          );
        },
      }
      : {
        key: 'decided', header: 'Decided',
        render: (r) => (
          <>
            <Badge tone={r.status === 'APPROVED' ? 'success' : 'neutral'}>{STATUS_LABELS[r.status]}</Badge>
            <div className="text-meta text-xs mt-1">{r.decidedBy?.name}{r.decidedAt ? `, ${formatDateTime(r.decidedAt)}` : ''}</div>
            {r.decisionNote && <div className="text-meta text-xs">{r.decisionNote}</div>}
          </>
        ),
      },
  ];

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
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected or withdrawn</option>
            </Select>
          </Field>
        )}
      />
      {requests.error
        ? <ErrorState error={requests.error} onRetry={requests.reload} />
        : (
          <DataTable
            ariaLabel="Write-offs to approve"
            columns={columns}
            rows={requests.data ?? []}
            rowKey={(r) => r.id}
            isLoading={requests.loading && !requests.data}
            emptyState={<EmptyState title={status === 'PENDING' ? 'Nothing is waiting' : `Nothing ${STATUS_LABELS[status].toLowerCase()} yet`} description={status === 'PENDING' ? 'Adjustments within the limit post at once.' : undefined} />}
          />
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
        title={rejecting?.requestedBy.id === me ? 'Withdraw this adjustment?' : 'Reject this adjustment?'}
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={closeReject} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={reject} loading={busy}>{rejecting?.requestedBy.id === me ? 'Withdraw' : 'Reject'}</Button>
          </>
        )}
      >
        <p className="text-sm text-surface-700 mb-3">Nothing is posted. {rejecting ? `${rejecting.material.sku} ${signed(rejecting)}.` : ''}</p>
        <Field label="Why" htmlFor="wo-reason" required error={reasonMissing ? 'Say why.' : null}>
          <Textarea id="wo-reason" value={reason} onChange={(e) => { setReason(e.target.value); setReasonMissing(false); }} placeholder="e.g. Count it first" invalid={reasonMissing} />
        </Field>
      </Modal>
    </div>
  );
}
