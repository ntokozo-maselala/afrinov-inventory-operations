import { useMemo, useState, useRef, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { FilterBar, SearchField, FILTER_WIDTH } from '../components/FilterBar';
import { Button } from '../components/Button';
import { Field, Select } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Drawer } from '../components/Modal';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { RoleGuard } from '../components/RoleGuard';
import { formatNumber } from '../lib/format';
import { formatCurrency } from '../lib/currency';
import { MaterialForm } from '../components/MaterialForm';
import { useCanManageMaterials } from '../hooks/usePermissions';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { CATEGORIES, categoryLabel } from '../lib/categories';
import type { Material } from '../api/types';

const hasPrice = (m: Material) => m.unitCost !== null && m.unitCost !== undefined && m.unitCost !== '';

// Which items to show. Read from ?view= so other pages can link straight to,
// say, the active items still without a price.
const VIEWS: Array<{ value: string; label: string; match: (m: Material) => boolean }> = [
  { value: '', label: 'All items', match: () => true },
  { value: 'active', label: 'Active', match: (m) => m.active },
  { value: 'inactive', label: 'Inactive', match: (m) => !m.active },
  { value: 'no-price', label: 'No unit price', match: (m) => m.active && !hasPrice(m) },
  { value: 'no-required', label: 'No Required Stock', match: (m) => m.active && !(Number(m.requiredStock) > 0) },
];

export function Materials() {
  const mats = useApi<Material[]>('/materials');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [params, setParams] = useSearchParams();
  const view = VIEWS.find((v) => v.value === (params.get('view') ?? '')) ?? VIEWS[0]!;
  const setView = (value: string) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (value) next.set('view', value); else next.delete('view');
    return next;
  }, { replace: true });
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const canManage = useCanManageMaterials();
  const searchRef = useRef<HTMLInputElement>(null);

  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
  }, []);

  useKeyboardShortcut([
    { key: '/', callback: focusSearch, description: 'Focus search' },
  ]);

  const filtered = useMemo(() => {
    if (!mats.data) return [];
    const needle = q.trim().toLowerCase();
    return mats.data.filter((m) => {
      if (!view.match(m)) return false;
      if (category && m.category !== category) return false;
      if (needle) {
        const hay = `${m.sku} ${m.name} ${m.serialNumber ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [mats.data, q, category, view]);
  const filtering = !!(q || category || view.value);

  return (
    <div>
      <PageHeader
        title="Materials"
        description="Catalogue of stockable items. Each material has a category, unit of measure, and reorder threshold."
        actions={
          <RoleGuard permission="materials:manage">
            <Button variant="primary" size="sm" leadingIcon={<Icon.Plus size={14} />} onClick={() => setAdding(true)}>Add item</Button>
          </RoleGuard>
        }
      />

      <FilterBar
        onClear={filtering ? () => { setQ(''); setCategory(''); setView(''); } : undefined}
        count={mats.loading ? 'Loading…' : `${filtered.length} of ${mats.data?.length ?? 0}`}
      >
        <SearchField id="materials-search" inputRef={searchRef} value={q} onChange={setQ} placeholder="SKU, name or serial number…" />
        <Field label="Show" htmlFor="materials-view" className={FILTER_WIDTH}>
          <Select id="materials-view" value={view.value} onChange={(e) => setView(e.target.value)}>
            {VIEWS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Category" htmlFor="materials-category" className={FILTER_WIDTH}>
          <Select id="materials-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
      </FilterBar>

      {mats.error && <ErrorState message={mats.error.message} onRetry={mats.reload} />}

      {!mats.error && (
        <DataTable
          ariaLabel="Materials"
          isLoading={mats.loading}
          rowKey={(m) => m.id}
          rows={filtered}
          columns={columns()}
          emptyState={<EmptyState title={filtering ? 'No materials match' : 'No materials yet'} description={filtering ? 'Try clearing filters.' : 'Add materials to start tracking inventory.'} action={!filtering && canManage ? <Button variant="primary" onClick={() => setAdding(true)}>Add your first item</Button> : undefined} />}
        />
      )}

      {adding && canManage && (
        <Drawer open onClose={() => setAdding(false)} title="Add item" description="Add a new item to the catalogue. The SKU must be unique. Receive stock records the quantity." width="md">
          <MaterialForm
            onCancel={() => setAdding(false)}
            onSaved={(m) => { setAdding(false); mats.reload(); toast.success(`${m.sku} added`); }}
            onError={(err) => toast.error('Could not add item', err.message)}
          />
        </Drawer>
      )}
    </div>
  );
}

function columns(): DataTableColumn<Material>[] {
  return [
    { key: 'sku', header: 'SKU', className: 'text-mono', render: (m) => <Link to={`/materials/${m.id}`} className="btn-link text-mono">{m.sku}</Link>, width: '12rem' },
    {
      key: 'name',
      header: 'Name',
      render: (m) => (
        <div>
          <span className="line-clamp-1" title={m.name}>{m.name}</span>
          {m.serialNumber && <span className="text-xs text-surface-500 font-mono">S/N {m.serialNumber}</span>}
        </div>
      ),
    },
    { key: 'cat', header: 'Category', render: (m) => <span className="text-meta">{categoryLabel(m.category)}</span> },
    { key: 'uom', header: 'UoM', render: (m) => m.unitOfMeasure, width: '5rem' },
    { key: 'reorder', header: 'Reorder', align: 'right', className: 'text-num', render: (m) => <span className="font-mono">{formatNumber(Number(m.requiredStock))}</span>, width: '6rem' },
    { key: 'cost', header: 'Unit cost', align: 'right', className: 'text-num', render: (m) => (hasPrice(m) ? <span className="font-mono">{formatCurrency(Number(m.unitCost), 'ZAR')}</span> : <span className="text-surface-400" title="No unit price">—</span>), width: '8rem' },
    { key: 'status', header: 'Status', render: (m) => m.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Inactive</Badge>, width: '7rem' },
  ];
}