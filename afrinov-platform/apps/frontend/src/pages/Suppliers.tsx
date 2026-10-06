import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Button } from '../components/Button';
import { Input, Field } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Drawer } from '../components/Modal';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { api, type ApiError } from '../api/client';
import { Alert } from '../components/Alert';

interface Supplier {
  id: string; name: string; contactName?: string;
  contactEmail?: string; contactPhone?: string; notes?: string;
  active: boolean;
}

export function Suppliers() {
  const suppliers = useApi<Supplier[]>('/suppliers');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  const filtered = (suppliers.data ?? []).filter((s) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return `${s.name} ${s.contactName ?? ''} ${s.contactEmail ?? ''}`.toLowerCase().includes(needle);
  });

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Vendor master. Used to populate purchase orders and goods receipts."
        actions={<Button variant="primary" leadingIcon={<Icon.Plus />} onClick={() => setAdding(true)}>Add supplier</Button>}
      />

      <Toolbar
        left={(
          <div className="relative w-full sm:w-64">
            <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
            <Input className="pl-8" placeholder="Search suppliers…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search suppliers" />
          </div>
        )}
        right={<span className="text-meta">{suppliers.loading ? 'Loading…' : `${filtered.length} of ${suppliers.data?.length ?? 0}`}</span>}
      />

      {suppliers.error && <ErrorState message={suppliers.error.message} onRetry={suppliers.reload} />}

      {!suppliers.error && (
        <DataTable
          ariaLabel="Suppliers"
          isLoading={suppliers.loading}
          rowKey={(s) => s.id}
          rows={filtered}
          columns={columns()}
          emptyState={<EmptyState title={q ? 'No suppliers match your search' : 'No suppliers yet'} description={q ? 'Try a different search term.' : 'Add a supplier to start creating purchase orders.'} action={!q && <Button variant="primary" onClick={() => setAdding(true)}>Add your first supplier</Button>} />}
        />
      )}

      {adding && (
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
    { key: 'name', header: 'Name', render: (s) => <Link to={`/suppliers/${s.id}`} className="btn-link">{s.name}</Link> },
    { key: 'contact', header: 'Contact', render: (s) => s.contactName ?? <span className="text-surface-300">—</span> },
    { key: 'email', header: 'Email', render: (s) => s.contactEmail ? <a href={`mailto:${s.contactEmail}`} className="text-meta hover:text-brand-600">{s.contactEmail}</a> : <span className="text-surface-300">—</span> },
    { key: 'phone', header: 'Phone', render: (s) => s.contactPhone ?? <span className="text-surface-300">—</span> },
    { key: 'status', header: 'Status', render: (s) => s.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Inactive</Badge>, width: '8rem' },
  ];
}

export function SupplierForm({ onCancel, onSaved, onError, onSuccess, initial }: {
  onCancel: () => void;
  onSaved: () => void;
  onError: (e: ApiError) => void;
  onSuccess: () => void;
  initial?: Partial<Supplier>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [contactName, setContact] = useState(initial?.contactName ?? '');
  const [contactEmail, setEmail] = useState(initial?.contactEmail ?? '');
  const [contactPhone, setPhone] = useState(initial?.contactPhone ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    if (!name.trim()) { setValidation('Name is required.'); return; }
    if (contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) { setValidation('Enter a valid email address.'); return; }
    setBusy(true);
    try {
      await api.post('/suppliers', {
        name: name.trim(),
        contactName: contactName || undefined,
        contactEmail: contactEmail || undefined,
        contactPhone: contactPhone || undefined,
        notes: notes || undefined,
      });
      onSuccess();
      onSaved();
    } catch (err) { onError(err as ApiError); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Name" htmlFor="sup-name" required error={validation && !name.trim() ? validation : null}>
        <Input id="sup-name" value={name} onChange={(e) => setName(e.target.value)} required invalid={!!validation && !name.trim()} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Contact name" htmlFor="sup-contact"><Input id="sup-contact" value={contactName} onChange={(e) => setContact(e.target.value)} /></Field>
        <Field label="Phone" htmlFor="sup-phone"><Input id="sup-phone" value={contactPhone} onChange={(e) => setPhone(e.target.value)} /></Field>
      </div>
      <Field label="Email" htmlFor="sup-email" error={validation && contactEmail ? validation : null}>
        <Input id="sup-email" type="email" value={contactEmail} onChange={(e) => setEmail(e.target.value)} invalid={!!validation && !!contactEmail} />
      </Field>
      <Field label="Notes" htmlFor="sup-notes"><Input id="sup-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {validation && (validation !== 'Name is required.' || !name.trim()) && <Alert tone="danger" title="Cannot save">{validation}</Alert>}
      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>Save supplier</Button>
      </div>
    </form>
  );
}