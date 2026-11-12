// Labour rates: the hourly selling rate for each role, as the "Manhours and
// Material" sheet's Manpower Rate list, that Sales prices a job's labour at.
// The Workshop Manager keeps them: adds a role, changes its name or rate, or
// makes it inactive. Sales and senior managers see them. A change moves only
// Sales RFQ lines saved after it; each line keeps the rate it was priced at.
import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { usePermissions } from '../hooks/usePermissions';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Button } from '../components/Button';
import { Field, Input } from '../components/Field';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Badge } from '../components/Badge';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { Icon } from '../components/Icon';
import { NoAccess } from '../components/NoAccess';
import { useToast } from '../components/Toast';
import { StaleDataNotice } from '../components/StaleDataNotice';
import { api, type ApiError } from '../api/client';
import { formatMoney } from '../lib/poMoney';
import { amountDecimals, parseAmount, type LabourRate } from '../lib/salesRfq';

export function LabourRates() {
  const { hasPermission } = usePermissions();
  const canView = hasPermission('labourRates:view');
  const canManage = hasPermission('labourRates:manage');
  const rates = useApi<LabourRate[]>(canView ? '/labour-rates' : null);
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<LabourRate | 'new' | null>(null);
  if (!canView) return <NoAccess title="Labour rates" action="see the labour rates" section={{ label: 'Dashboard', to: '/' }} />;

  const needle = q.trim().toLowerCase();
  const rows = (rates.data ?? []).filter((r) => (showInactive || r.active) && (!needle || r.role.toLowerCase().includes(needle)));
  const columns: DataTableColumn<LabourRate>[] = [
    { key: 'role', header: 'Role', render: (r) => <span>{r.role}{!r.active && <Badge tone="neutral" className="ml-2">Inactive</Badge>}</span> },
    { key: 'rate', header: 'Selling rate / hour', align: 'right', width: '11rem', className: 'text-num', render: (r) => <span className="font-mono">{formatMoney(r.hourlyRate)}</span> },
    ...(canManage ? [{
      key: 'edit', header: '', align: 'right' as const, width: '6rem',
      render: (r: LabourRate) => <Button size="sm" variant="ghost" leadingIcon={<Icon.Edit size={12} />} onClick={() => setEditing(r)} aria-label={`Change ${r.role}`}>Change</Button>,
    }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Labour rates"
        description="The hourly selling rate for each role, excl. VAT, that Sales prices a job's labour at. A change applies to Sales RFQ lines saved after it."
        actions={canManage ? <Button variant="primary" leadingIcon={<Icon.Plus size={14} />} onClick={() => setEditing('new')}>Add role</Button> : undefined}
      />
      <Toolbar
        left={(
          <>
            <div className="relative w-full sm:w-64">
              <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
              <Input className="pl-8" placeholder="Search roles…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search roles" />
            </div>
            <label className="flex items-center gap-2 text-sm text-surface-700">
              <input type="checkbox" className="h-4 w-4" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show inactive roles
            </label>
          </>
        )}
        right={<span className="text-meta">{rates.loading ? 'Loading…' : `${rows.length} role${rows.length === 1 ? '' : 's'}`}</span>}
      />
      {rates.error && !rates.stale && <ErrorState error={rates.error} onRetry={rates.reload} />}
      {rates.stale && <StaleDataNotice error={rates.error} onRetry={rates.reload} />}
      {(!rates.error || rates.stale) && (
        <DataTable
          ariaLabel="Labour rates" isLoading={rates.loading} rowKey={(r) => r.id} rows={rows} columns={columns}
          emptyState={<EmptyState title={needle ? 'No roles match' : 'No labour rates yet'} description={canManage ? 'Add each role and its hourly selling rate.' : 'The Workshop Manager adds them.'} />}
        />
      )}
      {editing && <RateDialog rate={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); rates.reload(); }} />}
    </div>
  );
}

function RateDialog({ rate, onClose, onSaved }: { rate: LabourRate | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [role, setRole] = useState(rate?.role ?? '');
  const [hourly, setHourly] = useState(rate ? String(Number(rate.hourlyRate)) : '');
  const [active, setActive] = useState(rate?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = parseAmount(hourly);
  const badRate = hourly.trim() !== '' && (value === null || value <= 0 || amountDecimals(hourly) > 2);

  async function save() {
    setError(null);
    if (!role.trim()) { setError('Give the role a name.'); return; }
    if (value === null || badRate) { setError('The hourly rate is in rand and cents, more than R0.'); return; }
    setBusy(true);
    try {
      if (rate) await api.patch(`/labour-rates/${rate.id}`, { role: role.trim(), hourlyRate: value, active });
      else await api.post('/labour-rates', { role: role.trim(), hourlyRate: value });
      toast.success(rate ? `${role.trim()} saved` : `${role.trim()} added`);
      onSaved();
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      open onClose={onClose} size="md"
      title={rate ? `Change ${rate.role}` : 'Add a role'}
      description="Rand per hour, excl. VAT. Sales RFQ lines already saved keep the rate they were priced at."
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>{rate ? 'Save' : 'Add role'}</Button>
        </>
      )}
    >
      <div className="space-y-3">
        <Field label="Role" htmlFor="rate-role" required>
          <Input id="rate-role" maxLength={100} value={role} onChange={(e) => setRole(e.target.value)} />
        </Field>
        <Field label="Selling rate per hour (R)" htmlFor="rate-hourly" required error={badRate ? 'More than R0, in rand and cents.' : null}>
          <Input id="rate-hourly" inputMode="decimal" autoComplete="off" className="font-mono" value={hourly} onChange={(e) => setHourly(e.target.value)} invalid={badRate} />
        </Field>
        {rate && (
          <label className="flex items-center gap-2 text-sm text-surface-700">
            <input type="checkbox" className="h-4 w-4" checked={active} onChange={(e) => setActive(e.target.checked)} />
            In use: offered when Sales prices labour
          </label>
        )}
        {error && <p className="text-sm text-danger-700" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
