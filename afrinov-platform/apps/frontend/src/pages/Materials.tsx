import { useMemo, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Button } from '../components/Button';
import { Input, Select } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Drawer } from '../components/Modal';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { RoleGuard } from '../components/RoleGuard';
import { formatNumber } from '../lib/format';
import { MaterialForm } from '../components/MaterialForm';
import { useCanManageMaterials } from '../hooks/usePermissions';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { CATEGORIES, categoryLabel } from '../lib/categories';

interface Material {
  id: string; sku: string; name: string; category: string;
  unitOfMeasure: string; requiredStock: string; active: boolean;
}

export function Materials() {
  const mats = useApi<Material[]>('/materials');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
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
      if (category && m.category !== category) return false;
      if (needle) {
        const hay = `${m.sku} ${m.name}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [mats.data, q, category]);

  return (
    <div>
      <PageHeader
        title="Materials"
        description="Catalogue of stockable items. Each material has a category, unit of measure, and reorder threshold."
        actions={
          <RoleGuard roles={['ADMIN', 'STORE_CONTROLLER']}>
            <Button variant="primary" leadingIcon={<Icon.Plus />} onClick={() => setAdding(true)}>Add item</Button>
          </RoleGuard>
        }
      />

      <Toolbar
        left={(
          <>
            <div className="relative w-full sm:w-64">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input ref={searchRef} className="pl-8" placeholder="Search SKU or name…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search materials" />
            </div>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
              <option value="">All categories</option>
              {CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            {(q || category) && <Button variant="ghost" size="sm" onClick={() => { setQ(''); setCategory(''); }}>Clear</Button>}
          </>
        )}
        right={<span className="text-meta">{mats.loading ? 'Loading…' : `${filtered.length} of ${mats.data?.length ?? 0}`}</span>}
      />

      {mats.error && <ErrorState message={mats.error.message} onRetry={mats.reload} />}

      {!mats.error && (
        <DataTable
          ariaLabel="Materials"
          isLoading={mats.loading}
          rowKey={(m) => m.id}
          rows={filtered}
          columns={columns()}
          emptyState={<EmptyState title={q || category ? 'No materials match' : 'No materials yet'} description={q || category ? 'Try clearing filters.' : 'Add materials to start tracking inventory.'} action={!q && !category && canManage ? <Button variant="primary" onClick={() => setAdding(true)}>Add your first item</Button> : undefined} />}
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
    { key: 'name', header: 'Name', render: (m) => <span className="line-clamp-1" title={m.name}>{m.name}</span> },
    { key: 'cat', header: 'Category', render: (m) => <span className="text-meta">{categoryLabel(m.category)}</span> },
    { key: 'uom', header: 'UoM', render: (m) => m.unitOfMeasure, width: '5rem' },
    { key: 'reorder', header: 'Reorder', align: 'right', className: 'text-num', render: (m) => <span className="font-mono">{formatNumber(Number(m.requiredStock))}</span>, width: '6rem' },
    { key: 'status', header: 'Status', render: (m) => m.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Inactive</Badge>, width: '7rem' },
  ];
}