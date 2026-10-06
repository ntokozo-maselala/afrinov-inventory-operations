import { useMemo, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Button } from '../components/Button';
import { Input, Select, Field, Textarea } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { Drawer, Modal } from '../components/Modal';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import { Stat } from '../components/Stat';
import { Alert } from '../components/Alert';
import { api, type ApiError } from '../api/client';
import { formatDate } from '../lib/format';

type LocationType = 'RACK' | 'STOREROOM' | 'SHOP_FLOOR_AREA' | 'CONTAINER' | 'OFF_SITE';
type LocationStatus = 'ACTIVE' | 'INACTIVE';

interface Location {
  id: string;
  name: string;
  code?: string | null;
  type: LocationType;
  active: boolean;
  address?: string | null;
  description?: string | null;
  contactPerson?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
  inventoryCount?: number;
}

interface LocationDetails extends Location {
  dependencyCounts?: {
    racks: number;
    goodsReceiptLines: number;
    inventoryTransactions: number;
    inventoryBalances: number;
  };
}

const TYPE_OPTIONS: { value: LocationType; label: string }[] = [
  { value: 'STOREROOM', label: 'Storeroom' },
  { value: 'RACK', label: 'Rack' },
  { value: 'SHOP_FLOOR_AREA', label: 'Shop floor area' },
  { value: 'CONTAINER', label: 'Container' },
  { value: 'OFF_SITE', label: 'Off-site' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];

const TYPE_LABEL: Record<LocationType, string> = Object.fromEntries(
  TYPE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<LocationType, string>;

const TYPE_FILTER_OPTIONS = [
  { value: '', label: 'All types' },
  ...TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
];

function statusFor(loc: Location): LocationStatus {
  return loc.active ? 'ACTIVE' : 'INACTIVE';
}

function isValidEmail(value: string): boolean {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

interface LocationFormProps {
  initial?: Partial<Location>;
  onCancel: () => void;
  onSaved: (msg: string) => void;
  onError: (e: ApiError) => void;
}

function LocationForm({ initial, onCancel, onSaved, onError }: LocationFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [type, setType] = useState<LocationType>((initial?.type as LocationType) ?? 'STOREROOM');
  const [active, setActive] = useState(initial?.active ?? true);
  const [address, setAddress] = useState(initial?.address ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [contactPerson, setContactPerson] = useState(initial?.contactPerson ?? '');
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? '');
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    setFieldErrors({});
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Location name is required.';
    if (!type) errs.type = 'Location type is required.';
    if (contactEmail && !isValidEmail(contactEmail)) {
      errs.contactEmail = 'Enter a valid email address.';
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setValidation('Please correct the highlighted fields.');
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        code: code.trim() || undefined,
        type,
        active,
        address: address.trim() || undefined,
        description: description.trim() || undefined,
        contactPerson: contactPerson.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      if (initial?.id) {
        await api.patch(`/locations/${initial.id}`, payload);
        onSaved(`Location ${name.trim()} updated.`);
      } else {
        await api.post('/locations', payload);
        onSaved(`Location ${name.trim()} added.`);
      }
    } catch (err) {
      const e = err as ApiError;
      if (e.code === 'CONFLICT') {
        if (/code/i.test(e.message)) {
          setFieldErrors({ code: 'A location with this code already exists.' });
          setValidation('A location with this code already exists.');
        } else {
          setFieldErrors({ name: 'A location with this name already exists.' });
          setValidation('A location with this name already exists.');
        }
      } else if (e.code === 'VALIDATION_ERROR') {
        setValidation('Please correct the highlighted fields.');
      } else if (e.code === 'FORBIDDEN') {
        setValidation("You don't have permission to manage locations.");
      } else if (e.code === 'UNAUTHENTICATED') {
        setValidation('Your session has expired. Please sign in again.');
      } else {
        setValidation('Unable to save the location. Please try again.');
      }
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <p className="text-sm text-surface-500">
        Locations identify where stock is held. Add storerooms, racks, shop floor areas, containers, and off-site holdings.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Location name" htmlFor="loc-name" required error={fieldErrors.name}>
          <Input id="loc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Storeroom" invalid={!!fieldErrors.name} required autoComplete="off" />
        </Field>
        <Field label="Location code" htmlFor="loc-code" required help="Short, unique identifier (e.g. WH-A1)." error={fieldErrors.code}>
          <Input id="loc-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. WH-A1" invalid={!!fieldErrors.code} autoComplete="off" />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Location type" htmlFor="loc-type" required error={fieldErrors.type}>
          <Select id="loc-type" value={type} onChange={(e) => setType(e.target.value as LocationType)} invalid={!!fieldErrors.type}>
            {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>
        <Field label="Status" htmlFor="loc-status">
          <Select id="loc-status" value={active ? 'ACTIVE' : 'INACTIVE'} onChange={(e) => setActive(e.target.value === 'ACTIVE')}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
        </Field>
      </div>

      <Field label="Address" htmlFor="loc-address" help="Physical or postal address. Optional.">
        <Input id="loc-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 12 Industrial Rd, Jet Park" autoComplete="off" />
      </Field>

      <Field label="Description" htmlFor="loc-desc">
        <Textarea id="loc-desc" rows={2} value={description ?? ''} onChange={(e) => setDescription(e.target.value)} placeholder="Optional. Helps identify the location in lists." />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Contact person" htmlFor="loc-contact">
          <Input id="loc-contact" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Contact phone" htmlFor="loc-phone">
          <Input id="loc-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} autoComplete="off" />
        </Field>
      </div>

      <Field label="Contact email" htmlFor="loc-email" error={fieldErrors.contactEmail}>
        <Input id="loc-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} invalid={!!fieldErrors.contactEmail} autoComplete="off" />
      </Field>

      <Field label="Notes" htmlFor="loc-notes">
        <Textarea id="loc-notes" rows={2} value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes (visible to authorised users)." />
      </Field>

      {validation && <Alert tone="danger" title="Cannot save">{validation}</Alert>}

      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>{initial?.id ? 'Save location' : 'Add location'}</Button>
      </div>
    </form>
  );
}

function LocationDetailsView({ location, onClose }: { location: LocationDetails; onClose: () => void }) {
  const deps = location.dependencyCounts;
  const total = deps ? deps.racks + deps.goodsReceiptLines + deps.inventoryTransactions + deps.inventoryBalances : 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-eyebrow text-surface-500">Location</p>
          <h3 className="text-h3 text-surface-900">{location.name}</h3>
          {location.code && <p className="text-meta">Code: <span className="font-mono">{location.code}</span></p>}
        </div>
        <Badge tone={location.active ? 'success' : 'neutral'} dot>{location.active ? 'Active' : 'Inactive'}</Badge>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <div>
          <dt className="text-eyebrow text-surface-500">Type</dt>
          <dd className="text-surface-900">{TYPE_LABEL[location.type] ?? location.type}</dd>
        </div>
        <div>
          <dt className="text-eyebrow text-surface-500">Inventory</dt>
          <dd className="text-surface-900">{location.inventoryCount ?? 0} item(s)</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-eyebrow text-surface-500">Address</dt>
          <dd className="text-surface-900">{location.address || <span className="text-surface-300">—</span>}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-eyebrow text-surface-500">Description</dt>
          <dd className="text-surface-900">{location.description || <span className="text-surface-300">—</span>}</dd>
        </div>
        <div>
          <dt className="text-eyebrow text-surface-500">Contact person</dt>
          <dd className="text-surface-900">{location.contactPerson || <span className="text-surface-300">—</span>}</dd>
        </div>
        <div>
          <dt className="text-eyebrow text-surface-500">Contact phone</dt>
          <dd className="text-surface-900">{location.contactPhone || <span className="text-surface-300">—</span>}</dd>
        </div>
        <div>
          <dt className="text-eyebrow text-surface-500">Contact email</dt>
          <dd className="text-surface-900">{location.contactEmail ? <a href={`mailto:${location.contactEmail}`} className="text-meta hover:text-brand-600">{location.contactEmail}</a> : <span className="text-surface-300">—</span>}</dd>
        </div>
        <div>
          <dt className="text-eyebrow text-surface-500">Notes</dt>
          <dd className="text-surface-900">{location.notes || <span className="text-surface-300">—</span>}</dd>
        </div>
        <div>
          <dt className="text-eyebrow text-surface-500">Created</dt>
          <dd className="text-surface-900">{location.createdAt ? formatDate(location.createdAt) : <span className="text-surface-300">—</span>}</dd>
        </div>
        <div>
          <dt className="text-eyebrow text-surface-500">Updated</dt>
          <dd className="text-surface-900">{location.updatedAt ? formatDate(location.updatedAt) : <span className="text-surface-300">—</span>}</dd>
        </div>
      </dl>

      {deps && total > 0 && (
        <Alert tone="info" title="Referenced by other records">
          <p className="text-sm">This location is referenced by {total} record(s) ({deps.racks} rack(s), {deps.goodsReceiptLines} goods receipt line(s), {deps.inventoryTransactions} transaction(s), {deps.inventoryBalances} inventory balance(s)). Deactivate the location instead of deleting it to preserve history.</p>
        </Alert>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="primary" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

export function Locations() {
  const locations = useApi<Location[]>('/locations');
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [drawer, setDrawer] = useState<{ mode: 'add' } | { mode: 'edit'; location: Location } | null>(null);
  const [viewing, setViewing] = useState<LocationDetails | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Location | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<Location | null>(null);
  const [toggling, setToggling] = useState(false);
  const toast = useToast();

  const filtered = useMemo(() => {
    if (!locations.data) return [];
    const needle = q.trim().toLowerCase();
    return locations.data.filter((l) => {
      if (typeFilter && l.type !== typeFilter) return false;
      if (statusFilter && statusFor(l) !== statusFilter) return false;
      if (needle) {
        const hay = `${l.name} ${l.code ?? ''} ${l.address ?? ''} ${l.description ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [locations.data, q, typeFilter, statusFilter]);

  const stats = useMemo(() => {
    const data = locations.data ?? [];
    const total = data.length;
    const active = data.filter((l) => l.active).length;
    const inactive = total - active;
    const withInventory = data.filter((l) => (l.inventoryCount ?? 0) > 0).length;
    return { total, active, inactive, withInventory };
  }, [locations.data]);

  async function openView(id: string) {
    try {
      const details = await api.get<LocationDetails>(`/locations/${id}`);
      setViewing(details);
    } catch (err) {
      toast.error('Could not load location details', (err as ApiError).message);
    }
  }

  async function performDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.del(`/locations/${pendingDelete.id}`);
      toast.success(`Location ${pendingDelete.name} deleted.`);
      setPendingDelete(null);
      locations.reload();
    } catch (err) {
      const e = err as ApiError;
      if (e.code === 'CONFLICT') {
        toast.error('Cannot delete location', e.message);
      } else {
        toast.error('Could not delete location', e.message);
      }
    } finally {
      setDeleting(false);
    }
  }

  async function performToggleStatus() {
    if (!pendingStatus) return;
    setToggling(true);
    try {
      const next = !pendingStatus.active;
      await api.patch(`/locations/${pendingStatus.id}/status`, { active: next });
      toast.success(`Location ${pendingStatus.name} ${next ? 'activated' : 'deactivated'}.`);
      setPendingStatus(null);
      locations.reload();
    } catch (err) {
      toast.error('Could not update status', (err as ApiError).message);
    } finally {
      setToggling(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Locations"
        description="Manage inventory storage and operational locations."
        actions={
          <Button variant="primary" leadingIcon={<Icon.Plus size={14} />} onClick={() => setDrawer({ mode: 'add' })}>
            Add location
          </Button>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Total locations" value={stats.total} tone="brand" icon={<Icon.Map size={14} />} />
        <Stat label="Active" value={stats.active} tone="success" icon={<Icon.Check size={14} />} />
        <Stat label="Inactive" value={stats.inactive} tone="neutral" icon={<Icon.Minus size={14} />} />
        <Stat label="With inventory" value={stats.withInventory} tone="warning" icon={<Icon.Box size={14} />} />
      </div>

      <Toolbar
        left={(
          <>
            <div className="relative w-full sm:w-64">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input className="pl-8" placeholder="Search name, code, address…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search locations" />
            </div>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by type">
              {TYPE_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
            {(q || typeFilter || statusFilter) && (
              <Button variant="ghost" size="sm" onClick={() => { setQ(''); setTypeFilter(''); setStatusFilter(''); }}>Clear</Button>
            )}
          </>
        )}
        right={<span className="text-meta">{locations.loading ? 'Loading…' : `${filtered.length} of ${locations.data?.length ?? 0}`}</span>}
      />

      {locations.error && <ErrorState message={locations.error.message} onRetry={locations.reload} />}

      {!locations.error && (
        <DataTable<Location>
          ariaLabel="Locations"
          isLoading={locations.loading}
          rowKey={(l) => l.id}
          rows={filtered}
          columns={columns({
            onView: (l) => openView(l.id),
            onEdit: (l) => setDrawer({ mode: 'edit', location: l }),
            onToggleStatus: (l) => setPendingStatus(l),
            onDelete: (l) => setPendingDelete(l),
          })}
          emptyState={
            <EmptyState
              title={q || typeFilter || statusFilter ? 'No locations match your filters' : 'No locations yet'}
              description={q || typeFilter || statusFilter ? 'Try clearing your filters.' : 'Create your first location to start organising inventory.'}
              action={!q && !typeFilter && !statusFilter ? <Button variant="primary" onClick={() => setDrawer({ mode: 'add' })}>Add your first location</Button> : undefined}
            />
          }
        />
      )}

      {drawer && (
        <Drawer
          open
          onClose={() => setDrawer(null)}
          title={drawer.mode === 'edit' ? `Edit ${drawer.location.name}` : 'Add location'}
          description={drawer.mode === 'edit' ? 'Update location details and status.' : 'Define a new inventory storage or operational location.'}
          width="lg"
        >
          <LocationForm
            initial={drawer.mode === 'edit' ? drawer.location : undefined}
            onCancel={() => setDrawer(null)}
            onSaved={(msg) => { setDrawer(null); locations.reload(); toast.success(msg); }}
            onError={(err) => toast.error('Could not save location', err.message)}
          />
        </Drawer>
      )}

      {viewing && (
        <Modal open onClose={() => setViewing(null)} title="Location details" size="lg">
          <LocationDetailsView location={viewing} onClose={() => setViewing(null)} />
        </Modal>
      )}

      {pendingDelete && (
        <ConfirmDialog
          open
          onClose={() => setPendingDelete(null)}
          onConfirm={() => void performDelete()}
          title={`Delete ${pendingDelete.name}?`}
          description="If this location is referenced by inventory, racks, goods receipts, or transactions the deletion will be blocked and you will be asked to deactivate it instead."
          confirmLabel="Delete"
          destructive
          loading={deleting}
        />
      )}

      {pendingStatus && (
        <ConfirmDialog
          open
          onClose={() => setPendingStatus(null)}
          onConfirm={() => void performToggleStatus()}
          title={pendingStatus.active ? `Deactivate ${pendingStatus.name}?` : `Activate ${pendingStatus.name}?`}
          description={pendingStatus.active
            ? 'Deactivating prevents new transactions being posted to this location while preserving all historical records.'
            : 'Activating makes the location available for new transactions again.'}
          confirmLabel={pendingStatus.active ? 'Deactivate' : 'Activate'}
          loading={toggling}
        />
      )}
    </div>
  );
}

function columns({
  onView,
  onEdit,
  onToggleStatus,
  onDelete,
}: {
  onView: (l: Location) => void;
  onEdit: (l: Location) => void;
  onToggleStatus: (l: Location) => void;
  onDelete: (l: Location) => void;
}): DataTableColumn<Location>[] {
  return [
    {
      key: 'name', header: 'Location', render: (l) => (
        <button type="button" className="btn-link text-left" onClick={() => onView(l)}>
          <span className="font-medium">{l.name}</span>
          {l.address && <div className="text-meta">{l.address}</div>}
        </button>
      ),
    },
    { key: 'code', header: 'Code', render: (l) => l.code ? <span className="font-mono">{l.code}</span> : <span className="text-surface-300">—</span>, width: '8rem' },
    { key: 'type', header: 'Type', render: (l) => TYPE_LABEL[l.type] ?? l.type, width: '11rem' },
    { key: 'status', header: 'Status', render: (l) => <Badge tone={l.active ? 'success' : 'neutral'} dot>{l.active ? 'Active' : 'Inactive'}</Badge>, width: '9rem' },
    { key: 'inventory', header: 'Inventory', align: 'right', render: (l) => <span className="font-mono">{l.inventoryCount ?? 0}</span>, width: '7rem' },
    { key: 'updated', header: 'Updated', render: (l) => l.updatedAt ? <span className="text-meta">{formatDate(l.updatedAt)}</span> : <span className="text-surface-300">—</span>, width: '9rem' },
    {
      key: 'actions', header: '', align: 'right', width: '16rem',
      render: (l) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" leadingIcon={<Icon.Eye size={12} />} onClick={() => onView(l)}>View</Button>
          <Button size="sm" variant="secondary" leadingIcon={<Icon.Edit size={12} />} onClick={() => onEdit(l)}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => onToggleStatus(l)}>
            {l.active ? 'Deactivate' : 'Activate'}
          </Button>
          <Button size="sm" variant="ghost" leadingIcon={<Icon.Trash size={12} />} onClick={() => onDelete(l)}>Delete</Button>
        </div>
      ),
    },
  ];
}
