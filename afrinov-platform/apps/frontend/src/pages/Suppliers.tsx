import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Button } from '../components/Button';
import { Input } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Drawer } from '../components/Modal';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { usePermissions } from '../hooks/usePermissions';
import { SupplierForm } from '../components/SupplierForm';
import { PROCUREMENT_ENABLED } from '../config/features';
import type { Supplier } from '../api/types';
import { StaleDataNotice } from '../components/StaleDataNotice';

export function Suppliers() {
  const suppliers = useApi<Supplier[]>('/suppliers');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  // Adding needs create:supplier on the server (Procurement and Admin).
  const canManage = usePermissions().hasPermission('suppliers:manage');
  const toast = useToast();

  const filtered = (suppliers.data ?? []).filter((s) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return `${s.vendorCode ?? ''} ${s.name} ${s.contactName ?? ''} ${s.contactEmail ?? ''} ${s.services ?? ''}`.toLowerCase().includes(needle);
  });

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description={PROCUREMENT_ENABLED ? 'Vendor master. Used to populate purchase orders and goods receipts.' : 'Vendor master. The companies your stock is bought from.'}
        actions={canManage && <Button variant="primary" size="sm" leadingIcon={<Icon.Plus size={14} />} onClick={() => setAdding(true)}>Add supplier</Button>}
      />

      <Toolbar
        left={(
          <div className="relative w-full sm:w-64">
            <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
            <Input className="pl-8" placeholder="Search name, code or service…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search suppliers" />
          </div>
        )}
        right={<span className="text-meta">{suppliers.loading ? 'Loading…' : `${filtered.length} of ${suppliers.data?.length ?? 0}`}</span>}
      />

      {suppliers.error && !suppliers.stale && <ErrorState error={suppliers.error} onRetry={suppliers.reload} />}
      {suppliers.stale && <StaleDataNotice error={suppliers.error} onRetry={suppliers.reload} />}

      {(!suppliers.error || suppliers.stale) && (
        <DataTable
          ariaLabel="Suppliers"
          isLoading={suppliers.loading}
          rowKey={(s) => s.id}
          rows={filtered}
          columns={columns()}
          emptyState={<EmptyState title={q ? 'No suppliers match your search' : 'No suppliers yet'} description={q ? 'Try a different search term.' : (PROCUREMENT_ENABLED ? 'Add a supplier to start creating purchase orders.' : 'Add a supplier to record where your stock comes from.')} action={!q && canManage && <Button variant="primary" onClick={() => setAdding(true)}>Add your first supplier</Button>} />}
        />
      )}

      {adding && canManage && (
        <Drawer open onClose={() => setAdding(false)} title="Add supplier" description="Suppliers must have a unique name (case- and whitespace-insensitive)." width="md">
          <SupplierForm
            onCancel={() => setAdding(false)}
            onSaved={() => { setAdding(false); suppliers.reload(); }}
            onError={(err) => toast.error('Could not save supplier', err.message)}
            onSuccess={() => toast.success('Supplier added')}
          />
        </Drawer>
      )}
    </div>
  );
}

function columns(): DataTableColumn<Supplier>[] {
  return [
    { key: 'code', header: 'Code', className: 'text-mono', width: '6rem', render: (s) => s.vendorCode ?? <span className="text-surface-300">—</span> },
    {
      key: 'name', header: 'Name', render: (s) => (
        <div>
          <Link to={`/suppliers/${s.id}`} className="btn-link">{s.name}</Link>
          {s.services && <div className="text-meta">{s.services}</div>}
        </div>
      ),
    },
    {
      key: 'contact', header: 'Contact', render: (s) => (s.contactName || s.contactEmail) ? (
        <div>
          {s.contactName && <div>{s.contactName}</div>}
          {s.contactEmail && <a href={`mailto:${s.contactEmail}`} className="text-meta hover:text-brand-600">{s.contactEmail}</a>}
        </div>
      ) : <span className="text-surface-300">—</span>,
    },
    { key: 'phone', header: 'Phone', render: (s) => s.contactPhone ?? <span className="text-surface-300">—</span> },
    {
      key: 'terms', header: 'Payment terms', render: (s) => (
        <span className="whitespace-nowrap">
          {s.paymentTerms ?? <span className="text-surface-300">—</span>}
          {s.currency && s.currency !== 'ZAR' && <Badge tone="neutral" className="ml-2">{s.currency}</Badge>}
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (s) => s.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Inactive</Badge>, width: '8rem' },
  ];
}
