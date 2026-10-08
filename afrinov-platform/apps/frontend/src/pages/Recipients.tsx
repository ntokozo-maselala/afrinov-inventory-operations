import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { usePermissions } from '../hooks/usePermissions';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Button } from '../components/Button';
import { Input, Field, Select, Textarea } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Drawer } from '../components/Modal';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { Alert } from '../components/Alert';
import { api, type ApiError } from '../api/client';

export type RecipientType = 'WORKER' | 'MACHINE' | 'SITE' | 'CONTRACTOR';

export interface Recipient {
  id: string;
  name: string;
  type: RecipientType;
  notes?: string | null;
  active: boolean;
}

export const RECIPIENT_TYPE_LABEL: Record<RecipientType, string> = {
  WORKER: 'Worker',
  MACHINE: 'Machine',
  SITE: 'Site',
  CONTRACTOR: 'Contractor',
};

const TYPE_TONE: Record<RecipientType, 'brand' | 'info' | 'warning' | 'neutral'> = {
  WORKER: 'brand',
  MACHINE: 'neutral',
  SITE: 'info',
  CONTRACTOR: 'warning',
};

// The people and places stock is issued to ("Issued To").
export function Recipients() {
  const recipients = useApi<Recipient[]>('/recipients');
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('recipients:manage');
  const [q, setQ] = useState('');
  const [type, setType] = useState<RecipientType | ''>('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Recipient | 'new' | null>(null);
  const toast = useToast();

  const all = recipients.data ?? [];
  const filtered = all.filter((r) => {
    if (!showInactive && !r.active) return false;
    if (type && r.type !== type) return false;
    const needle = q.trim().toLowerCase();
    return !needle || r.name.toLowerCase().includes(needle);
  });

  async function setActive(r: Recipient, active: boolean) {
    try {
      await api.patch(`/recipients/${r.id}`, { active });
      toast.success(active ? `${r.name} reactivated` : `${r.name} deactivated`);
      recipients.reload();
    } catch (err) {
      toast.error('Could not update recipient', (err as ApiError).message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Recipients"
        description="The people and places stock is issued to: workers, machines, client sites and contractors."
        actions={canManage && <Button variant="primary" leadingIcon={<Icon.Plus />} onClick={() => setEditing('new')}>Add recipient</Button>}
      />

      <Toolbar
        left={(
          <div className="flex flex-wrap items-center gap-2 w-full">
            <div className="relative w-full sm:w-64">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input className="pl-8" placeholder="Search recipients…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search recipients" />
            </div>
            <Select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value as RecipientType | '')} className="w-full sm:w-40">
              <option value="">All types</option>
              {(Object.keys(RECIPIENT_TYPE_LABEL) as RecipientType[]).map((t) => <option key={t} value={t}>{RECIPIENT_TYPE_LABEL[t]}</option>)}
            </Select>
            <label className="flex items-center gap-2 text-sm text-surface-600">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show inactive
            </label>
          </div>
        )}
        right={<span className="text-meta">{recipients.loading ? 'Loading…' : `${filtered.length} of ${all.length}`}</span>}
      />

      {recipients.error && <ErrorState message={recipients.error.message} onRetry={recipients.reload} />}

      {!recipients.error && (
        <DataTable
          ariaLabel="Recipients"
          isLoading={recipients.loading}
          rowKey={(r) => r.id}
          rows={filtered}
          columns={columns({ canManage, onEdit: setEditing, onSetActive: setActive })}
          emptyState={<EmptyState
            title={q || type ? 'No recipients match your filters' : 'No recipients yet'}
            description={q || type ? 'Try clearing your filters.' : 'Add the workers, machines, sites and contractors stock is issued to.'}
            action={!q && !type && canManage && <Button variant="primary" onClick={() => setEditing('new')}>Add your first recipient</Button>}
          />}
        />
      )}

      {editing && (
        <Drawer
          open
          onClose={() => setEditing(null)}
          title={editing === 'new' ? 'Add recipient' : `Edit ${editing.name}`}
          description="Names must be unique, ignoring case."
          width="md"
        >
          <RecipientForm
            initial={editing === 'new' ? undefined : editing}
            onCancel={() => setEditing(null)}
            onSaved={(name) => { setEditing(null); recipients.reload(); toast.success(editing === 'new' ? `${name} added` : `${name} updated`); }}
          />
        </Drawer>
      )}
    </div>
  );
}

function columns({ canManage, onEdit, onSetActive }: {
  canManage: boolean;
  onEdit: (r: Recipient) => void;
  onSetActive: (r: Recipient, active: boolean) => void;
}): DataTableColumn<Recipient>[] {
  return [
    { key: 'name', header: 'Name', render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'type', header: 'Type', render: (r) => <Badge tone={TYPE_TONE[r.type]}>{RECIPIENT_TYPE_LABEL[r.type]}</Badge>, width: '9rem' },
    { key: 'notes', header: 'Notes', render: (r) => r.notes || <span className="text-surface-300">—</span> },
    { key: 'status', header: 'Status', render: (r) => r.active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Inactive</Badge>, width: '8rem' },
    ...(canManage ? [{
      key: 'actions', header: '', align: 'right' as const, width: '13rem',
      render: (r: Recipient) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="secondary" leadingIcon={<Icon.Edit size={12} />} onClick={() => onEdit(r)}>Edit</Button>
          {r.active
            ? <Button size="sm" variant="ghost" onClick={() => onSetActive(r, false)}>Deactivate</Button>
            : <Button size="sm" variant="ghost" onClick={() => onSetActive(r, true)}>Reactivate</Button>}
        </div>
      ),
    }] : []),
  ];
}

function RecipientForm({ initial, onCancel, onSaved }: {
  initial?: Recipient;
  onCancel: () => void;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<RecipientType>(initial?.type ?? 'WORKER');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Name is required.'); return; }
    setBusy(true);
    try {
      const body = { name: name.trim(), type, notes: notes.trim() || (initial ? null : undefined) };
      if (initial) await api.patch(`/recipients/${initial.id}`, body);
      else await api.post('/recipients', body);
      onSaved(name.trim());
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Name" htmlFor="rcp-name" required>
        <Input id="rcp-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="e.g. Sabelo, Forklift, Northam Platinum" />
      </Field>
      <Field label="Type" htmlFor="rcp-type" required help="Worker, machine, client site or contractor.">
        <Select id="rcp-type" value={type} onChange={(e) => setType(e.target.value as RecipientType)}>
          {(Object.keys(RECIPIENT_TYPE_LABEL) as RecipientType[]).map((t) => <option key={t} value={t}>{RECIPIENT_TYPE_LABEL[t]}</option>)}
        </Select>
      </Field>
      <Field label="Notes" htmlFor="rcp-notes">
        <Textarea id="rcp-notes" rows={2} value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="Optional, e.g. employee number or company contact" />
      </Field>
      {error && <Alert tone="danger" title="Cannot save">{error}</Alert>}
      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>{initial ? 'Save changes' : 'Add recipient'}</Button>
      </div>
    </form>
  );
}
