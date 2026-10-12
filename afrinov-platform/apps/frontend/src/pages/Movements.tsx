// Movements: the stock ledger for a date range (today unless chosen), filtered
// on the server by type, item, location, who posted it and a search, and loaded
// a page at a time so a long range is never cut short. Admin and Store
// Controller also get an "Other activity" view (counts, catalogue and user
// changes). The view and filters live in the address, so a filtered
// view can be bookmarked or shared.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { useDebounced } from '../hooks/useDebounced';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Input, Select } from '../components/Field';
import { Button } from '../components/Button';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { MovementBadge } from '../components/Badge';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { Drawer } from '../components/Modal';
import { useToast } from '../components/Toast';
import { SearchSelect, type SearchOption } from '../components/SearchSelect';
import { formatDateTime, formatNumber } from '../lib/format';
import { TransactionDrawer } from '../components/TransactionDrawer';
import { api, type ApiError } from '../api/client';
import { downloadMovements } from '../api/exportMovements';
import type { Material, MovementRow } from '../api/types';
import { useCanViewActivity } from '../hooks/usePermissions';
import { OtherActivity } from '../components/OtherActivity';
import { today } from '../lib/dates';

const PAGE = 100;

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'RECEIPT', label: 'Receipt' },
  { value: 'ISSUE', label: 'Issue' },
  { value: 'TRANSFER_OUT', label: 'Transfer out' },
  { value: 'TRANSFER_IN', label: 'Transfer in' },
  { value: 'ADJUSTMENT', label: 'Adjustment' },
  { value: 'RETURN', label: 'Return' },
];

const FILTER_KEYS = ['type', 'materialId', 'locationId', 'actorId', 'q'] as const;

interface Summary { total: number; byType: Record<string, number> }
interface Option { id: string; name: string }

export function Movements() {
  const [params, setParams] = useSearchParams();
  const canViewActivity = useCanViewActivity();
  const view = canViewActivity && params.get('view') === 'other' ? 'other' : 'stock';
  const stockView = view === 'stock';
  const day = useMemo(() => today(), []);
  const from = params.get('from') ?? day;
  const to = params.get('to') ?? day;
  const badRange = !!from && !!to && from > to;

  // The query every request shares: dates plus whichever filters are set.
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    for (const k of FILTER_KEYS) { const v = params.get(k); if (v) p.set(k, v); }
    return p.toString();
  }, [from, to, params]);

  const listing = stockView && !badRange;
  const summary = useApi<Summary>(listing ? `/inventory-transactions/summary?${query}` : null);
  const first = useApi<MovementRow[]>(listing ? `/inventory-transactions?${query}&limit=${PAGE}` : null);
  // Later pages, kept against the query they belong to so a new filter drops them.
  const [more, setMore] = useState<{ query: string; rows: MovementRow[]; done: boolean }>({ query: '', rows: [], done: false });
  const [loadingMore, setLoadingMore] = useState(false);
  const extra = more.query === query ? more : { query, rows: [], done: false };
  const rows = useMemo(() => [...(first.data ?? []), ...extra.rows], [first.data, extra.rows]);
  const hasMore = !!first.data && first.data.length === PAGE && !extra.done;

  const materials = useApi<Material[]>(stockView ? '/materials' : null);
  const locations = useApi<Option[]>(stockView ? '/locations' : null);
  const actors = useApi<Option[]>(stockView ? '/inventory-transactions/actors' : null);
  const itemOptions = useMemo<SearchOption[]>(() => (materials.data ?? [])
    .map((m) => ({ value: m.id, label: `${m.name} (${m.sku})` }))
    .sort((a, b) => a.label.localeCompare(b.label)), [materials.data]);

  const [search, setSearch] = useState(params.get('q') ?? '');
  const debouncedSearch = useDebounced(search, 300);
  const [selected, setSelected] = useState<MovementRow | null>(null);
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();

  function setParam(key: string, value: string) {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });
  }

  useEffect(() => {
    if (debouncedSearch.trim() !== (params.get('q') ?? '')) setParam('q', debouncedSearch.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  async function loadMore() {
    const last = rows[rows.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const page = await api.get<MovementRow[]>(`/inventory-transactions?${query}&limit=${PAGE}&before=${encodeURIComponent(last.cursor)}`);
      setMore({ query, rows: [...extra.rows, ...page], done: page.length < PAGE });
    } catch (err) {
      toast.error("Couldn't load more movements", (err as ApiError).message);
    } finally {
      setLoadingMore(false);
    }
  }

  /** Switch view, keeping only the date range. */
  function showView(next: 'stock' | 'other') {
    const keep = new URLSearchParams();
    if (params.get('from')) keep.set('from', params.get('from')!);
    if (params.get('to')) keep.set('to', params.get('to')!);
    if (next === 'other') keep.set('view', 'other');
    setSearch('');
    setParams(keep, { replace: true });
  }

  function reload() {
    setMore({ query: '', rows: [], done: false });
    first.reload();
    summary.reload();
  }

  async function download() {
    setDownloading(true);
    try {
      await downloadMovements(query);
    } catch (err) {
      toast.error('Download failed', (err as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  const filtersSet = FILTER_KEYS.some((k) => params.get(k)) || params.has('from') || params.has('to');

  return (
    <div>
      <PageHeader
        title="Movements"
        description="Full history of inventory transactions. The ledger is the source of truth — balances are derived from these rows."
        actions={stockView ? (
          <Button variant="secondary" size="sm" leadingIcon={<Icon.Download size={14} />} onClick={download} loading={downloading} disabled={badRange || !summary.data?.total}>
            Download as Excel
          </Button>
        ) : undefined}
      />

      {canViewActivity && (
        <div role="tablist" aria-label="What to show" className="flex gap-2 mb-4">
          <Button role="tab" aria-selected={stockView} size="sm" variant={stockView ? 'primary' : 'ghost'} onClick={() => showView('stock')}>Stock movements</Button>
          <Button role="tab" aria-selected={!stockView} size="sm" variant={stockView ? 'ghost' : 'primary'} onClick={() => showView('other')}>Other activity</Button>
        </div>
      )}

      {!stockView ? <OtherActivity /> : (
      <>
      <Toolbar
        left={(
          <>
            <Input type="date" className="sm:w-40" value={from} max={to || undefined} onChange={(e) => setParam('from', e.target.value)} aria-label="From" invalid={badRange} />
            <span className="text-meta">to</span>
            <Input type="date" className="sm:w-40" value={to} min={from || undefined} onChange={(e) => setParam('to', e.target.value)} aria-label="To" invalid={badRange} />
            <Select value={params.get('type') ?? ''} onChange={(e) => setParam('type', e.target.value)} aria-label="Filter by type">
              {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Select value={params.get('locationId') ?? ''} onChange={(e) => setParam('locationId', e.target.value)} aria-label="Filter by location">
              <option value="">All locations</option>
              {(locations.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Select value={params.get('actorId') ?? ''} onChange={(e) => setParam('actorId', e.target.value)} aria-label="Filter by who posted it">
              <option value="">Everyone</option>
              {(actors.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
            <div className="w-full sm:w-64">
              <SearchSelect
                id="movements-item"
                value={params.get('materialId') ?? ''}
                onChange={(v) => setParam('materialId', v)}
                options={itemOptions}
                placeholder="All items"
                noMatchText="No item matches"
              />
            </div>
            <div className="relative w-full sm:w-64">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input className="pl-8" placeholder="Search item, location, project, recipient…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search movements" />
            </div>
            {filtersSet && <Button variant="ghost" size="sm" onClick={() => showView('stock')}>Reset</Button>}
          </>
        )}
        right={<span className="text-meta">{first.loading ? 'Loading…' : summary.data ? `${formatNumber(rows.length)} of ${formatNumber(summary.data.total)} shown` : ''}</span>}
      />

      {badRange && <ErrorState message="The start date is after the end date." />}
      {!badRange && first.error && <ErrorState message={first.error.message} onRetry={reload} />}

      {!badRange && !first.error && (
        <>
          <DataTable
            ariaLabel="Inventory movements"
            isLoading={first.loading}
            rowKey={(m) => m.id}
            rows={rows}
            columns={columns({ onSelect: (m) => setSelected(m) })}
            emptyState={<EmptyState title="No movements match" description="Nothing was recorded for these dates and filters. Try a wider date range or reset the filters." />}
          />
          {hasMore && (
            <div className="flex justify-center mt-3">
              <Button variant="secondary" onClick={loadMore} loading={loadingMore}>Load more</Button>
            </div>
          )}
        </>
      )}

      {selected && (
        <Drawer
          open
          onClose={() => setSelected(null)}
          title="Transaction detail"
          description={`${selected.materialSku} — ${selected.materialName}`}
          width="md"
        >
          <TransactionDrawer
            transaction={selected}
            onClose={() => setSelected(null)}
            onReversed={() => {
              setSelected(null);
              reload();
              toast.success('Movement reversed');
            }}
            onReturned={() => {
              setSelected(null);
              reload();
              toast.success('Stock returned');
            }}
            onError={(err) => toast.error('Reversal failed', err.message)}
          />
        </Drawer>
      )}
      </>
      )}
    </div>
  );
}

function columns({ onSelect }: { onSelect: (m: MovementRow) => void }): DataTableColumn<MovementRow>[] {
  return [
    { key: 'when', header: 'When', render: (m) => <button className="text-left btn-link text-meta whitespace-nowrap" onClick={() => onSelect(m)}>{formatDateTime(m.postedAt)}</button>, width: '11rem' },
    { key: 'type', header: 'Type', render: (m) => <MovementBadge type={m.type} />, width: '8rem' },
    { key: 'mat', header: 'Material', render: (m) => <><Link to={`/materials/${m.materialId}`} className="btn-link text-mono text-xs">{m.materialSku}</Link> <span className="text-surface-700">{m.materialName}</span></> },
    { key: 'loc', header: 'Location', render: (m) => m.locationName, width: '10rem' },
    { key: 'qty', header: 'Quantity', align: 'right', className: 'text-num', render: (m) => <span className={`font-mono ${Number(m.quantity) >= 0 ? 'text-success-700' : 'text-danger-700'}`}>{m.quantity}</span>, width: '8rem' },
    { key: 'reason', header: 'Reason', render: (m) => m.reasonCode ? <span className="text-meta">{m.reasonCode.replace('_', ' ').toLowerCase()}</span> : <span className="text-surface-300">—</span>, width: '8rem' },
    { key: 'to', header: 'Issued to', render: (m) => m.recipientName ? <span className="text-meta">{m.recipientName}</span> : <span className="text-surface-300">—</span>, width: '9rem' },
    { key: 'proj', header: 'Project', render: (m) => m.projectNumber ? <span className="text-mono text-xs">{m.projectNumber}</span> : <span className="text-surface-300">—</span>, width: '8rem' },
    { key: 'ref', header: 'Reference', render: (m) => m.referenceType ? <span className="text-meta">{m.referenceType}</span> : <span className="text-surface-300">—</span> },
    { key: 'actor', header: 'By', render: (m) => <span className="text-meta">{m.actorName}</span>, width: '8rem' },
  ];
}
