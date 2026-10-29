// The "Other changes" report on Movements: catalogue and master-data changes,
// users and imports (GET /activity), each as a sentence linking to its record.
// Stock counts have their own report; settings changes stay in Settings.
import { Link } from 'react-router-dom';
import { usePagedList } from '../hooks/usePagedList';
import { Button } from './Button';
import { DataTable, type DataTableColumn } from './DataTable';
import { EmptyState, ErrorState } from './EmptyState';
import { StaleDataNotice } from './StaleDataNotice';
import { formatDateTime } from '../lib/format';
import type { ActivityRow } from '../api/types';

export const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  Material: 'Item',
  Location: 'Location',
  Rack: 'Rack',
  Project: 'Project',
  Recipient: 'Recipient',
  Supplier: 'Supplier',
  User: 'User',
  WorkbookImport: 'Import',
};

export function OtherActivity({ query }: { query: string }) {
  const list = usePagedList<ActivityRow>(`/activity?${query}`, 50);
  // A failed first-page refresh keeps its rows: show the stale warning beside
  // them rather than replacing them with a hard error.
  if (list.error && !list.stale) return <ErrorState error={list.error} onRetry={list.reload} />;
  return (
    <>
      {list.stale && <StaleDataNotice error={list.error} onRetry={list.reload} />}
      <p className="text-meta mb-2">{list.loaded ? `${list.rows.length}${list.hasMore ? '+' : ''} entries` : ' '}</p>
      <DataTable
        ariaLabel="Other changes"
        isLoading={list.loading}
        rowKey={(r) => r.id}
        rows={list.rows}
        columns={COLUMNS}
        emptyState={<EmptyState title="No changes" description="No item, location, rack, project, recipient, supplier or user was added or changed on these dates." />}
      />
      {list.hasMore && (
        <div className="flex justify-center mt-3 no-print">
          <Button variant="secondary" onClick={list.loadMore} loading={list.loadingMore}>Load more</Button>
        </div>
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
