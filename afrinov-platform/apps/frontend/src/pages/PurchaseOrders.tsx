import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Button } from '../components/Button';
import { Input, Select } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { PurchaseOrderStatusBadge } from '../components/Badge';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { formatDate, formatNumber } from '../lib/format';
import { useCanManageProcurement } from '../hooks/usePermissions';
import { formatMoney, type PoTotals } from '../lib/poMoney';
import { useAuth } from '../auth';
import { revisionLabel } from '../lib/poDocument';

interface PO {
  id: string; number: string; revision?: number; status: string;
  supplier: { name: string };
  projectNumber?: string | null;
  createdAt: string;
  currency?: string;
  totals?: PoTotals;
  lines: Array<{ id: string; material: { sku: string; name: string }; orderedQty: string; receivedQty: string }>;
}

/** Orders a buyer still has to finish or chase: the default view for Procurement. */
const OPEN_WORK = 'DRAFT,PENDING_APPROVAL';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: OPEN_WORK, label: 'Draft & pending approval' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'PARTIALLY_RECEIVED', label: 'Partly received' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function PurchaseOrders() {
  const pos = useApi<PO[]>('/purchase-orders');
  const { user } = useAuth();
  const [q, setQ] = useState('');
  // The filters live in the URL (?status=, ?project=) so a view can be linked
  // to and survives Back from an order.
  const [params, setParams] = useSearchParams();
  const roles = (user?.roles ?? []).map((r) => r.toUpperCase());
  const project = params.get('project') ?? '';
  // Buyers land on their drafts and orders awaiting approval; everyone else,
  // and a link to one project's orders, on all statuses.
  const buyer = roles.includes('PROCUREMENT') && !roles.includes('ADMIN');
  const defaultStatus = buyer && !project ? OPEN_WORK : '';
  const rawStatus = params.get('status');
  const status = rawStatus === null ? defaultStatus : rawStatus === 'all' ? '' : rawStatus;
  const statuses = status ? status.split(',') : [];
  const setParam = (key: string, v: string | null) => setParams((p) => { if (v === null) p.delete(key); else p.set(key, v); return p; }, { replace: true });
  const setStatus = (v: string) => setParam('status', v === defaultStatus ? null : v || 'all');
  const setProject = (v: string) => setParam('project', v || null);
  const canManage = useCanManageProcurement();
  const projectOptions = [...new Set((pos.data ?? []).map((p) => p.projectNumber).filter((n): n is string => !!n)), ...(project ? [project] : [])]
    .filter((n, i, all) => all.indexOf(n) === i).sort();
  // A link may name a combination the list doesn't offer; show it rather than a blank select.
  const statusOptions = status && !STATUS_OPTIONS.some((o) => o.value === status)
    ? [...STATUS_OPTIONS, { value: status, label: statuses.map((s) => STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s).join(' & ') }]
    : STATUS_OPTIONS;

  const needle = q.trim().toLowerCase();
  const filtered = (pos.data ?? []).filter((p) => {
    if (statuses.length > 0 && !statuses.includes(p.status)) return false;
    if (project && p.projectNumber !== project) return false;
    if (needle) {
      const hay = `${p.number} ${p.supplier?.name ?? ''} ${p.projectNumber ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        description="The full procurement workflow — from draft through to receipt."
        actions={canManage
          ? <Link to="/purchase-orders/new" className="btn-primary"><Icon.Plus />New purchase order</Link>
          : undefined}
      />

      <Toolbar
        left={(
          <>
            <div className="relative w-full sm:w-64">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input className="pl-8" placeholder="Search PO, supplier or project…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search purchase orders" />
            </div>
            <Select className="sm:w-56" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Select className="sm:w-48" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter by project">
              <option value="">All projects</option>
              {projectOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
            {(q || status || project) && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setParams((p) => { p.delete('project'); if (buyer) p.set('status', 'all'); else p.delete('status'); return p; }, { replace: true }); }}>Clear</Button>}
          </>
        )}
        right={<span className="text-meta">{pos.loading ? 'Loading…' : `${filtered.length} of ${pos.data?.length ?? 0}`}</span>}
      />

      {pos.error && <ErrorState message={pos.error.message} onRetry={pos.reload} />}

      {!pos.error && (
        <DataTable
          ariaLabel="Purchase orders"
          isLoading={pos.loading}
          rowKey={(p) => p.id}
          rows={filtered}
          columns={columns()}
          emptyState={(pos.data?.length ?? 0) > 0 || q || project ? (
            <EmptyState
              title={status === OPEN_WORK && !q && !project ? 'No drafts or orders awaiting approval' : 'No POs match your filters'}
              description="Try another status, or clear the filters."
            />
          ) : (
            <EmptyState
              title="No purchase orders yet"
              description="Create a PO to start the procurement workflow."
              action={canManage ? <Link to="/purchase-orders/new" className="btn-primary">Create your first PO</Link> : undefined}
            />
          )}
        />
      )}
    </div>
  );
}

function columns(): DataTableColumn<PO>[] {
  return [
    {
      key: 'num', header: 'PO', width: '10rem',
      render: (p) => (
        <span className="whitespace-nowrap">
          <Link to={`/purchase-orders/${p.id}`} className="btn-link text-mono">{p.number}</Link>
          {!!p.revision && <span className="text-meta ml-1">{revisionLabel(p.revision)}</span>}
        </span>
      ),
    },
    {
      key: 'sup', header: 'Supplier', render: (p) => (
        <div>
          {p.supplier?.name ?? '—'}
          {p.projectNumber && <div className="text-meta">Project {p.projectNumber}</div>}
        </div>
      ),
    },
    { key: 'created', header: 'Created', render: (p) => <span className="text-meta">{formatDate(p.createdAt)}</span>, width: '9rem' },
    { key: 'lines', header: 'Lines', align: 'right', render: (p) => formatNumber(p.lines.length), width: '5rem' },
    { key: 'units', header: 'Units', align: 'right', className: 'text-num', render: (p) => <span className="font-mono">{formatNumber(p.lines.reduce((a, l) => a + Number(l.orderedQty), 0))}</span>, width: '6rem' },
    {
      key: 'total', header: 'Total', align: 'right', className: 'text-num', width: '10rem',
      render: (p) => {
        if (!p.totals) return <span className="text-surface-300">—</span>;
        if (p.totals.unpricedLines === p.lines.length) return <span className="text-meta">No prices</span>;
        return (
          <span className="whitespace-nowrap">
            <span className="font-mono">{formatMoney(p.totals.net, p.currency)}</span>
            {p.totals.unpricedLines > 0 && <span className="block text-meta text-warning-700">{p.totals.unpricedLines} unpriced</span>}
          </span>
        );
      },
    },
    { key: 'status', header: 'Status', render: (p) => <PurchaseOrderStatusBadge status={p.status} />, width: '11rem' },
  ];
}
