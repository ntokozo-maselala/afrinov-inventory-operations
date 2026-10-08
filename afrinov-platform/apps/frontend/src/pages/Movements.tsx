import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
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
import { formatDateTime, formatNumber } from '../lib/format';
import { TransactionDrawer } from '../components/TransactionDrawer';

interface MovementRow {
  id: string; postedAt: string; type: string;
  materialId: string; materialSku: string; materialName: string;
  locationId: string; locationName: string;
  quantity: string; actorId: string; actorName: string;
  projectNumber?: string | null; reasonCode?: string | null; reasonNote?: string | null;
  referenceType?: string | null; referenceId?: string | null;
  reversesId?: string | null; reversedById?: string | null;
}

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'RECEIPT', label: 'Receipt' },
  { value: 'ISSUE', label: 'Issue' },
  { value: 'TRANSFER_OUT', label: 'Transfer out' },
  { value: 'TRANSFER_IN', label: 'Transfer in' },
  { value: 'ADJUSTMENT', label: 'Adjustment' },
];

export function Movements() {
  const moves = useApi<MovementRow[]>('/inventory-transactions?limit=500');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [selected, setSelected] = useState<MovementRow | null>(null);
  const toast = useToast();

  const filtered = useMemo(() => {
    if (!moves.data) return [];
    const needle = q.trim().toLowerCase();
    return moves.data.filter((m) => {
      if (type && m.type !== type) return false;
      if (needle) {
        const hay = `${m.materialSku} ${m.materialName} ${m.locationName} ${m.projectNumber ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [moves.data, q, type]);

  const totalIn = filtered.filter((m) => Number(m.quantity) > 0).reduce((acc, m) => acc + Number(m.quantity), 0);
  const totalOut = filtered.filter((m) => Number(m.quantity) < 0).reduce((acc, m) => acc + Math.abs(Number(m.quantity)), 0);
  const activeFilters = (type ? 1 : 0) + (q ? 1 : 0);

  return (
    <div>
      <PageHeader
        title="Movements"
        description="Full history of inventory transactions. The ledger is the source of truth — balances are derived from these rows."
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="surface-card p-3">
          <div className="text-eyebrow">Total entries</div>
          <div className="text-2xl font-semibold text-num">{formatNumber(filtered.length)}</div>
        </div>
        <div className="surface-card p-3">
          <div className="text-eyebrow">Stock in</div>
          <div className="text-2xl font-semibold text-num text-success-700">+{formatNumber(totalIn)}</div>
        </div>
        <div className="surface-card p-3">
          <div className="text-eyebrow">Stock out</div>
          <div className="text-2xl font-semibold text-num text-danger-700">−{formatNumber(totalOut)}</div>
        </div>
        <div className="surface-card p-3">
          <div className="text-eyebrow">Net change</div>
          <div className={`text-2xl font-semibold text-num ${totalIn - totalOut >= 0 ? 'text-success-700' : 'text-danger-700'}`}>{totalIn - totalOut >= 0 ? '+' : ''}{formatNumber(totalIn - totalOut)}</div>
        </div>
      </div>

      <Toolbar
        left={(
          <>
            <div className="relative w-full sm:w-64">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input className="pl-8" placeholder="Search SKU, material, project…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search movements" />
            </div>
            <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
              {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            {(q || type) && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setType(''); }}>Clear</Button>}
          </>
        )}
        right={<span className="text-meta">{moves.loading ? 'Loading…' : `${filtered.length} movements`}</span>}
      />

      {moves.error && <ErrorState message={moves.error.message} onRetry={moves.reload} />}

      {!moves.error && (
        <DataTable
          ariaLabel="Inventory movements"
          isLoading={moves.loading}
          rowKey={(m) => m.id}
          rows={filtered}
          columns={columns({ onSelect: (m) => setSelected(m) })}
          emptyState={<EmptyState title={activeFilters ? 'No movements match your filters' : 'No movements yet'} description={activeFilters ? 'Try clearing your filters.' : 'Receipts, issues, transfers and adjustments will appear here.'} />}
        />
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
              moves.reload();
              toast.success('Movement reversed');
            }}
            onError={(err) => toast.error('Reversal failed', err.message)}
          />
        </Drawer>
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
    { key: 'proj', header: 'Project', render: (m) => m.projectNumber ? <span className="text-mono text-xs">{m.projectNumber}</span> : <span className="text-surface-300">—</span>, width: '8rem' },
    { key: 'ref', header: 'Reference', render: (m) => m.referenceType ? <span className="text-meta">{m.referenceType}</span> : <span className="text-surface-300">—</span> },
    { key: 'actor', header: 'By', render: (m) => <span className="text-meta">{m.actorName}</span>, width: '8rem' },
  ];
}