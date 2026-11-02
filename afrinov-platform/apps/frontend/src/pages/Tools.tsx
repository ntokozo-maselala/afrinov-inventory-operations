// Tools: what is in store and what is out, with whom, and until when (GET
// /tools). A tool is lent, not used up: check it out to a person until a due
// date, and back in when it returns. A loan past its due date is overdue; far
// enough past, it needs a decision: check it in, extend it, or write it off as
// lost. Tools come in through Receive stock and are counted on Count stock
// like anything else; they are not issued.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { FilterBar, SearchField, FILTER_WIDTH } from '../components/FilterBar';
import { Field, Select } from '../components/Field';
import { Button } from '../components/Button';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { Drawer } from '../components/Modal';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { CheckInForm, CheckOutForm, ExtendLoanForm, LoanDue } from '../components/ToolLoanForms';
import { usePermissions } from '../hooks/usePermissions';
import { formatDate, formatNumber } from '../lib/format';
import type { OpenLoan, ToolRow } from '../api/types';
import { StaleDataNotice } from '../components/StaleDataNotice';

const VIEWS: Array<{ value: string; label: string; loans?: (l: OpenLoan) => boolean }> = [
  { value: 'all', label: 'All tools' },
  { value: 'out', label: 'Checked out' },
  { value: 'due-soon', label: 'Due soon', loans: (l) => l.state === 'DUE_SOON' },
  { value: 'overdue', label: 'Overdue', loans: (l) => l.overdue },
  { value: 'decide', label: 'Needs a decision', loans: (l) => l.state === 'NEEDS_DECISION' },
  { value: 'in', label: 'In store' },
];

const sumOut = (loans: OpenLoan[]) => loans.reduce((n, l) => n + Number(l.out), 0);

export function Tools() {
  const tools = useApi<ToolRow[]>('/tools');
  const { hasPermission } = usePermissions();
  const canLend = hasPermission('tools:lend');
  const canExtend = hasPermission('tools:extend');
  const toast = useToast();
  // The Dashboard and Recipients link here with ?view=overdue or ?q=<name>.
  const [params] = useSearchParams();
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const [view, setView] = useState(() => (VIEWS.some((v) => v.value === params.get('view')) ? params.get('view')! : 'all'));
  const [checkingOut, setCheckingOut] = useState<{ start?: ToolRow } | null>(null);
  const [checkingIn, setCheckingIn] = useState<ToolRow | null>(null);
  const [extending, setExtending] = useState<{ tool: ToolRow; loan: OpenLoan } | null>(null);

  const all = useMemo(() => tools.data ?? [], [tools.data]);
  const loanFilter = VIEWS.find((v) => v.value === view)?.loans;
  const filtered = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = all.filter((t) => {
      if (view === 'out' && !(Number(t.onLoan) > 0)) return false;
      if (loanFilter && !t.loans.some(loanFilter)) return false;
      if (view === 'in' && !(Number(t.inStore) > 0)) return false;
      const hay = `${t.name} ${t.sku} ${t.serialNumber ?? ''} ${t.loans.map((l) => `${l.recipientName ?? ''} ${l.projectNumber ?? ''}`).join(' ')} ${t.locations.map((l) => l.locationName).join(' ')}`.toLowerCase();
      return terms.every((term) => hay.includes(term));
    });
    // In the due-date views, the most overdue first.
    if (!loanFilter) return rows;
    const latest = (t: ToolRow) => Math.max(...t.loans.filter(loanFilter).map((l) => l.daysLate));
    return [...rows].sort((a, b) => latest(b) - latest(a));
  }, [all, q, view, loanFilter]);
  const allLoans = all.flatMap((t) => t.loans);
  const out = sumOut(allLoans);
  const overdue = sumOut(allLoans.filter((l) => l.overdue));
  const decide = sumOut(allLoans.filter((l) => l.state === 'NEEDS_DECISION'));

  function done(summary: string) {
    setCheckingOut(null);
    setCheckingIn(null);
    setExtending(null);
    toast.success(summary);
    tools.reload();
  }

  const columns: DataTableColumn<ToolRow>[] = [
    {
      key: 'tool',
      header: 'Tool',
      render: (t) => (
        <div>
          <Link to={`/materials/${t.materialId}`} className="btn-link">{t.name}</Link>
          <div className="text-xs text-surface-500 font-mono">{t.sku}{t.serialNumber ? ` · S/N ${t.serialNumber}` : ''}</div>
        </div>
      ),
    },
    {
      key: 'in',
      header: 'In store',
      render: (t) => (
        <div>
          <span className="font-mono">{formatNumber(Number(t.inStore))}</span>
          {t.locations.length > 0 && <div className="text-xs text-surface-500">{t.locations.map((l) => (t.locations.length > 1 ? `${l.locationName} (${formatNumber(Number(l.quantity))})` : l.locationName)).join(', ')}</div>}
        </div>
      ),
      width: '11rem',
    },
    {
      key: 'out',
      header: 'Out with',
      render: (t) => (t.loans.length === 0
        ? <span className="text-surface-400">—</span>
        : (
          <ul className="text-sm space-y-1.5">
            {t.loans.map((l) => (
              <li key={l.loanId}>
                <span className="font-medium">{l.recipientName ?? 'Not recorded'}</span>
                <span className="text-surface-500"> · {formatNumber(Number(l.out))} since {formatDate(l.checkedOutAt)}{l.projectNumber ? ` · ${l.projectNumber}` : ''}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <LoanDue loan={l} />
                  {canExtend && (
                    <Button size="sm" variant="ghost" onClick={() => setExtending({ tool: t, loan: l })} aria-label={`Extend ${t.name} for ${l.recipientName ?? 'its borrower'}`}>
                      Extend
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )),
    },
    ...(canLend ? [{
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right' as const,
      width: '12rem',
      render: (t: ToolRow) => (
        <div className="flex justify-end gap-2">
          {Number(t.inStore) > 0 && <Button size="sm" variant="secondary" onClick={() => setCheckingOut({ start: t })}>Check out</Button>}
          {t.loans.length > 0 && <Button size="sm" variant="secondary" onClick={() => setCheckingIn(t)}>Check in</Button>}
        </div>
      ),
    }] : []),
  ];

  const summary = [`${filtered.length} of ${all.length} tools`, `${formatNumber(out)} out`];
  if (overdue) summary.push(`${formatNumber(overdue)} overdue`);
  if (decide) summary.push(`${formatNumber(decide)} need${decide === 1 ? 's' : ''} a decision`);

  return (
    <div>
      <PageHeader
        title="Tools"
        description="Tools are checked out, not used up: check one out to the person taking it until a due date, and check it back in when it returns. New tools come in through Receive stock."
        actions={canLend && (
          <Button variant="primary" size="sm" leadingIcon={<Icon.Wrench size={14} />} onClick={() => setCheckingOut({})} disabled={!all.some((t) => Number(t.inStore) > 0)}>
            Check out tools
          </Button>
        )}
      />

      <FilterBar
        onClear={q || view !== 'all' ? () => { setQ(''); setView('all'); } : undefined}
        count={tools.loading ? 'Loading…' : summary.join(' · ')}
      >
        <SearchField id="tools-search" value={q} onChange={setQ} placeholder="Tool, code, serial number, person or project…" />
        <Field label="Show" htmlFor="tools-view" className={FILTER_WIDTH}>
          <Select id="tools-view" value={view} onChange={(e) => setView(e.target.value)}>
            {VIEWS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </Select>
        </Field>
      </FilterBar>

      {tools.error && !tools.stale && <ErrorState error={tools.error} onRetry={tools.reload} />}
      {tools.stale && <StaleDataNotice error={tools.error} onRetry={tools.reload} />}
      {(!tools.error || tools.stale) && (
        <DataTable
          ariaLabel="Tools"
          rows={filtered}
          rowKey={(t) => t.materialId}
          columns={columns}
          isLoading={tools.loading}
          emptyState={all.length === 0
            ? <EmptyState title="No tools yet" description="Add tools on Materials with the category Tools, then receive them into the store." />
            : <EmptyState title="No tools match" description="Try clearing the filters." />}
        />
      )}

      {checkingOut && (
        <Drawer open onClose={() => setCheckingOut(null)} title="Check out tools" description="Who takes them, which tools, and when they are due back. They come off the shelf until they are checked in." width="md">
          <CheckOutForm tools={all} start={checkingOut.start} onCancel={() => setCheckingOut(null)} onDone={done} />
        </Drawer>
      )}
      {checkingIn && (
        <Drawer open onClose={() => setCheckingIn(null)} title={`Check in: ${checkingIn.name}`} description="How many came back from each check-out, and in what condition. A lost tool is written off." width="md">
          <CheckInForm tool={checkingIn} onCancel={() => setCheckingIn(null)} onDone={done} />
        </Drawer>
      )}
      {extending && (
        <Drawer open onClose={() => setExtending(null)} title={`Extend: ${extending.tool.name}`} description="A later due date for this check-out, and why. The earlier dates are kept." width="md">
          <ExtendLoanForm tool={extending.tool} loan={extending.loan} onCancel={() => setExtending(null)} onDone={done} />
        </Drawer>
      )}
    </div>
  );
}
