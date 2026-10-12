// The "Other activity" view on Movements: stock counts, catalogue and
// master-data changes, users, settings and imports (GET /activity), for a date
// range (today unless chosen), by type and by person, a page at a time. Uses
// the same from/to in the address as the stock movements view.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { Toolbar } from './Toolbar';
import { Input, Select } from './Field';
import { Button } from './Button';
import { DataTable, type DataTableColumn } from './DataTable';
import { EmptyState, ErrorState } from './EmptyState';
import { useToast } from './Toast';
import { formatDateTime } from '../lib/format';
import { today } from '../lib/dates';
import { api, type ApiError } from '../api/client';
import type { ActivityRow } from '../api/types';

const PAGE = 50;

export const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  StockCount: 'Stock count',
  Material: 'Item',
  Location: 'Location',
  Rack: 'Rack',
  Project: 'Project',
  Recipient: 'Recipient',
  Supplier: 'Supplier',
  User: 'User',
  Setting: 'Setting',
  WorkbookImport: 'Import',
};

export function OtherActivity() {
  const [params, setParams] = useSearchParams();
  const from = params.get('from') ?? today();
  const to = params.get('to') ?? today();
  const badRange = from > to;
  const query = useMemo(() => {
    const p = new URLSearchParams({ from, to });
    for (const k of ['entityType', 'actorId']) { const v = params.get(k); if (v) p.set(k, v); }
    return p.toString();
  }, [from, to, params]);

  const first = useApi<ActivityRow[]>(badRange ? null : `/activity?${query}&limit=${PAGE}`);
  const actors = useApi<Array<{ id: string; name: string }>>('/activity/actors');
  const [more, setMore] = useState<{ query: string; rows: ActivityRow[]; done: boolean }>({ query: '', rows: [], done: false });
  const [loadingMore, setLoadingMore] = useState(false);
  const extra = more.query === query ? more : { query, rows: [], done: false };
  const rows = useMemo(() => [...(first.data ?? []), ...extra.rows], [first.data, extra.rows]);
  const hasMore = !!first.data && first.data.length === PAGE && !extra.done;
  const toast = useToast();

  function setParam(key: string, value: string) {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });
  }

  async function loadMore() {
    const last = rows[rows.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const page = await api.get<ActivityRow[]>(`/activity?${query}&limit=${PAGE}&before=${encodeURIComponent(last.cursor)}`);
      setMore({ query, rows: [...extra.rows, ...page], done: page.length < PAGE });
    } catch (err) {
      toast.error("Couldn't load more activity", (err as ApiError).message);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <Toolbar
        left={(
          <>
            <Input type="date" className="sm:w-40" value={from} max={to} onChange={(e) => setParam('from', e.target.value)} aria-label="From" invalid={badRange} />
            <span className="text-meta">to</span>
            <Input type="date" className="sm:w-40" value={to} min={from} onChange={(e) => setParam('to', e.target.value)} aria-label="To" invalid={badRange} />
            <Select value={params.get('entityType') ?? ''} onChange={(e) => setParam('entityType', e.target.value)} aria-label="Filter by kind of activity">
              <option value="">All activity</option>
              {Object.entries(ACTIVITY_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <Select value={params.get('actorId') ?? ''} onChange={(e) => setParam('actorId', e.target.value)} aria-label="Filter by who did it">
              <option value="">Everyone</option>
              {(actors.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </>
        )}
        right={<span className="text-meta">{first.loading ? 'Loading…' : first.data ? `${rows.length}${hasMore ? '+' : ''} entries` : ''}</span>}
      />

      {badRange && <ErrorState message="The start date is after the end date." />}
      {!badRange && first.error && <ErrorState message={first.error.message} onRetry={first.reload} />}
      {!badRange && !first.error && (
        <>
          <DataTable
            ariaLabel="Other activity"
            isLoading={first.loading}
            rowKey={(r) => r.id}
            rows={rows}
            columns={COLUMNS}
            emptyState={<EmptyState title="No activity" description="Nothing besides stock movements was recorded for these dates and filters." />}
          />
          {hasMore && (
            <div className="flex justify-center mt-3">
              <Button variant="secondary" onClick={loadMore} loading={loadingMore}>Load more</Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

const COLUMNS: DataTableColumn<ActivityRow>[] = [
  { key: 'when', header: 'When', render: (r) => <span className="text-meta whitespace-nowrap">{formatDateTime(r.at)}</span>, width: '11rem' },
  { key: 'kind', header: 'Kind', render: (r) => <span className="text-meta">{ACTIVITY_TYPE_LABEL[r.entityType] ?? r.entityType}</span>, width: '8rem' },
  { key: 'what', header: 'What happened', render: (r) => (r.link ? <Link to={r.link} className="btn-link text-left">{r.summary}</Link> : r.summary) },
  { key: 'by', header: 'By', render: (r) => <span className="text-meta">{r.actorName}</span>, width: '10rem' },
];
