import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useBeforeUnload } from 'react-router-dom';
import { useAuth } from '../auth';
import { SettingsProvider, useSettings, type SettingCategory, type SettingValue } from '../hooks/useSettings';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { ErrorState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { PROCUREMENT_ENABLED } from '../config/features';

interface Section { to: string; label: string; description: string; adminOnly?: boolean; category?: SettingCategory }

const SECTIONS: Section[] = [
  { to: '/settings', label: 'General', description: 'Company info, currency, and language defaults.', category: 'general' },
  { to: '/settings/inventory', label: 'Inventory', description: 'Low-stock thresholds and adjustment policy.', category: 'inventory', adminOnly: true },
  { to: '/settings/purchase-orders', label: 'Purchase orders', description: 'Approval, cancellation, and numbering rules.', category: 'purchase_orders', adminOnly: true },
  { to: '/settings/notifications', label: 'Notifications', description: 'In-app and system alert preferences.', category: 'notifications' },
  { to: '/settings/appearance', label: 'Appearance', description: 'Theme and display density.', category: 'appearance' },
  { to: '/settings/users', label: 'Users & permissions', description: 'Role-based access and session policies.', category: 'users', adminOnly: true },
  { to: '/settings/security', label: 'Security', description: 'Session, audit, and account security.', category: 'security', adminOnly: true },
  { to: '/settings/system', label: 'System', description: 'Version, environment, and status.', category: 'system' },
  { to: '/settings/data', label: 'Data & backup', description: 'Export, retention, and restore.', category: 'data', adminOnly: true },
  { to: '/settings/history', label: 'Change history', description: 'Audit log of administrative changes.' },
];

export function Settings() {
  return <SettingsLayout />;
}

function SettingsLayout() {
  const { user } = useAuth();
  const isAdmin = !!user?.roles?.includes('ADMIN');
  return (
    <SettingsProvider canEdit={isAdmin}>
      <SettingsShell isAdmin={isAdmin} />
    </SettingsProvider>
  );
}

function SettingsShell({ isAdmin }: { isAdmin: boolean }) {
  const location = useLocation();
  const settings = useSettings();
  const toast = useToast();
  const { dirty, resetDraft, save, saving, resetAll, resetting, error, loading, reload } = settings;

  // Browser-level guard against accidental reload.
  useBeforeUnload((e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  const [pendingNav, setPendingNav] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  // Intercept clicks on NavLinks inside the settings nav and prompt if dirty.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!dirty) return;
      const a = (e.target as HTMLElement | null)?.closest('a') as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || !href.startsWith('/settings')) return;
      if (href === location.pathname) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setPendingNav(href);
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [dirty, location.pathname]);

  if (!isAdmin) {
    // Non-admins can still see Appearance (per-user preference). Hide admin sections.
  }

  const sections = SECTIONS.filter((s) => (!s.adminOnly || isAdmin) && (PROCUREMENT_ENABLED || s.category !== 'purchase_orders'));

  return (
    <div>
      <PageHeader
        title="Settings"
        description={isAdmin
          ? 'System-wide configuration and personal preferences. Changes are persisted to the database and audited.'
          : 'Personal preferences for this device.'}
        actions={
          isAdmin ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={resetDraft} disabled={!dirty || saving || resetting}>
                Reset changes
              </Button>
              <Button variant="danger" onClick={() => setConfirmReset(true)} disabled={saving || resetting} loading={resetting}>
                Reset to defaults
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  try {
                    const { updated } = await save();
                    if (updated > 0) {
                      toast.success('Settings saved', `${updated} setting(s) updated.`);
                    }
                  } catch (err) {
                    toast.error('Save failed', (err as Error)?.message ?? 'Unexpected error');
                  }
                }}
                disabled={!dirty || saving || resetting || Object.keys(settings.errors).length > 0}
                loading={saving}
                leadingIcon={<Icon.Check size={14} />}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          ) : null
        }
      />

      {error && <div className="mb-4"><ErrorState message={error.message} onRetry={reload} /></div>}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <aside className="lg:col-span-1">
          <nav aria-label="Settings" className="surface-card p-2">
            <ul className="space-y-0.5">
              {sections.map((s) => (
                <li key={s.to}>
                  <NavLink
                    to={s.to}
                    end={s.to === '/settings'}
                    className={({ isActive }) =>
                      `block rounded px-3 py-2 text-sm transition-colors ${
                        isActive
                          ? 'bg-brand-50 text-brand-700 font-semibold'
                          : 'text-surface-700 hover:bg-surface-100'
                      }`
                    }
                  >
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <span className="truncate">{s.label}</span>
                      {s.adminOnly && <span className="text-[10px] font-semibold text-surface-400 border border-surface-200 rounded px-1.5 py-0.5 shrink-0">ADMIN</span>}
                    </div>
                    <div className="text-xs text-surface-500 font-normal mt-0.5">{s.description}</div>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <main className="lg:col-span-3 space-y-4">
          {loading && !settings.settings['general.companyName'] ? (
            <div className="surface-card p-6 space-y-3"><Skeleton h={18} /><Skeleton h={120} /><Skeleton h={120} /></div>
          ) : (
            <Outlet context={settings} />
          )}
        </main>
      </div>

      {pendingNav && (
        <ConfirmDialog
          open
          onClose={() => setPendingNav(null)}
          onConfirm={() => {
            const target = pendingNav;
            setPendingNav(null);
            resetDraft();
            // Force navigation by reloading through the router.
            window.history.pushState(null, '', target);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          title="You have unsaved changes"
          description="Leaving this section will discard your unsaved edits. Do you want to continue?"
          confirmLabel="Leave without saving"
          cancelLabel="Keep editing"
          destructive
        />
      )}

      {confirmReset && (
        <ConfirmDialog
          open
          onClose={() => setConfirmReset(false)}
          onConfirm={async () => {
            try {
              await resetAll();
              setConfirmReset(false);
            } catch { setConfirmReset(false); }
          }}
          title="Reset all settings to defaults?"
          description="This restores every setting to its factory default. A row is written to the audit log for every change. This action cannot be undone."
          confirmLabel="Reset to defaults"
          cancelLabel="Cancel"
          destructive
          loading={resetting}
        />
      )}
    </div>
  );
}

// ── Generic controls used by the per-section subcomponents ──────────────
export function BooleanField({ def, value, onChange, disabled }: { def: SettingValue; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 p-3 rounded border border-surface-200 bg-surface-0 ${disabled ? 'opacity-60' : 'hover:bg-surface-50'}`}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-surface-300 text-brand-500 focus:ring-brand-100"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        aria-describedby={`${def.key}-desc`}
      />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-surface-900">{labelForKey(def.key)}</span>
        <span id={`${def.key}-desc`} className="block text-xs text-surface-500 mt-0.5">{def.description}</span>
      </span>
      <span className={`text-xs font-mono ${value ? 'text-success-700' : 'text-surface-400'}`}>{value ? 'ON' : 'OFF'}</span>
    </label>
  );
}

export function NumberField({ def, value, onChange, disabled, error }: { def: SettingValue; value: number; onChange: (v: number) => void; disabled?: boolean; error?: string | null }) {
  return (
    <div className="p-3 rounded border border-surface-200 bg-surface-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-surface-900">{labelForKey(def.key)}</div>
          <div className="text-xs text-surface-500 mt-0.5">{def.description}</div>
        </div>
        <input
          type="number"
          className={`input w-32 text-right ${error ? 'input-error' : ''}`}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          disabled={disabled}
          aria-label={def.key}
          min={0}
        />
      </div>
      {error && <p role="alert" className="field-error mt-1">{error}</p>}
    </div>
  );
}

export function TextField({ def, value, onChange, disabled, error, multiline }: { def: SettingValue; value: string; onChange: (v: string) => void; disabled?: boolean; error?: string | null; multiline?: boolean }) {
  return (
    <div className="p-3 rounded border border-surface-200 bg-surface-0">
      <label htmlFor={def.key} className="block text-sm font-medium text-surface-900">{labelForKey(def.key)}</label>
      <div className="text-xs text-surface-500 mt-0.5 mb-2">{def.description}</div>
      {multiline ? (
        <textarea
          id={def.key}
          className={`textarea ${error ? 'input-error' : ''}`}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={3}
        />
      ) : (
        <input
          id={def.key}
          type="text"
          className={`input ${error ? 'input-error' : ''}`}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      )}
      {error && <p role="alert" className="field-error mt-1">{error}</p>}
    </div>
  );
}

export function EnumField({ def, value, onChange, disabled, error }: { def: SettingValue; value: string; onChange: (v: string) => void; disabled?: boolean; error?: string | null }) {
  const opts = def.enumOptions ?? [];
  return (
    <div className="p-3 rounded border border-surface-200 bg-surface-0">
      <label htmlFor={def.key} className="block text-sm font-medium text-surface-900">{labelForKey(def.key)}</label>
      <div className="text-xs text-surface-500 mt-0.5 mb-2">{def.description}</div>
      <select
        id={def.key}
        className={`select ${error ? 'input-error' : ''}`}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {opts.map((o) => <option key={o} value={o}>{humanizeOption(o)}</option>)}
      </select>
      {error && <p role="alert" className="field-error mt-1">{error}</p>}
    </div>
  );
}

export function SectionPanel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="surface-card p-5">
      <header className="mb-4">
        <h2 className="text-h2 text-surface-900">{title}</h2>
        {description && <p className="text-sm text-surface-500 mt-1">{description}</p>}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function useCategorySettings(category: SettingCategory): SettingValue[] {
  const { settings } = useSettings();
  return useMemo(() => Object.values(settings).filter((s) => s.category === category), [settings, category]);
}

/**
 * Returns a single setting. After the loading state passes, every catalog
 * row is guaranteed to be present (the SettingsProvider renders its children
 * only after the fetch resolves). The returned value is therefore always
 * defined in practice; the assertion is safe.
 */
export function useSetting(key: string): SettingValue {
  const { settings } = useSettings();
  const v = settings[key];
  if (!v) throw new Error(`Setting ${key} not loaded`);
  return v;
}

function labelForKey(key: string): string {
  const tail = key.split('.').slice(1).join('.');
  return tail
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\bUom\b/, 'UoM')
    .replace(/\bPo\b/, 'PO')
    .trim();
}

function humanizeOption(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase());
}

// Re-export for legacy callers (existing page files in the project) so the
// previous Settings.tsx API doesn't break. The new layout uses hooks.
export { SettingsGeneral, SettingsInventory, SettingsNotifications, SettingsSecurity } from './SettingsSections';
