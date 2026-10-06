import { useMemo, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Button } from '../components/Button';
import { Input, Select, Field } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Drawer } from '../components/Modal';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { RoleGuard } from '../components/RoleGuard';
import { api, type ApiError } from '../api/client';
import { formatNumber } from '../lib/format';
import { Alert } from '../components/Alert';
import { useCanManageMaterials } from '../hooks/usePermissions';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';

interface Material {
  id: string; sku: string; name: string; category: string;
  unitOfMeasure: string; requiredStock: string; active: boolean;
}

const CATEGORY_OPTIONS = [
  { value: '', label: 'All categories' },
  { value: 'FASTENERS_SLUGS_INSULATION', label: 'Fasteners, slugs, insulation' },
  { value: 'TOOLING_PPE_ELECTRICAL', label: 'Tooling, PPE, electrical' },
  { value: 'PROJECT_MATERIAL', label: 'Project material' },
  { value: 'CONSUMABLES', label: 'Consumables' },
  { value: 'TOOLS', label: 'Tools' },
];

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
            <Button variant="primary" leadingIcon={<Icon.Plus />} onClick={() => setAdding(true)}>Add material</Button>
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
              {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
          emptyState={<EmptyState title={q || category ? 'No materials match' : 'No materials yet'} description={q || category ? 'Try clearing filters.' : 'Add materials to start tracking inventory.'} action={!q && !category && canManage ? <Button variant="primary" onClick={() => setAdding(true)}>Add your first material</Button> : undefined} />}
        />
      )}

      {adding && canManage && (
        <Drawer open onClose={() => setAdding(false)} title="Add material" description="Define a new stockable item. The SKU must be unique." width="md">
          <MaterialForm
            onCancel={() => setAdding(false)}
            onSaved={() => { setAdding(false); mats.reload(); }}
            onError={(err) => toast.error('Could not save material', err.message)}
            onSuccess={() => toast.success('Material added')}
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
    { key: 'cat', header: 'Category', render: (m) => <span className="text-meta">{CATEGORY_OPTIONS.find((o) => o.value === m.category)?.label ?? m.category}</span> },
    { key: 'uom', header: 'UoM', render: (m) => m.unitOfMeasure, width: '5rem' },
    { key: 'reorder', header: 'Reorder', align: 'right', className: 'text-num', render: (m) => <span className="font-mono">{formatNumber(Number(m.requiredStock))}</span>, width: '6rem' },
    { key: 'status', header: 'Status', render: (m) => m.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Inactive</Badge>, width: '7rem' },
  ];
}

export function MaterialForm({ onCancel, onSaved, onError, onSuccess, initial }: {
  onCancel: () => void; onSaved: () => void; onError: (e: ApiError) => void; onSuccess: () => void;
  initial?: Partial<Material>;
}) {
  const [sku, setSku] = useState(initial?.sku ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial?.category ?? CATEGORY_OPTIONS[1]!.value);
  const [unitOfMeasure, setUom] = useState(initial?.unitOfMeasure ?? 'each');
  const [requiredStock, setReorder] = useState(String(initial?.requiredStock ?? '0'));
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    if (!sku.trim() || !name.trim()) { setValidation('SKU and name are required.'); return; }
    const reorder = Number(requiredStock);
    if (!Number.isFinite(reorder) || reorder < 0) { setValidation('Reorder threshold must be 0 or positive.'); return; }
    setBusy(true);
    try {
      await api.post('/materials', { sku: sku.trim(), name: name.trim(), category, unitOfMeasure: unitOfMeasure.trim(), requiredStock: reorder });
      onSuccess(); onSaved();
    } catch (err) { onError(err as ApiError); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="SKU" htmlFor="m-sku" required error={validation && !sku.trim() ? validation : null}>
          <Input id="m-sku" value={sku} onChange={(e) => setSku(e.target.value)} required invalid={!!validation && !sku.trim()} />
        </Field>
        <Field label="Unit of measure" htmlFor="m-uom" required>
          <Input id="m-uom" value={unitOfMeasure} onChange={(e) => setUom(e.target.value)} required />
        </Field>
      </div>
      <Field label="Name" htmlFor="m-name" required error={validation && !name.trim() ? 'Name is required.' : null}>
        <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} required invalid={!!validation && !name.trim()} />
      </Field>
      <Field label="Category" htmlFor="m-cat" required>
        <Select id="m-cat" value={category} onChange={(e) => setCategory(e.target.value as Material['category'])}>
          {CATEGORY_OPTIONS.filter((o) => o.value).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </Field>
      <Field label="Reorder threshold" htmlFor="m-reorder" help="Items at or below this level appear in the low-stock report.">
        <Input id="m-reorder" type="number" min="0" step="0.0001" value={requiredStock} onChange={(e) => setReorder(e.target.value)} />
      </Field>
      {validation && (sku.trim() && name.trim()) && <Alert tone="danger" title="Cannot save">{validation}</Alert>}
      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>Save material</Button>
      </div>
    </form>
  );
}