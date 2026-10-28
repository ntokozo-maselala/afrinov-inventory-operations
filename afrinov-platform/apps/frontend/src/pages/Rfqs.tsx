// Requests for quotation (RFQ roadmap, Phase 2.1): every RFQ with its project,
// the suppliers asked, how many have answered, and when it closes. Buyers
// land on the ones still in hand, drafts and those sent; the filters live in
// the URL, as on Purchase orders, so Back from an RFQ keeps them.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Button } from '../components/Button';
import { Input, Select } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { RfqStatusBadge } from '../components/Badge';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { useCanManageProcurement } from '../hooks/usePermissions';
import { formatDay, quotesIn, type Rfq } from '../lib/rfq';

/** RFQs a buyer still has to send or chase: the default view. */
const IN_HAND = 'DRAFT,SENT';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: IN_HAND, label: 'Draft & sent' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SENT', label: 'Sent' },
  { value: 'AWARDED', label: 'Awarded' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export function Rfqs() {
  const canManage = useCanManageProcurement();
  const rfqs = useApi<Rfq[]>('/rfqs');
  const [q, setQ] = useState('');
  const [params, setParams] = useSearchParams();
  const project = params.get('project') ?? '';
  const rawStatus = params.get('status');
  // A link to one project's RFQs shows them all, whatever their status.
  const defaultStatus = project ? '' : IN_HAND;
  const status = rawStatus === null ? defaultStatus : rawStatus === 'all' ? '' : rawStatus;
  const statuses = status ? status.split(',') : [];
  const setParam = (key: string, v: string | null) => setParams((p) => { if (v === null) p.delete(key); else p.set(key, v); return p; }, { replace: true });
  const projectOptions = [...new Set([...(rfqs.data ?? []).map((r) => r.projectNumber).filter((n): n is string => !!n), ...(project ? [project] : [])])].sort();

  const needle = q.trim().toLowerCase();
  const filtered = (rfqs.data ?? []).filter((r) => {
    if (statuses.length > 0 && !statuses.includes(r.status)) return false;
    if (project && r.projectNumber !== project) return false;
    if (needle) {
      const hay = `${r.number} ${r.projectNumber ?? ''} ${r.description ?? ''} ${r.suppliers.map((s) => s.supplier?.name ?? '').join(' ')}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  return (
    <div>
      <PageHeader
        title="Requests for quotation"
        description="Ask suppliers to price what you need, as on the RFQ sheet, before raising the order."
        actions={canManage ? <Link to="/rfqs/new" className="btn-primary"><Icon.Plus size={14} /> New RFQ</Link> : undefined}
      />

      <Toolbar
        left={(
          <>
            <div className="relative w-full sm:w-64">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input className="pl-8" placeholder="Search RFQ, project or supplier…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search requests for quotation" />
            </div>
            <Select className="sm:w-48" value={status} onChange={(e) => setParam('status', e.target.value === defaultStatus ? null : e.target.value || 'all')} aria-label="Filter by status">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Select className="sm:w-48" value={project} onChange={(e) => setParam('project', e.target.value || null)} aria-label="Filter by project">
              <option value="">All projects</option>
              {projectOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
            {(q || rawStatus !== null || project) && (
              <Button variant="ghost" size="sm" onClick={() => { setQ(''); setParams((p) => { p.delete('project'); p.delete('status'); return p; }, { replace: true }); }}>Clear</Button>
            )}
          </>
        )}
        right={<span className="text-meta">{rfqs.loading ? 'Loading…' : `${filtered.length} of ${rfqs.data?.length ?? 0}`}</span>}
      />

      {rfqs.error && <ErrorState message={rfqs.error.message} onRetry={rfqs.reload} />}

      {!rfqs.error && (
        <DataTable
          ariaLabel="Requests for quotation"
          isLoading={rfqs.loading}
          rowKey={(r) => r.id}
          rows={filtered}
          columns={COLUMNS}
          emptyState={(rfqs.data?.length ?? 0) > 0 || q || project ? (
            <EmptyState
              title={status === IN_HAND && !q && !project ? 'No drafts or RFQs out with suppliers' : 'No RFQs match your filters'}
              description="Try another status, or clear the filters."
            />
          ) : (
            <EmptyState
              title="No requests for quotation yet"
              description="Raise an RFQ to ask suppliers for prices before ordering."
              action={canManage ? <Link to="/rfqs/new" className="btn-primary">Raise your first RFQ</Link> : undefined}
            />
          )}
        />
      )}
    </div>
  );
}

const COLUMNS: DataTableColumn<Rfq>[] = [
  {
    key: 'num', header: 'RFQ', width: '13rem',
    render: (r) => <Link to={`/rfqs/${r.id}`} className="btn-link text-mono whitespace-nowrap">{r.number}</Link>,
  },
  {
    key: 'desc', header: 'Description', render: (r) => (
      <div className="min-w-0">
        <div className="truncate">{r.description ?? <span className="text-surface-400">—</span>}</div>
        <div className="text-meta">{r.projectNumber ? `Project ${r.projectNumber}` : 'Stores'} · {r.lines.length} line{r.lines.length === 1 ? '' : 's'}</div>
      </div>
    ),
  },
  {
    key: 'sup', header: 'Suppliers asked', render: (r) => (r.suppliers.length === 0
      ? <span className="text-meta">None yet</span>
      : <span className="text-sm">{r.suppliers.map((s) => s.supplier?.name ?? s.supplierId).join(', ')}</span>),
  },
  {
    key: 'quotes', header: 'Quotes in', align: 'right', width: '6rem',
    render: (r) => {
      if (r.status === 'DRAFT' || r.suppliers.length === 0) return <span className="text-surface-300">—</span>;
      const { answered, asked } = quotesIn(r);
      return <span className="font-mono">{answered} of {asked}</span>;
    },
  },
  { key: 'closing', header: 'Closing', width: '8rem', render: (r) => <span className="text-meta">{formatDay(r.closingDate)}</span> },
  { key: 'status', header: 'Status', width: '8rem', render: (r) => <RfqStatusBadge status={r.status} closed={r.closed} /> },
];
