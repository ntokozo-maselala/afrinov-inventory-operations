// Per-section Settings subcomponents. Each one is a routed outlet that
// receives the settings context via `useSettings()` and renders the relevant
// controls. Save / reset is handled by the layout (parent) — sections only
// update the local draft.
import { useEffect, useState, type ReactNode } from 'react';
import { useSettings, type SettingValue } from '../hooks/useSettings';
import { useApi } from '../hooks/useApi';
import { useCategorySettings, useSetting, SectionPanel, BooleanField, NumberField, TextField, EnumField } from './Settings';
import { useToast } from '../components/Toast';
import { Alert } from '../components/Alert';
import { Skeleton } from '../components/Skeleton';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Input, Select, Field } from '../components/Field';
import { Drawer } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { api, FRONTEND_ONLY, type ApiError } from '../api/client';
import type { ReportResult } from '../mock/mockReport';
import { useReportExporter } from '../api/exportReport';
import { formatDateTime } from '../lib/format';
import { PROCUREMENT_ENABLED } from '../config/features';

// Hide "Purchase orders" as a landing page while procurement is off, unless it
// is the value already saved (so the select still shows what is stored).
function landingPageDef(def: SettingValue, current: unknown): SettingValue {
  if (PROCUREMENT_ENABLED) return def;
  const enumOptions = (def.enumOptions ?? []).filter((o) => o !== 'purchase-orders' || o === current);
  return { ...def, enumOptions };
}

// ── General ────────────────────────────────────────────────────────────
export function SettingsGeneral() {
  const { draft, setDraft, errors, save, saving } = useSettings();
  const toast = useToast();
  const items = useCategorySettings('general');
  const companyName = useSetting('general.companyName');
  const systemDescription = useSetting('general.systemDescription');
  const defaultCurrency = useSetting('general.defaultCurrency');
  const defaultTimezone = useSetting('general.defaultTimezone');
  const dateFormat = useSetting('general.dateFormat');
  const timeFormat = useSetting('general.timeFormat');
  const defaultLanguage = useSetting('general.defaultLanguage');
  const defaultLandingPage = useSetting('general.defaultLandingPage');
  const defaultPageSize = useSetting('general.defaultPageSize');

  if (items.length === 0) return <PanelSkeleton />;

  return (
    <SectionPanel title="General" description="Company, locale, and default page-size used across the application.">
      <TextField
        def={companyName}
        value={(draft['general.companyName'] as string) ?? ''}
        onChange={(v) => setDraft('general.companyName', v)}
        error={errors['general.companyName'] ?? null}
      />
      <TextField
        def={systemDescription}
        value={(draft['general.systemDescription'] as string) ?? ''}
        onChange={(v) => setDraft('general.systemDescription', v)}
        error={errors['general.systemDescription'] ?? null}
        multiline
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <EnumField def={defaultCurrency} value={(draft['general.defaultCurrency'] as string) ?? ''} onChange={(v) => setDraft('general.defaultCurrency', v)} error={errors['general.defaultCurrency'] ?? null} />
        <EnumField def={defaultTimezone} value={(draft['general.defaultTimezone'] as string) ?? ''} onChange={(v) => setDraft('general.defaultTimezone', v)} error={errors['general.defaultTimezone'] ?? null} />
        <EnumField def={dateFormat} value={(draft['general.dateFormat'] as string) ?? ''} onChange={(v) => setDraft('general.dateFormat', v)} error={errors['general.dateFormat'] ?? null} />
        <EnumField def={timeFormat} value={(draft['general.timeFormat'] as string) ?? ''} onChange={(v) => setDraft('general.timeFormat', v)} error={errors['general.timeFormat'] ?? null} />
        <EnumField def={defaultLanguage} value={(draft['general.defaultLanguage'] as string) ?? ''} onChange={(v) => setDraft('general.defaultLanguage', v)} error={errors['general.defaultLanguage'] ?? null} />
        <EnumField def={landingPageDef(defaultLandingPage, draft['general.defaultLandingPage'])} value={(draft['general.defaultLandingPage'] as string) ?? ''} onChange={(v) => setDraft('general.defaultLandingPage', v)} error={errors['general.defaultLandingPage'] ?? null} />
      </div>
      <NumberField
        def={defaultPageSize}
        value={Number(draft['general.defaultPageSize'] ?? 0)}
        onChange={(v) => setDraft('general.defaultPageSize', v)}
        error={errors['general.defaultPageSize'] ?? null}
      />
      <SaveBar items={items} onSave={async () => {
        try {
          const r = await save();
          toast.success(r.updated > 0 ? 'Settings saved' : 'No changes to save', r.updated > 0 ? `${r.updated} setting(s) updated.` : undefined);
        } catch (e) { toast.error('Save failed', (e as ApiError).message); }
      }} saving={saving} />
    </SectionPanel>
  );
}

// ── Inventory ──────────────────────────────────────────────────────────
export function SettingsInventory() {
  const { draft, setDraft, errors, save, saving } = useSettings();
  const toast = useToast();
  const items = useCategorySettings('inventory');
  const lowStockMultiplier = useSetting('inventory.lowStockMultiplier');
  const defaultUnitOfMeasure = useSetting('inventory.defaultUnitOfMeasure');
  const enableStockAlerts = useSetting('inventory.enableStockAlerts');
  const requireReasonForAdjustments = useSetting('inventory.requireReasonForAdjustments');
  const requireApprovalForSensitiveChanges = useSetting('inventory.requireApprovalForSensitiveChanges');
  if (items.length === 0) return <PanelSkeleton />;

  return (
    <SectionPanel title="Inventory" description="These settings directly control inventory business logic, including low-stock alerts. Stock can never go below zero; that rule is fixed.">
      <NumberField
        def={lowStockMultiplier}
        value={Number(draft['inventory.lowStockMultiplier'] ?? 0)}
        onChange={(v) => setDraft('inventory.lowStockMultiplier', v)}
        error={errors['inventory.lowStockMultiplier'] ?? null}
      />
      <TextField
        def={defaultUnitOfMeasure}
        value={(draft['inventory.defaultUnitOfMeasure'] as string) ?? ''}
        onChange={(v) => setDraft('inventory.defaultUnitOfMeasure', v)}
        error={errors['inventory.defaultUnitOfMeasure'] ?? null}
      />
      <BooleanField def={enableStockAlerts} value={Boolean(draft['inventory.enableStockAlerts'])} onChange={(v) => setDraft('inventory.enableStockAlerts', v)} />
      <BooleanField def={requireReasonForAdjustments} value={Boolean(draft['inventory.requireReasonForAdjustments'])} onChange={(v) => setDraft('inventory.requireReasonForAdjustments', v)} />
      <BooleanField def={requireApprovalForSensitiveChanges} value={Boolean(draft['inventory.requireApprovalForSensitiveChanges'])} onChange={(v) => setDraft('inventory.requireApprovalForSensitiveChanges', v)} />
      <SaveBar items={items} onSave={async () => {
        try {
          const r = await save();
          toast.success('Settings saved', `${r.updated} setting(s) updated.`);
        } catch (e) { toast.error('Save failed', (e as ApiError).message); }
      }} saving={saving} />
    </SectionPanel>
  );
}

// ── Purchase orders ───────────────────────────────────────────────────
export function SettingsPurchaseOrders() {
  const { draft, setDraft, save, saving } = useSettings();
  const toast = useToast();
  const items = useCategorySettings('purchase_orders');
  const requireApproval = useSetting('purchaseOrders.requireApprovalBeforeProcessing');
  const allowCancellation = useSetting('purchaseOrders.allowCancellation');
  const allowEditAfterApproval = useSetting('purchaseOrders.allowEditAfterApproval');
  const numberingFormat = useSetting('purchaseOrders.numberingFormat');
  if (items.length === 0) return <PanelSkeleton />;
  return (
    <SectionPanel title="Purchase orders" description="Rules that govern the purchase order workflow. Changes take effect immediately for the next operation.">
      <BooleanField def={requireApproval} value={Boolean(draft['purchaseOrders.requireApprovalBeforeProcessing'])} onChange={(v) => setDraft('purchaseOrders.requireApprovalBeforeProcessing', v)} />
      <p className="text-xs text-surface-500 -mt-2 pl-11">When on, submitting a PO routes it through <code>PENDING_APPROVAL</code>. When off, submission auto-approves.</p>
      <BooleanField def={allowCancellation} value={Boolean(draft['purchaseOrders.allowCancellation'])} onChange={(v) => setDraft('purchaseOrders.allowCancellation', v)} />
      <BooleanField def={allowEditAfterApproval} value={Boolean(draft['purchaseOrders.allowEditAfterApproval'])} onChange={(v) => setDraft('purchaseOrders.allowEditAfterApproval', v)} />
      <EnumField def={numberingFormat} value={(draft['purchaseOrders.numberingFormat'] as string) ?? ''} onChange={(v) => setDraft('purchaseOrders.numberingFormat', v)} />
      <SaveBar items={items} onSave={async () => {
        try {
          const r = await save();
          toast.success('Settings saved', `${r.updated} setting(s) updated.`);
        } catch (e) { toast.error('Save failed', (e as ApiError).message); }
      }} saving={saving} />
    </SectionPanel>
  );
}

// ── Notifications ─────────────────────────────────────────────────────
export function SettingsNotifications() {
  const { draft, setDraft, save, saving } = useSettings();
  const toast = useToast();
  const items = useCategorySettings('notifications');
  const inApp = useSetting('notifications.enableInAppNotifications');
  const lowStock = useSetting('notifications.enableLowStockNotifications');
  const po = useSetting('notifications.enablePurchaseOrderNotifications');
  const delivery = useSetting('notifications.enableDeliveryNotifications');
  if (items.length === 0) return <PanelSkeleton />;
  return (
    <>
      <SectionPanel title="Notifications" description="Operational alerts. Disabling a category silences that alert type across the application.">
        <BooleanField def={inApp} value={Boolean(draft['notifications.enableInAppNotifications'])} onChange={(v) => setDraft('notifications.enableInAppNotifications', v)} />
        <BooleanField def={lowStock} value={Boolean(draft['notifications.enableLowStockNotifications'])} onChange={(v) => setDraft('notifications.enableLowStockNotifications', v)} />
        {PROCUREMENT_ENABLED && (
          <>
            <BooleanField def={po} value={Boolean(draft['notifications.enablePurchaseOrderNotifications'])} onChange={(v) => setDraft('notifications.enablePurchaseOrderNotifications', v)} />
            <BooleanField def={delivery} value={Boolean(draft['notifications.enableDeliveryNotifications'])} onChange={(v) => setDraft('notifications.enableDeliveryNotifications', v)} />
          </>
        )}
        <SaveBar items={items} onSave={async () => {
          try {
            const r = await save();
            toast.success('Settings saved', `${r.updated} setting(s) updated.`);
          } catch (e) { toast.error('Save failed', (e as ApiError).message); }
        }} saving={saving} />
      </SectionPanel>
      <Alert tone="info" title="How notifications work">
        Alerts are dispatched as in-app toasts and domain events. The current build does not include email or SMS delivery —
        those channels would consume the same setting flags once added.
      </Alert>
    </>
  );
}

// ── Appearance ────────────────────────────────────────────────────────
export function SettingsAppearance() {
  const { draft, setDraft, save, saving } = useSettings();
  const toast = useToast();
  const items = useCategorySettings('appearance');
  const theme = useSetting('appearance.theme');
  const density = useSetting('appearance.density');
  if (items.length === 0) return <PanelSkeleton />;
  return (
    <SectionPanel title="Appearance" description="These settings apply to the current user on this device. Save to apply.">
      <EnumField
        def={theme}
        value={(draft['appearance.theme'] as string) ?? 'system'}
        onChange={(v) => setDraft('appearance.theme', v)}
      />
      <EnumField
        def={density}
        value={(draft['appearance.density'] as string) ?? 'comfortable'}
        onChange={(v) => setDraft('appearance.density', v)}
      />
      <SaveBar items={items} onSave={async () => {
        try {
          const r = await save();
          toast.success('Appearance updated', r.updated > 0 ? 'Changes applied immediately.' : 'No changes to save.');
        } catch (e) { toast.error('Save failed', (e as ApiError).message); }
      }} saving={saving} />
    </SectionPanel>
  );
}

// ── Users & permissions ───────────────────────────────────────────────
type RoleName = 'ADMIN' | 'STORE_CONTROLLER' | 'PROCUREMENT' | 'APPROVER' | 'TECHNICIAN' | 'VIEWER';
const ALL_ROLES: RoleName[] = ['ADMIN', 'STORE_CONTROLLER', 'PROCUREMENT', 'APPROVER', 'TECHNICIAN', 'VIEWER'];
const ROLE_LABEL: Record<RoleName, string> = {
  ADMIN: 'Administrator',
  STORE_CONTROLLER: 'Store controller',
  PROCUREMENT: 'Procurement',
  APPROVER: 'Approver',
  TECHNICIAN: 'Technician',
  VIEWER: 'Viewer',
};

interface AdminUser {
  id: string;
  email: string;
  name: string;
  active: boolean;
  createdAt: string;
  roles: { role: { name: RoleName } }[];
}

interface UserFormProps {
  initial?: Partial<AdminUser>;
  onCancel: () => void;
  onSaved: (msg: string) => void;
  onError: (e: ApiError) => void;
}

function UserForm({ initial, onCancel, onSaved, onError }: UserFormProps) {
  const isEdit = !!initial?.id;
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [roles, setRoles] = useState<RoleName[]>(initial?.roles?.map((r) => r.role.name) ?? ['VIEWER']);
  const [active, setActive] = useState(initial?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function toggleRole(r: RoleName): void {
    setRoles((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    setFieldErrors({});
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name is required.';
    if (!email.trim()) errs.email = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'Enter a valid email address.';
    if (!isEdit) {
      if (password.length < 8) errs.password = 'Password must be at least 8 characters.';
      if (password !== confirm) errs.confirm = 'Passwords do not match.';
    }
    if (roles.length === 0) errs.roles = 'Select at least one role.';
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setValidation('Please correct the highlighted fields.');
      return;
    }
    setBusy(true);
    try {
      if (isEdit && initial?.id) {
        await api.patch(`/users/${initial.id}`, { name: name.trim(), active, roleNames: roles });
        onSaved(`User ${name.trim()} updated.`);
      } else {
        await api.post('/users', { name: name.trim(), email: email.trim().toLowerCase(), password, roleNames: roles });
        onSaved(`User ${name.trim()} created.`);
      }
    } catch (err) {
      const e = err as ApiError;
      if (e.code === 'CONFLICT') {
        setFieldErrors({ email: e.message });
        setValidation(e.message);
      } else if (e.code === 'VALIDATION_ERROR') {
        const details = e.details as { fieldErrors?: Record<string, string[]> } | undefined;
        if (details?.fieldErrors) {
          const flat: Record<string, string> = {};
          for (const [k, v] of Object.entries(details.fieldErrors)) {
            if (v && v.length > 0) flat[k] = v[0]!;
          }
          setFieldErrors(flat);
        }
        setValidation('Please correct the highlighted fields.');
      } else if (e.code === 'FORBIDDEN') {
        setValidation("You don't have permission to manage users.");
      } else {
        setValidation('Unable to save the user. Please try again.');
      }
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name" htmlFor="usr-name" required error={fieldErrors.name}>
          <Input id="usr-name" value={name} onChange={(e) => setName(e.target.value)} invalid={!!fieldErrors.name} autoComplete="off" />
        </Field>
        <Field label="Email" htmlFor="usr-email" required error={fieldErrors.email}>
          <Input id="usr-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!fieldErrors.email} disabled={isEdit} autoComplete="off" />
        </Field>
      </div>
      {!isEdit && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Password" htmlFor="usr-pw" required help="At least 8 characters." error={fieldErrors.password}>
            <Input id="usr-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!fieldErrors.password} autoComplete="new-password" />
          </Field>
          <Field label="Confirm password" htmlFor="usr-pw2" required error={fieldErrors.confirm}>
            <Input id="usr-pw2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} invalid={!!fieldErrors.confirm} autoComplete="new-password" />
          </Field>
        </div>
      )}
      <Field label="Roles" htmlFor="usr-roles" required help="Users need at least one role. ADMIN is the only role with full settings access." error={fieldErrors.roles}>
        <div id="usr-roles" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ALL_ROLES.map((r) => (
            <label key={r} className={`flex items-center gap-2 p-2 rounded border ${roles.includes(r) ? 'border-brand-300 bg-brand-50/50' : 'border-surface-200 bg-surface-0'} cursor-pointer hover:bg-surface-50`}>
              <input type="checkbox" className="h-4 w-4 rounded border-surface-300 text-brand-500 focus:ring-brand-100" checked={roles.includes(r)} onChange={() => toggleRole(r)} />
              <span className="text-sm text-surface-900">{ROLE_LABEL[r]}</span>
              <span className="text-xs text-surface-500 font-mono">{r}</span>
            </label>
          ))}
        </div>
      </Field>
      {isEdit && (
        <Field label="Status" htmlFor="usr-active" help="Inactive users cannot sign in but their historical records are preserved.">
          <Select id="usr-active" value={active ? 'ACTIVE' : 'INACTIVE'} onChange={(e) => setActive(e.target.value === 'ACTIVE')}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
        </Field>
      )}
      {validation && <Alert tone="danger" title="Cannot save">{validation}</Alert>}
      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>{isEdit ? 'Save user' : 'Add user'}</Button>
      </div>
    </form>
  );
}

export function SettingsUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [drawer, setDrawer] = useState<{ mode: 'add' } | { mode: 'edit'; user: AdminUser } | null>(null);
  const [pendingToggle, setPendingToggle] = useState<AdminUser | null>(null);
  const [toggling, setToggling] = useState(false);
  const toast = useToast();

  function reload() {
    setLoading(true);
    setError(null);
    setReloadKey((key) => key + 1);
  }

  useEffect(() => {
    api.get<AdminUser[]>('/users')
      .then(setUsers)
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [reloadKey]);

  async function performToggle() {
    if (!pendingToggle) return;
    setToggling(true);
    try {
      await api.patch(`/users/${pendingToggle.id}`, { active: !pendingToggle.active });
      toast.success(`User ${pendingToggle.name} ${!pendingToggle.active ? 'activated' : 'deactivated'}.`);
      setPendingToggle(null);
      reload();
    } catch (err) {
      toast.error('Could not update user', (err as ApiError).message);
    } finally {
      setToggling(false);
    }
  }

  return (
    <SectionPanel
      title="Users & permissions"
      description="Add users, assign roles, and deactivate accounts. Roles drive the permissions shown across the application."
    >
      <div className="flex justify-end">
        <Button variant="primary" leadingIcon={<Icon.Plus size={14} />} onClick={() => setDrawer({ mode: 'add' })}>
          Add user
        </Button>
      </div>

      {error && <Alert tone="danger" title="Couldn't load users">{error}</Alert>}

      {loading ? (
        <div className="space-y-2"><Skeleton h={32} /><Skeleton h={32} /><Skeleton h={32} /></div>
      ) : users.length === 0 ? (
        <div className="text-sm text-surface-500 py-6 text-center">No users yet.</div>
      ) : (
        <ul className="divide-y divide-surface-200 surface-card p-0 overflow-hidden">
          {users.map((u) => (
            <li key={u.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-surface-900">{u.name}</span>
                  {!u.active && <Badge tone="neutral" dot>Inactive</Badge>}
                </div>
                <div className="text-xs text-surface-500 mt-0.5">{u.email}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {u.roles.length === 0 && <span className="text-xs text-surface-400">No roles</span>}
                  {u.roles.map((r) => <Badge key={r.role.name} tone={r.role.name === 'ADMIN' ? 'brand' : 'neutral'}>{ROLE_LABEL[r.role.name]}</Badge>)}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="secondary" leadingIcon={<Icon.Edit size={12} />} onClick={() => setDrawer({ mode: 'edit', user: u })}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => setPendingToggle(u)}>
                  {u.active ? 'Deactivate' : 'Activate'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {drawer && (
        <Drawer
          open
          onClose={() => setDrawer(null)}
          title={drawer.mode === 'edit' ? `Edit ${drawer.user.name}` : 'Add user'}
          description={drawer.mode === 'edit' ? 'Update user details, roles, and access.' : 'Create a new user account. The user will be able to sign in immediately.'}
          width="md"
        >
          <UserForm
            initial={drawer.mode === 'edit' ? drawer.user : undefined}
            onCancel={() => setDrawer(null)}
            onSaved={(msg) => { setDrawer(null); reload(); toast.success(msg); }}
            onError={(err) => toast.error('Could not save user', err.message)}
          />
        </Drawer>
      )}

      {pendingToggle && (
        <ConfirmDialog
          open
          onClose={() => setPendingToggle(null)}
          onConfirm={() => void performToggle()}
          title={pendingToggle.active ? `Deactivate ${pendingToggle.name}?` : `Activate ${pendingToggle.name}?`}
          description={pendingToggle.active
            ? 'Deactivating prevents this user from signing in. Their historical records are preserved.'
            : 'Activating restores this user’s ability to sign in.'}
          confirmLabel={pendingToggle.active ? 'Deactivate' : 'Activate'}
          loading={toggling}
        />
      )}
    </SectionPanel>
  );
}

// ── Security ─────────────────────────────────────────────────────────
export function SettingsSecurity() {
  const { draft, setDraft, errors, save, saving } = useSettings();
  const toast = useToast();
  const items = useCategorySettings('security');
  const session = useSetting('security.sessionTimeoutMinutes');
  const audit = useSetting('security.enableAuditLogging');
  const selfRegistration = useSetting('security.allowSelfRegistration');
  if (items.length === 0) return <PanelSkeleton />;
  return (
    <SectionPanel title="Security" description="Session and audit policy. Sign-in is currently fixed at email + password; advanced controls are noted below.">
      <NumberField
        def={session}
        value={Number(draft['security.sessionTimeoutMinutes'] ?? 0)}
        onChange={(v) => setDraft('security.sessionTimeoutMinutes', v)}
        error={errors['security.sessionTimeoutMinutes'] ?? null}
      />
      <BooleanField def={audit} value={Boolean(draft['security.enableAuditLogging'])} onChange={(v) => setDraft('security.enableAuditLogging', v)} />
      <BooleanField
        def={selfRegistration}
        value={Boolean(draft['security.allowSelfRegistration'])}
        onChange={(v) => setDraft('security.allowSelfRegistration', v)}
      />
      <Alert tone="info" title="Notes">
        The current authentication module supports email + password and a 12-hour JWT lifetime. Adjusting
        the session timeout below is the only setting the existing backend can enforce; more granular controls
        (account lockout, password complexity) are not yet wired and would require backend changes.
        When self-registration is enabled, new accounts sign themselves up with the least-privilege
        VIEWER role; an administrator can then assign further roles.
      </Alert>
      <SaveBar items={items} onSave={async () => {
        try {
          const r = await save();
          toast.success('Settings saved', `${r.updated} setting(s) updated.`);
        } catch (e) { toast.error('Save failed', (e as ApiError).message); }
      }} saving={saving} />
    </SectionPanel>
  );
}

// ── System ────────────────────────────────────────────────────────────
export function SettingsSystem() {
  const [version] = useState<string>('0.1.0');
  const [environment, setEnvironment] = useState<string>('unknown');
  useEffect(() => {
    api.get<{ status: string; time: string }>('/health')
      .then(() => setEnvironment('online'))
      .catch(() => setEnvironment('offline'));
  }, []);
  const isFrontendOnly = (window as { __FRONTEND_ONLY__?: boolean }).__FRONTEND_ONLY__ === true;
  return (
    <SectionPanel title="System" description="Application version, runtime environment, and current status.">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-surface-500">Application</dt>
          <dd className="font-mono">Afrinov IMS v{version}</dd>
        </div>
        <div>
          <dt className="text-surface-500">API status</dt>
          <dd>
            <Badge tone={environment === 'online' ? 'success' : environment === 'offline' ? 'danger' : 'neutral'} dot>{environment}</Badge>
          </dd>
        </div>
        <div>
          <dt className="text-surface-500">Mode</dt>
          <dd className="font-mono">{isFrontendOnly ? 'frontend-only' : 'live'}</dd>
        </div>
        <div>
          <dt className="text-surface-500">Browser</dt>
          <dd className="font-mono text-xs break-all">{navigator.userAgent.split(' ').slice(-2).join(' ')}</dd>
        </div>
      </dl>
    </SectionPanel>
  );
}

// ── Data & backup ─────────────────────────────────────────────────────
function openBlobInNewTab(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    URL.revokeObjectURL(url);
    throw new Error('Popup blocked — please allow popups for this site to view PDFs.');
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function downloadReport(format: 'xlsx' | 'pdf', filename: string, exporter: ReturnType<typeof useReportExporter> | null): Promise<void> {
  // The export endpoint streams a binary. We can't go through the typed
  // JSON `api.get` helper, so we use `fetch` directly but still honour the
  // JWT and the `/api/v1` prefix used by the api client. In frontend-only
  // mode the report is built client-side and offered as a blob.
  if (FRONTEND_ONLY) {
    try {
      if (!exporter) throw { code: 'NO_EXPORTER', message: 'Report exporter not available.' } as ApiError;
      if (format === 'xlsx') await exporter.exportXlsx();
      else await exporter.exportPdf();
      return;
    } catch (e) {
      throw e as ApiError;
    }
  }
  const token = (window as { localStorage?: Storage }).localStorage?.getItem('afrinov.token');
  const url = `/api/v1/reports/inventory/export?format=${format}`;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = body.error.message;
    } catch { /* ignore */ }
    throw { code: 'EXPORT_FAILED', message: detail } as ApiError;
  }
  const blob = await res.blob();
  if (format === 'pdf') {
    openBlobInNewTab(blob);
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }
}

export function SettingsData() {
  const toast = useToast();
  const [busy, setBusy] = useState<null | 'xlsx' | 'pdf' | 'reset'>(null);
  const inventoryReport = useApi<ReportResult | null>('/reports/inventory');
  const exporter = useReportExporter(inventoryReport.data);
  async function runExport(kind: 'xlsx' | 'pdf') {
    setBusy(kind);
    try {
      await downloadReport(kind, `afrinov-inventory-report.${kind}`, exporter);
      if (kind === 'pdf') {
        toast.success('PDF ready', 'Opened in a new tab.');
      } else {
        toast.success(`${kind.toUpperCase()} download started`);
      }
    } catch (err) {
      toast.error(`Could not export ${kind.toUpperCase()}`, (err as ApiError).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <SectionPanel title="Data & backup" description="Export operational data, or reset your local session. Destructive operations require explicit confirmation.">
      <div className="p-3 rounded border border-surface-200 bg-surface-0 flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-surface-900">Export inventory report (XLSX)</div>
          <div className="text-xs text-surface-500 mt-0.5">Downloads the full inventory report as an Excel file. Uses your current permissions.</div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => { void runExport('xlsx'); }} loading={busy === 'xlsx'} disabled={busy !== null}>
          Download XLSX
        </Button>
      </div>
      <div className="p-3 rounded border border-surface-200 bg-surface-0 flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-surface-900">Export inventory report (PDF)</div>
          <div className="text-xs text-surface-500 mt-0.5">Opens the report in a new tab for viewing or printing. Uses your current permissions.</div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => { void runExport('pdf'); }} loading={busy === 'pdf'} disabled={busy !== null}>
          View PDF
        </Button>
      </div>
      <div className="p-3 rounded border border-danger-100 bg-danger-50/30 flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-surface-900">Clear local session</div>
          <div className="text-xs text-surface-500 mt-0.5">Removes the cached token and reloads the page. No server data is deleted.</div>
        </div>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            try { localStorage.removeItem('afrinov.token'); } catch { /* ignore */ }
            setBusy('reset');
            toast.info('Session cleared', 'Reloading…');
            setTimeout(() => window.location.assign('/login'), 600);
          }}
          loading={busy === 'reset'}
        >
          Clear session
        </Button>
      </div>
    </SectionPanel>
  );
}

// ── History ───────────────────────────────────────────────────────────
interface HistoryRow { id: string; action: string; entityId: string; entityType: string; before: unknown; after: unknown; createdAt: string; actorId: string | null }

export function SettingsHistory() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable react-hooks/set-state-in-effect
  useEffect(() => {
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
    setError(null); // eslint-disable-line react-hooks/set-state-in-effect
    api.get<HistoryRow[]>('/audit?entityType=Setting&limit=100')
      .then(setRows) // eslint-disable-line react-hooks/set-state-in-effect
      .catch((e) => setError((e as ApiError).message)) // eslint-disable-line react-hooks/set-state-in-effect
      .finally(() => setLoading(false)); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);
  // eslint-enable react-hooks/set-state-in-effect
  return (
    <SectionPanel title="Change history" description="Most recent administrative changes. Each row reflects one persisted setting update.">
      {loading && <div className="space-y-2"><Skeleton h={24} /><Skeleton h={24} /><Skeleton h={24} /></div>}
      {error && <Alert tone="danger" title="Couldn't load history">{error}</Alert>}
      {!loading && !error && rows.length === 0 && (
        <div className="text-sm text-surface-500 py-6 text-center">No settings have been changed yet.</div>
      )}
      {!loading && !error && rows.length > 0 && (
        <ol className="divide-y divide-surface-200 surface-card p-0 overflow-hidden">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3 flex items-start gap-3 text-sm">
              <span className="mt-0.5 text-brand-500" aria-hidden="true"><Icon.Activity /></span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-surface-900">{labelForAction(r.action)} <span className="text-surface-500 font-normal">· {r.entityId}</span></div>
                <div className="text-xs text-surface-500 mt-0.5">
                  {formatDateTime(r.createdAt)} · {r.actorId ?? 'system'}
                </div>
                {describeChange(r)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </SectionPanel>
  );
}

function labelForAction(action: string): string {
  return ({
    SETTING_UPDATE: 'Setting updated',
    SETTING_BULK_UPDATE: 'Setting updated',
    SETTING_RESET: 'Setting reset to default',
  } as Record<string, string>)[action] ?? action;
}

function describeChange(r: HistoryRow): ReactNode {
  const before = (r.before ?? {}) as { value?: unknown };
  const after = (r.after ?? {}) as { value?: unknown; reset?: boolean };
  if (after.reset) return <div className="text-xs text-surface-500 mt-1">Reset to default value.</div>;
  if ('value' in before && 'value' in after) {
    return (
      <div className="text-xs mt-1 text-surface-600">
        <span className="font-mono text-surface-400 line-through mr-2">{formatValue(before.value)}</span>
        <span aria-hidden="true">→</span>
        <span className="font-mono ml-2">{formatValue(after.value)}</span>
      </div>
    );
  }
  return null;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

// ── Shared bits ───────────────────────────────────────────────────────
function SaveBar({ items, onSave, saving }: { items: { updatedAt: string; updatedById: string | null }[]; onSave: () => Promise<void> | void; saving: boolean }) {
  const last = items
    .slice()
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))[0];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-surface-200 mt-2">
      <div className="text-xs text-surface-500">
        {last ? <>Last updated {formatDateTime(last.updatedAt)} by <span className="font-mono">{last.updatedById ?? '—'}</span></> : '—'}
      </div>
      <Button variant="primary" onClick={onSave} loading={saving} leadingIcon={<Icon.Check size={14} />}>Save changes</Button>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <section className="surface-card p-5 space-y-3">
      <Skeleton h={18} w={120} />
      <Skeleton h={48} />
      <Skeleton h={48} />
      <Skeleton h={48} />
    </section>
  );
}
