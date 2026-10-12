// The issued-stock report: one block per issue slip, laid out like the Issue
// stock form (issued to, project, then the items), from GET /inventory-issues.
// A line opens its detail, to return unused stock or reverse a mistake.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePagedList } from '../../hooks/usePagedList';
import { Button } from '../Button';
import { Badge } from '../Badge';
import { EmptyState, ErrorState } from '../EmptyState';
import { Skeleton } from '../Skeleton';
import { Drawer } from '../Modal';
import { useToast } from '../Toast';
import { TransactionDrawer } from '../TransactionDrawer';
import { formatDateTime } from '../../lib/format';
import type { IssueSlip, MovementRow } from '../../api/types';

const typeLabel = (t: string | null) => (t ? t.charAt(0) + t.slice(1).toLowerCase() : '');

export function IssuedStockReport({ query }: { query: string }) {
  const list = usePagedList<IssueSlip>(`/inventory-issues?${query}`, 50);
  const [selected, setSelected] = useState<MovementRow | null>(null);
  const toast = useToast();

  if (list.error) return <ErrorState message={list.error.message} onRetry={list.reload} />;
  if (list.loading && !list.loaded) return <div className="space-y-3"><Skeleton h={110} /><Skeleton h={110} /></div>;
  if (list.rows.length === 0) return <EmptyState title="No stock issued" description="No stock was issued for these dates and filters." />;
  return (
    <div className="space-y-4">
      <p className="text-meta">
        {list.rows.length}{list.hasMore ? '+' : ''} issue{list.rows.length === 1 && !list.hasMore ? '' : 's'}.
        Issues recorded before slips were kept show one item each.
      </p>
      {list.rows.map((s) => (
        <section key={s.id} className="surface-card p-4 break-inside-avoid" aria-label={`Issue to ${s.recipientName ?? 'not recorded'}`}>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
            <div><dt className="text-eyebrow">Issued to</dt><dd className="font-medium">{s.recipientName ?? 'Not recorded'} {s.recipientType && <span className="text-meta">({typeLabel(s.recipientType)})</span>}</dd></div>
            <div><dt className="text-eyebrow">Project</dt><dd>{s.projectNumber ?? 'No project'}</dd></div>
            <div><dt className="text-eyebrow">Issued</dt><dd>{formatDateTime(s.issuedAt)}</dd></div>
            <div><dt className="text-eyebrow">Issued by</dt><dd>{s.issuedByName}</dd></div>
          </dl>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-eyebrow border-b border-surface-200">
                <th className="py-1.5 font-normal">Item</th>
                <th className="py-1.5 font-normal">From location</th>
                <th className="py-1.5 font-normal text-right">Issued</th>
                <th className="py-1.5 font-normal text-right">Returned</th>
                <th className="py-1.5 font-normal no-print" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l) => (
                <tr key={l.id} className="border-b border-surface-100 last:border-0">
                  <td className="py-1.5">
                    <Link to={`/materials/${l.materialId}`} className="btn-link text-mono text-xs">{l.materialSku}</Link> {l.materialName}
                    {l.reversedById && <> <Badge tone="neutral">Reversed</Badge></>}
                  </td>
                  <td className="py-1.5">{l.locationName}</td>
                  <td className="py-1.5 text-right font-mono">{String(Math.abs(Number(l.quantity)))} <span className="text-meta">{l.unitOfMeasure}</span></td>
                  <td className="py-1.5 text-right font-mono">{Number(l.returnedQuantity ?? 0) > 0 ? l.returnedQuantity : <span className="text-surface-300">—</span>}</td>
                  <td className="py-1.5 text-right no-print"><Button size="sm" variant="ghost" onClick={() => setSelected(l)}>Details</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {list.hasMore && (
        <div className="flex justify-center no-print">
          <Button variant="secondary" onClick={list.loadMore} loading={list.loadingMore}>Load more</Button>
        </div>
      )}
      {selected && (
        <Drawer open onClose={() => setSelected(null)} title="Transaction detail" description={`${selected.materialSku} — ${selected.materialName}`} width="md">
          <TransactionDrawer
            transaction={selected}
            onClose={() => setSelected(null)}
            onReversed={() => { setSelected(null); list.reload(); toast.success('Issue reversed'); }}
            onReturned={() => { setSelected(null); list.reload(); toast.success('Stock returned'); }}
            onError={(err) => toast.error('Could not change the issue', err.message)}
          />
        </Drawer>
      )}
    </div>
  );
}
