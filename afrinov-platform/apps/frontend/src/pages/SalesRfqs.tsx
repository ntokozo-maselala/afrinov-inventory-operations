// Sales RFQs: how Sales prices a job for a client in one or more equipment
// lines, each from the production labour at the listed rates, the project's
// Procurement quotes and other costs, with the job's markup. The Director
// approves the price, and its quotation then goes to the client.
//
// The list lands on the ones still in hand (drafts and those waiting for the
// Director); the Director's "Waiting for my approval" is the status filter. A
// Sales RFQ's page shows each equipment line's costing, its quotation details
// and its Activity, with the actions its status and the viewer allow.
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../auth';
import { usePermissions } from '../hooks/usePermissions';
import { PageHeader, SectionHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Button } from '../components/Button';
import { Field, Input, Select, Textarea } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { Modal } from '../components/Modal';
import { Alert } from '../components/Alert';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { StaleDataNotice } from '../components/StaleDataNotice';
import { api, type ApiError } from '../api/client';
import { formatDateTime, formatNumber } from '../lib/format';
import { formatMoney } from '../lib/poMoney';
import { formatDay } from '../lib/rfq';
import { SALES_STATUS_LABEL, allMaterials, isCharged, mayApprove, type SalesEquipmentLine, type SalesLabourLine, type SalesMaterial, type SalesOtherCost, type SalesRfq, type SalesRfqStatus } from '../lib/salesRfq';
import { QUOTATION_SETTINGS, downloadQuotation, quotationCompanyFromSettings } from '../lib/salesQuotation';

const LIST = { label: 'Sales RFQs', to: '/sales-rfqs' };

/** Drafts and those waiting for the Director: the default view. */
const IN_HAND = 'DRAFT,PENDING_APPROVAL';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: IN_HAND, label: 'Draft & waiting' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_APPROVAL', label: 'Waiting for approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const STATUS_TONE: Record<SalesRfqStatus, 'neutral' | 'warning' | 'success' | 'danger'> = {
  DRAFT: 'neutral', PENDING_APPROVAL: 'warning', APPROVED: 'success', CANCELLED: 'danger',
};

export function SalesRfqStatusBadge({ status }: { status: SalesRfqStatus }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'} dot>{SALES_STATUS_LABEL[status] ?? status}</Badge>;
}

export function SalesRfqs() {
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('sales:manage');
  const canApprove = hasPermission('sales:approve');
  const rfqs = useApi<SalesRfq[]>('/sales-rfqs');
  const [q, setQ] = useState('');
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get('status');
  // The Director lands on what waits for them; Sales on what it still has in hand.
  const defaultStatus = canApprove && !canManage ? 'PENDING_APPROVAL' : IN_HAND;
  const status = rawStatus === null ? defaultStatus : rawStatus === 'all' ? '' : rawStatus;
  const statuses = status ? status.split(',') : [];
  const setStatus = (v: string) => setParams((p) => { if (v === defaultStatus) p.delete('status'); else p.set('status', v || 'all'); return p; }, { replace: true });

  const needle = q.trim().toLowerCase();
  const filtered = (rfqs.data ?? []).filter((r) => {
    if (statuses.length > 0 && !statuses.includes(r.status)) return false;
    if (!needle) return true;
    return `${r.number} ${r.quoteReference ?? ''} ${r.projectNumber} ${r.equipmentLines.map((l) => l.equipment ?? '').join(' ')} ${r.clientName ?? ''} ${r.description ?? ''}`.toLowerCase().includes(needle);
  });

  return (
    <div>
      <PageHeader
        title="Sales RFQs"
        description="Price a piece of equipment for the client: the labour at the listed rates, the material from the project's approved orders, and the job's markup. The Director approves the price before the quotation goes out. Only Sales and senior managers see these."
        actions={canManage ? <Link to="/sales-rfqs/new" className="btn-primary"><Icon.Plus size={14} /> New Sales RFQ</Link> : undefined}
      />
      <Toolbar
        left={(
          <>
            <div className="relative w-full sm:w-64">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input className="pl-8" placeholder="Search RFQ, project, client or equipment…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search Sales RFQs" />
            </div>
            <Select className="sm:w-52" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value === 'PENDING_APPROVAL' && canApprove ? 'Waiting for my approval' : o.label}</option>)}
            </Select>
            {(q || rawStatus !== null) && (
              <Button variant="ghost" size="sm" onClick={() => { setQ(''); setParams((p) => { p.delete('status'); return p; }, { replace: true }); }}>Clear</Button>
            )}
          </>
        )}
        right={<span className="text-meta">{rfqs.loading ? 'Loading…' : `${filtered.length} of ${rfqs.data?.length ?? 0}`}</span>}
      />

      {rfqs.error && !rfqs.stale && <ErrorState error={rfqs.error} onRetry={rfqs.reload} />}
      {rfqs.stale && <StaleDataNotice error={rfqs.error} onRetry={rfqs.reload} />}
      {(!rfqs.error || rfqs.stale) && (
        <DataTable
          ariaLabel="Sales RFQs"
          isLoading={rfqs.loading}
          rowKey={(r) => r.id}
          rows={filtered}
          columns={LIST_COLUMNS}
          emptyState={(rfqs.data?.length ?? 0) > 0 || q ? (
            <EmptyState title={status === 'PENDING_APPROVAL' ? 'Nothing waiting for approval' : 'No Sales RFQs match your filters'} description="Try another status, or clear the filters." />
          ) : (
            <EmptyState
              title="No Sales RFQs yet"
              description="Raise one to price a piece of equipment for a client."
              action={canManage ? <Link to="/sales-rfqs/new" className="btn-primary">Raise your first Sales RFQ</Link> : undefined}
            />
          )}
        />
      )}
    </div>
  );
}

const LIST_COLUMNS: DataTableColumn<SalesRfq>[] = [
  {
    key: 'num', header: 'Sales RFQ', width: '13rem',
    render: (r) => (
      <div>
        <Link to={`/sales-rfqs/${r.id}`} className="btn-link text-mono whitespace-nowrap">{r.number}</Link>
        {r.quoteReference && <div className="text-meta text-mono">Quote {r.quoteReference}</div>}
      </div>
    ),
  },
  {
    key: 'equipment', header: 'Equipment', render: (r) => (
      <div className="min-w-0">
        <div className="truncate">
          {r.equipment ?? <span className="text-surface-400">Not named yet</span>}
          {r.equipmentLines.length > 1 && <span className="text-meta"> and {r.equipmentLines.length - 1} more</span>}
        </div>
        <div className="text-meta">Project {r.projectNumber}{r.clientName ? ` · ${r.clientName}` : ''}</div>
      </div>
    ),
  },
  { key: 'total', header: 'Total excl. VAT', align: 'right', width: '9rem', className: 'text-num', render: (r) => <span className="font-mono">{formatMoney(r.totals.totalExVat)}</span> },
  { key: 'status', header: 'Status', width: '11rem', render: (r) => <SalesRfqStatusBadge status={r.status} /> },
];

interface HistoryEntry {
  id: string;
  action: string;
  actorId: string | null;
  actorName?: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

type Dialog = 'submit' | 'approve' | 'send-back' | 'cancel' | null;

export function SalesRfqDetail() {
  const { id } = useParams<{ id: string }>();
  const rfq = useApi<SalesRfq>(id ? `/sales-rfqs/${id}` : null);
  const history = useApi<HistoryEntry[]>(id ? `/sales-rfqs/${id}/history` : null);
  const { hasPermission } = usePermissions();
  const { user } = useAuth();
  const canManage = hasPermission('sales:manage');
  // Procurement RFQs open for those who see project orders.
  const seesRfqs = hasPermission('orders:view');
  const navigate = useNavigate();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [printing, setPrinting] = useState(false);
  const reload = () => { rfq.reload(); history.reload(); };
  const r = rfq.data;
  const approver = !!r && mayApprove(r, user?.id, hasPermission('sales:approve'));
  const materials = r ? allMaterials(r) : [];

  async function act(label: string, run: () => Promise<SalesRfq>) {
    try {
      const saved = await run();
      toast.success(label.replace('{n}', saved.number));
      setDialog(null);
      reload();
    } catch (err) {
      toast.error('That did not go through', (err as ApiError).message);
      throw err;
    }
  }

  async function printQuotation() {
    if (!r) return;
    setPrinting(true);
    try {
      const values = await api.get<Record<string, unknown>>(`/settings/values?keys=${QUOTATION_SETTINGS.join(',')}`);
      await downloadQuotation(r, quotationCompanyFromSettings(values));
    } catch (err) {
      toast.error('Could not make the quotation', (err as ApiError).message ?? String(err));
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={r?.number ?? (rfq.loading ? 'Loading…' : 'Sales RFQ')}
        description={r ? [r.equipment, `Project ${r.projectNumber}`, r.clientName].filter(Boolean).join(' · ') : ''}
        breadcrumb={[LIST, { label: r?.number ?? 'Sales RFQ' }]}
        actions={r && (
          <div className="flex flex-wrap items-center gap-2">
            <SalesRfqStatusBadge status={r.status} />
            {canManage && r.status === 'DRAFT' && (
              <>
                <Button variant="primary" leadingIcon={<Icon.ArrowRight size={14} />} onClick={() => setDialog('submit')}>Submit for approval</Button>
                <Button variant="secondary" leadingIcon={<Icon.Edit size={14} />} onClick={() => navigate(`/sales-rfqs/${r.id}/edit`)}>Edit</Button>
              </>
            )}
            {approver && (
              <>
                <Button variant="primary" leadingIcon={<Icon.Check size={14} />} onClick={() => setDialog('approve')}>Approve</Button>
                <Button variant="secondary" onClick={() => setDialog('send-back')}>Send back</Button>
              </>
            )}
            {r.status !== 'CANCELLED' && (
              <Button variant={r.status === 'APPROVED' ? 'primary' : 'secondary'} leadingIcon={<Icon.Download size={14} />} loading={printing} onClick={() => void printQuotation()}>
                {r.status === 'APPROVED' ? 'Download quotation' : 'Preview quotation'}
              </Button>
            )}
            {canManage && r.status !== 'CANCELLED' && <Button variant="ghost" onClick={() => setDialog('cancel')}>Cancel</Button>}
          </div>
        )}
      />

      {rfq.error && !rfq.stale && <ErrorState error={rfq.error} onRetry={reload} />}
      {rfq.stale && <StaleDataNotice error={rfq.error} onRetry={reload} />}
      {rfq.loading && !r && <div className="surface-card p-6 h-72"><Skeleton h={240} /></div>}

      {r && (
        <div className="space-y-6">
          {r.status === 'DRAFT' && r.returnReason && (
            <Alert tone="warning" title={`Sent back${r.returnedBy ? ` by ${r.returnedBy.name}` : ''}`}>{r.returnReason}</Alert>
          )}
          {r.status === 'DRAFT' && materials.some((m) => m.unusable) && (
            <Alert tone="danger" title="A quote can't be counted">
              The quote on {materials.filter((m) => m.unusable).map((m) => m.rfqNumber).join(', ')} was withdrawn, its RFQ was cancelled, or it can&rsquo;t be valued in rand. Edit the Sales RFQ to choose another before submitting.
            </Alert>
          )}
          {r.status === 'APPROVED' && (
            <Alert tone="success" title={`Approved as quotation ${r.quoteReference ?? ''}`}>
              {r.approvedAt ? `On ${formatDateTime(r.approvedAt)}` : ''}{r.approvedBy ? ` by ${r.approvedBy.name}` : ''}. Download the quotation to send to the client.
            </Alert>
          )}
          {r.status === 'CANCELLED' && <Alert tone="danger" title="Cancelled">{r.cancellationReason ?? 'No reason given.'}</Alert>}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <aside className="lg:col-span-1 space-y-6">
              <div className="surface-card p-4 space-y-3">
                <h2 className="text-h3 text-surface-900">Price</h2>
                <Totals r={r} />
              </div>
              <div className="surface-card p-4 space-y-3">
                <h2 className="text-h3 text-surface-900">Summary</h2>
                <dl className="text-sm grid grid-cols-3 gap-y-2">
                  <dt className="text-surface-500">RFQ no.</dt><dd className="col-span-2 text-mono">{r.number}</dd>
                  <dt className="text-surface-500">Quotation</dt><dd className="col-span-2 text-mono">{r.quoteReference ?? 'Given when approved'}</dd>
                  <dt className="text-surface-500">Project</dt><dd className="col-span-2">{r.projectNumber}{r.project?.name ? ` — ${r.project.name}` : ''}</dd>
                  <dt className="text-surface-500">Equipment</dt>
                  <dd className="col-span-2">{r.equipmentLines.map((l) => l.equipment ?? 'Not named yet').join('; ') || '—'}</dd>
                  <dt className="text-surface-500">Description</dt><dd className="col-span-2">{r.description ?? '—'}</dd>
                  <dt className="text-surface-500">Price due</dt><dd className="col-span-2">{r.closingDate ? formatDay(r.closingDate) : '—'}</dd>
                  <dt className="text-surface-500">Raised</dt><dd className="col-span-2 text-meta">{formatDateTime(r.createdAt)}{r.createdBy ? <><br /><span className="text-surface-400">by {r.createdBy.name}</span></> : null}</dd>
                  {r.submittedAt && <><dt className="text-surface-500">Submitted</dt><dd className="col-span-2 text-meta">{formatDateTime(r.submittedAt)}{r.submittedBy ? <><br /><span className="text-surface-400">by {r.submittedBy.name}</span></> : null}</dd></>}
                  {r.issuedAt && <><dt className="text-surface-500">Issued</dt><dd className="col-span-2">{formatDay(r.issuedAt)}</dd></>}
                  {r.quoteNotes && <><dt className="text-surface-500">Notes on the quotation</dt><dd className="col-span-2 whitespace-pre-wrap">{r.quoteNotes}</dd></>}
                  {r.notes && <><dt className="text-surface-500">Remarks</dt><dd className="col-span-2 whitespace-pre-wrap">{r.notes}</dd></>}
                </dl>
              </div>
            </aside>

            <div className="lg:col-span-2 space-y-6">
              {materials.some((m) => !m.recommended) && (
                <Alert tone="info" title="Not the quote Procurement recommends">
                  {materials.filter((m) => !m.recommended).map((m) => `${m.rfqNumber}: ${m.supplier} chosen, ${m.recommendedSupplier?.name ?? 'another supplier'} recommended`).join('; ')}.
                </Alert>
              )}
              {r.equipmentLines.map((line) => (
                <EquipmentLineSection key={line.id} line={line} r={r} canEdit={canManage && r.status === 'DRAFT'} linked={seesRfqs} />
              ))}
              <section>
                <SectionHeader title="On the quotation" description="Who it is to, and the conditions printed under the prices." />
                <dl className="surface-card p-4 text-sm grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-2">
                  <dt className="text-surface-500">Client</dt><dd className="whitespace-pre-wrap">{[r.clientName, r.clientAddress].filter(Boolean).join('\n') || '—'}</dd>
                  <dt className="text-surface-500">Dear</dt><dd>{r.contactName ?? '—'}</dd>
                  <dt className="text-surface-500">Your reference</dt><dd>{r.clientReference ?? 'N/A'}</dd>
                  <dt className="text-surface-500">Payment terms</dt><dd>{r.paymentTerms ?? '—'}</dd>
                  <dt className="text-surface-500">Validity</dt><dd>{r.validity ?? '—'}</dd>
                  <dt className="text-surface-500">Delivery duration</dt><dd>{r.deliveryDuration ?? '—'}</dd>
                  <dt className="text-surface-500">Delivery</dt><dd>{r.deliveryTerms ?? '—'}</dd>
                  <dt className="text-surface-500">Signed by</dt><dd>{[r.submittedBy?.name ?? r.createdBy?.name, r.signerPhone, r.signerEmail].filter(Boolean).join(' · ') || '—'}</dd>
                </dl>
              </section>
              <section>
                <SectionHeader title="Activity" description="What has happened to this Sales RFQ." />
                <History entries={history.data ?? []} loading={history.loading} />
              </section>
            </div>
          </div>
        </div>
      )}

      {r && dialog === 'submit' && (
        <ConfirmDialog
          title={`Submit ${r.number} for approval?`}
          description={`It goes to the Director at ${formatMoney(r.totals.totalExVat)} excl. VAT. Its quotes' amounts and the VAT rate are fixed as they are now, and it can't be edited unless the Director sends it back.`}
          confirm="Submit" onClose={() => setDialog(null)}
          onConfirm={() => act('{n} submitted for approval', () => api.post<SalesRfq>(`/sales-rfqs/${r.id}/submit`))}
        />
      )}
      {r && dialog === 'approve' && (
        <ConfirmDialog
          title={`Approve ${r.number}?`}
          description={`The quotation goes to the client at ${formatMoney(r.totals.totalExVat)} excl. VAT (${formatMoney(r.totals.totalIncVat)} incl. VAT), a markup of ${formatMoney(r.totals.markup)} on a cost of ${formatMoney(r.totals.cost)}. It is given its quotation reference today.`}
          confirm="Approve" onClose={() => setDialog(null)}
          onConfirm={() => act('{n} approved', () => api.post<SalesRfq>(`/sales-rfqs/${r.id}/approve`))}
        />
      )}
      {r && dialog === 'send-back' && (
        <ReasonDialog
          title={`Send ${r.number} back to Sales?`} description="It goes back to a draft for Sales to change and submit again." label="What should change"
          confirm="Send back" placeholder="e.g. Markup too low for this client" onClose={() => setDialog(null)}
          onConfirm={(reason) => act('{n} sent back', () => api.post<SalesRfq>(`/sales-rfqs/${r.id}/send-back`, { reason }))}
        />
      )}
      {r && dialog === 'cancel' && (
        <ReasonDialog
          title={`Cancel ${r.number}?`} description={r.status === 'APPROVED' ? 'Its quotation may already be with the client: let them know it is off.' : 'It is kept, marked cancelled.'} label="Reason"
          confirm="Cancel Sales RFQ" danger placeholder="e.g. Client went elsewhere" onClose={() => setDialog(null)}
          onConfirm={(reason) => act('{n} cancelled', () => api.post<SalesRfq>(`/sales-rfqs/${r.id}/cancel`, { reason }))}
        />
      )}
    </div>
  );
}

/** The costing, as the server worked it out. */
function Totals({ r }: { r: SalesRfq }) {
  const t = r.totals;
  const row = (label: string, value: string | null, opts: { strong?: boolean; muted?: string } = {}) => (
    <div className={`flex justify-between gap-3 ${opts.strong ? 'font-semibold text-surface-900 border-t border-surface-200 pt-2' : ''}`}>
      <dt className={opts.strong ? '' : 'text-surface-500'}>{label}{opts.muted && <span className="text-meta"> {opts.muted}</span>}</dt>
      <dd className="font-mono tabular-nums">{value === null ? '—' : formatMoney(value)}</dd>
    </div>
  );
  return (
    <dl className="text-sm space-y-2" aria-label="Price">
      {row('Labour', t.labour)}
      {row('Material', t.material)}
      {Number(t.other) > 0 && row('Other costs', t.other)}
      {row('Cost', t.cost, { strong: true })}
      {row('Markup', t.markup, { muted: r.markupPercent !== null ? `${formatNumber(Number(r.markupPercent))}%` : 'not set' })}
      {row(r.equipmentLines.length === 1 ? (r.equipment ?? 'Equipment') : `${r.equipmentLines.length} equipment lines`, t.equipment, { strong: true })}
      {row('Delivery', t.delivery)}
      {row('Total excl. VAT', t.totalExVat, { strong: true })}
      {row('VAT', t.vat, { muted: `${formatNumber(Number(t.vatRate))}%` })}
      {row('Total incl. VAT', t.totalIncVat, { strong: true })}
    </dl>
  );
}

/**
 * One equipment line: what the quotation prints for it, then what it costs for
 * one unit (labour, quotes, other costs) and its price, so the Director can
 * trace each figure on the quotation.
 */
function EquipmentLineSection({ line, r, canEdit, linked }: { line: SalesEquipmentLine; r: SalesRfq; canEdit: boolean; linked: boolean }) {
  const t = line.totals;
  const several = r.equipmentLines.length > 1;
  const nothing = line.labour.length === 0 && line.materials.length === 0 && line.otherCosts.length === 0;
  const charged = isCharged(line);
  const priced = t.unitPrice === null
    ? `Cost ${formatMoney(t.unitCost)} a unit; priced once the markup is set`
    : charged
      ? `${formatNumber(line.quantity)} × ${formatMoney(t.unitPrice)} = ${formatMoney(t.total)}`
      : `Not charged: shown on the quotation at ${formatMoney(t.unitPrice)} a unit, R - in total`;
  return (
    <section aria-label={`Equipment line ${line.lineNo}`} className="space-y-3">
      <SectionHeader
        title={`${several ? `${line.lineNo}. ` : ''}${line.equipment ?? 'Equipment not named yet'}`}
        description={`${priced}${line.quantity > 1 ? '. The costs below are for one unit.' : ''}`}
      />
      {line.details && <p className="text-sm text-surface-700 whitespace-pre-wrap">{line.details}</p>}
      {nothing && <EmptyState title="Nothing priced yet" description={canEdit ? 'Edit the Sales RFQ to add labour, a quote or another cost to this line.' : 'Nothing was priced on this line.'} />}
      {line.labour.length > 0 && (
        <div>
          <h3 className="text-eyebrow mb-1">Production labour</h3>
          <DataTable ariaLabel={`Labour on line ${line.lineNo}`} rows={line.labour} rowKey={(l) => l.id} columns={LABOUR_COLUMNS} />
        </div>
      )}
      {line.materials.length > 0 && (
        <div>
          <h3 className="text-eyebrow mb-1">Material</h3>
          <p className="text-meta mb-1">{r.status === 'DRAFT' ? 'Each quote at its total excl. VAT as it stands today.' : 'Each quote at its total excl. VAT when it was submitted.'}</p>
          <DataTable ariaLabel={`Material quotes on line ${line.lineNo}`} rows={line.materials} rowKey={(m) => m.rfqId} columns={materialColumns(linked)} />
        </div>
      )}
      {line.otherCosts.length > 0 && (
        <div>
          <h3 className="text-eyebrow mb-1">Other costs</h3>
          <DataTable ariaLabel={`Other costs on line ${line.lineNo}`} rows={line.otherCosts} rowKey={(c) => c.id} columns={OTHER_COLUMNS} />
        </div>
      )}
      {!nothing && (
        <dl className="text-sm surface-card p-3 grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label={`Price of line ${line.lineNo}`}>
          <div><dt className="text-meta">Cost a unit</dt><dd className="font-mono">{formatMoney(t.unitCost)}</dd></div>
          <div><dt className="text-meta">Markup a unit</dt><dd className="font-mono">{formatMoney(t.unitMarkup)}</dd></div>
          <div><dt className="text-meta">Unit price</dt><dd className="font-mono">{formatMoney(t.unitPrice)}</dd></div>
          <div><dt className="text-meta">Total ({formatNumber(line.quantity)})</dt><dd className="font-mono font-semibold">{charged ? formatMoney(t.total) : 'Not charged'}</dd></div>
        </dl>
      )}
    </section>
  );
}

const OTHER_COLUMNS: DataTableColumn<SalesOtherCost>[] = [
  { key: 'description', header: 'Cost', render: (c) => c.description },
  { key: 'quantity', header: 'Quantity', align: 'right', width: '7rem', className: 'text-num', render: (c) => <span className="font-mono">{formatNumber(Number(c.quantity))}</span> },
  { key: 'unit', header: 'Unit cost', align: 'right', width: '9rem', className: 'text-num', render: (c) => <span className="font-mono">{formatMoney(c.unitCost)}</span> },
  { key: 'total', header: 'Total', align: 'right', width: '9rem', className: 'text-num', render: (c) => <span className="font-mono">{formatMoney(c.total)}</span> },
];

const LABOUR_COLUMNS: DataTableColumn<SalesLabourLine>[] = [
  { key: 'role', header: 'Role', render: (l) => l.role },
  { key: 'hours', header: 'Hours', align: 'right', width: '7rem', className: 'text-num', render: (l) => <span className="font-mono">{formatNumber(Number(l.hours))}</span> },
  { key: 'rate', header: 'Rate / hour', align: 'right', width: '9rem', className: 'text-num', render: (l) => <span className="font-mono">{formatMoney(l.hourlyRate)}</span> },
  { key: 'total', header: 'Total', align: 'right', width: '9rem', className: 'text-num', render: (l) => <span className="font-mono">{formatMoney(l.total)}</span> },
];

const materialColumns = (linked: boolean): DataTableColumn<SalesMaterial>[] => [
  {
    key: 'rfq', header: 'Procurement RFQ', width: '13rem', render: (m) => (
      <div>
        {linked ? <Link to={`/rfqs/${m.rfqId}`} className="btn-link text-mono">{m.rfqNumber}</Link> : <span className="text-mono">{m.rfqNumber}</span>}
        {m.description && <div className="text-meta">{m.description}</div>}
        {m.unusable && <div><Badge tone="danger">Can&rsquo;t be counted</Badge></div>}
      </div>
    ),
  },
  {
    key: 'supplier', header: 'Quote', render: (m) => (
      <div>
        <span>{m.supplier}</span>
        {m.recommendedSupplier && m.recommended && <Badge tone="success" className="ml-2">Recommended</Badge>}
        {!m.recommended && <div className="text-meta">Procurement recommends {m.recommendedSupplier?.name ?? 'another supplier'}</div>}
        {m.currency !== 'ZAR' && <div className="text-meta">{formatMoney(m.quoteTotal, m.currency)}, in rand at the exchange rate</div>}
        {m.unpricedLines > 0 && <div className="text-meta text-warning-700">{m.unpricedLines} line{m.unpricedLines === 1 ? '' : 's'} not priced</div>}
      </div>
    ),
  },
  { key: 'amount', header: 'Excl. VAT', align: 'right', width: '10rem', className: 'text-num', render: (m) => <span className="font-mono">{formatMoney(m.amount)}</span> },
];

function History({ entries, loading }: { entries: HistoryEntry[]; loading: boolean }) {
  if (loading) return <div className="surface-card p-4"><Skeleton h={120} /></div>;
  if (entries.length === 0) return <EmptyState title="No activity recorded" description="What happens to the Sales RFQ appears here." />;
  return (
    <ol className="surface-card divide-y divide-surface-200">
      {entries.map((e) => (
        <li key={e.id} className="px-4 py-3 flex items-start gap-3">
          <span className="mt-0.5 text-brand-500" aria-hidden="true"><Icon.Activity /></span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-surface-900">{describeSalesEntry(e)}</div>
            <div className="text-xs text-surface-500">{formatDateTime(e.createdAt)} · {e.actorName ?? (e.actorId ? 'A removed user' : 'System')}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

const FIELD_WORDS: Record<string, string> = {
  equipmentLines: 'equipment lines', markupPercent: 'markup', deliveryPrice: 'delivery price',
  clientName: 'client', clientAddress: 'client address', contactName: 'contact', clientReference: 'client reference',
  paymentTerms: 'conditions', validity: 'conditions', deliveryDuration: 'conditions', deliveryTerms: 'conditions',
  signerPhone: 'signer', signerEmail: 'signer', closingDate: 'price due date', description: 'description', notes: 'remarks',
  quoteNotes: 'notes on the quotation',
};

/** One Activity entry in plain words. */
function describeSalesEntry(e: Pick<HistoryEntry, 'action' | 'before' | 'after'>): string {
  const after = (e.after ?? {}) as Record<string, unknown>;
  if (e.action === 'CREATE') return `Sales RFQ raised as ${String(after.number ?? 'a draft')}`;
  if (e.action === 'SALES_RFQ_SUBMIT') return `Submitted for approval${after.totalExVat ? ` at ${formatMoney(String(after.totalExVat))} excl. VAT` : ''}`;
  if (e.action === 'SALES_RFQ_RETURN') return `Sent back: ${String(after.reason ?? '')}`;
  if (e.action === 'SALES_RFQ_APPROVE') return `Approved as quotation ${String(after.quoteReference ?? '')}`;
  if (e.action === 'RFQ_CANCEL') return `Cancelled: ${String(after.reason ?? '')}`;
  if (e.action === 'UPDATE') {
    const parts: string[] = [];
    if ('number' in after) parts.push(`renumbered ${String(after.number)}`);
    if ('projectNumber' in after) parts.push(`moved to project ${String(after.projectNumber)}`);
    if ('markupPercent' in after) parts.push(after.markupPercent === null ? 'markup cleared' : `markup set to ${String(after.markupPercent)}%`);
    const others = [...new Set(Object.keys(after).filter((k) => !['number', 'projectNumber', 'markupPercent'].includes(k)).map((k) => FIELD_WORDS[k] ?? 'details'))];
    if (others.length) parts.push(`${others.join(', ')} changed`);
    return parts.length ? `${parts[0]!.charAt(0).toUpperCase()}${parts.join('; ').slice(1)}` : 'Details updated';
  }
  return e.action;
}

function ConfirmDialog({ title, description, confirm, onClose, onConfirm }: { title: string; description: string; confirm: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open onClose={onClose} size="md" title={title} description={description}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Not yet</Button>
          <Button variant="primary" loading={busy} onClick={() => { setBusy(true); onConfirm().catch(() => setBusy(false)); }}>{confirm}</Button>
        </>
      )}
    >{null}</Modal>
  );
}

function ReasonDialog({ title, description, label, confirm, placeholder, danger, onClose, onConfirm }: {
  title: string; description: string; label: string; confirm: string; placeholder: string; danger?: boolean;
  onClose: () => void; onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open onClose={onClose} size="md" title={title} description={description}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Keep it</Button>
          <Button variant={danger ? 'danger' : 'primary'} disabled={!reason.trim()} loading={busy} onClick={() => { setBusy(true); onConfirm(reason.trim()).catch(() => setBusy(false)); }}>{confirm}</Button>
        </>
      )}
    >
      <Field label={label} htmlFor="srfq-reason" required>
        <Textarea id="srfq-reason" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} />
      </Field>
    </Modal>
  );
}
