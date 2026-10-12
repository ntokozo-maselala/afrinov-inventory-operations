// Movements: the shop's records as reports. Choose a report and a day (or add
// an end date for a range) and narrow it with the filters that report has.
// Every record has one home: receipts under Received stock, issues under Issued
// stock, count differences under Stock counts, transfers under Transfers, other
// adjustments under Write-offs, catalogue and user changes under Other changes
// (Admin and Store Controller); All movements is the full ledger. The report,
// day and filters live in the address, so a report can be bookmarked or shared.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { useDebounced } from '../hooks/useDebounced';
import { PageHeader } from '../components/PageHeader';
import { Toolbar } from '../components/Toolbar';
import { Field, Input, Select } from '../components/Field';
import { Button } from '../components/Button';
import { ErrorState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { SearchSelect, type SearchOption } from '../components/SearchSelect';
import { LedgerReport, type LedgerReportKind } from '../components/reports/LedgerReport';
import { ReceivedStockReport } from '../components/reports/ReceivedStockReport';
import { IssuedStockReport } from '../components/reports/IssuedStockReport';
import { StockCountsReport } from '../components/reports/StockCountsReport';
import { OtherActivity, ACTIVITY_TYPE_LABEL } from '../components/OtherActivity';
import { downloadMovements } from '../api/exportMovements';
import { downloadIssuedStock, downloadReceivedStock, downloadStockCounts } from '../api/exportReports';
import type { Material } from '../api/types';
import { useCanViewActivity } from '../hooks/usePermissions';
import { today } from '../lib/dates';

type Filter = 'recipientId' | 'locationId' | 'actorId' | 'materialId' | 'supplierId' | 'entityType' | 'q';
type ReportId = 'all' | 'received' | 'issued' | 'counts' | 'transfers' | 'writeoffs' | 'other';

const REPORTS: Array<{ id: ReportId; label: string; filters: Filter[] }> = [
  { id: 'all', label: 'All movements', filters: ['locationId', 'actorId', 'materialId', 'q'] },
  { id: 'received', label: 'Received stock', filters: ['supplierId', 'locationId', 'q'] },
  { id: 'issued', label: 'Issued stock', filters: ['recipientId', 'locationId', 'actorId', 'materialId', 'q'] },
  { id: 'counts', label: 'Stock counts', filters: ['locationId'] },
  { id: 'transfers', label: 'Transfers', filters: ['actorId', 'materialId'] },
  { id: 'writeoffs', label: 'Write-offs and adjustments', filters: ['locationId', 'actorId', 'materialId'] },
  { id: 'other', label: 'Other changes', filters: ['entityType', 'actorId'] },
];

const SEARCH_HINT: Partial<Record<ReportId, string>> = {
  all: 'Search item, location, project, recipient…',
  issued: 'Search item, location, project, recipient…',
  received: 'Search delivery note, supplier, item…',
};

interface Option { id: string; name: string }

export function Movements() {
  const [params, setParams] = useSearchParams();
  const canViewActivity = useCanViewActivity();
  const reports = REPORTS.filter((r) => r.id !== 'other' || canViewActivity);
  const report = reports.find((r) => r.id === params.get('report')) ?? reports[0]!;
  const has = (f: Filter) => report.filters.includes(f);

  const day = useMemo(() => today(), []);
  const from = params.get('from') || day;
  const ranged = params.has('to');
  const to = ranged ? params.get('to') || from : from;
  const badRange = from > to;

  // What every request of this report shares: the day or range, and its filters.
  const queryParams = new URLSearchParams({ from, to });
  for (const f of report.filters) { const v = params.get(f); if (v) queryParams.set(f, v); }
  const query = queryParams.toString();

  const ledgerActors = has('actorId') && report.id !== 'other';
  const locations = useApi<Option[]>(has('locationId') ? '/locations' : null);
  const suppliers = useApi<Option[]>(has('supplierId') ? '/suppliers' : null);
  const recipients = useApi<Option[]>(has('recipientId') ? '/recipients' : null);
  const materials = useApi<Material[]>(has('materialId') ? '/materials' : null);
  const actors = useApi<Option[]>(!has('actorId') ? null : ledgerActors ? '/inventory-transactions/actors' : '/activity/actors');
  const itemOptions = useMemo<SearchOption[]>(() => (materials.data ?? [])
    .map((m) => ({ value: m.id, label: `${m.name} (${m.sku})` }))
    .sort((a, b) => a.label.localeCompare(b.label)), [materials.data]);

  const [search, setSearch] = useState(params.get('q') ?? '');
  const debouncedSearch = useDebounced(search, 300);
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();

  function setParam(key: string, value: string | null) {
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (value !== null && value !== '') next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });
  }

  useEffect(() => {
    if (debouncedSearch.trim() !== (params.get('q') ?? '')) setParam('q', debouncedSearch.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  /** Another report, or a reset: keep the day or range, drop the filters. */
  function showReport(id: ReportId) {
    const keep = new URLSearchParams();
    if (id !== 'all') keep.set('report', id);
    if (params.get('from')) keep.set('from', params.get('from')!);
    if (params.has('to')) keep.set('to', params.get('to')!);
    setSearch('');
    setParams(keep, { replace: true });
  }

  async function download() {
    setDownloading(true);
    try {
      if (report.id === 'received') await downloadReceivedStock(query);
      else if (report.id === 'issued') await downloadIssuedStock(query);
      else if (report.id === 'counts') await downloadStockCounts(query);
      else await downloadMovements(report.id === 'all' ? query : `${query}&report=${report.id}`);
    } catch (err) {
      toast.error('Download failed', (err as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  const filtersSet = report.filters.some((f) => params.get(f));

  return (
    <div>
      <PageHeader
        title="Movements"
        description="The shop's records by report: choose what to see and the day, then narrow it down."
        actions={(
          <div className="flex gap-2 no-print">
            {report.id !== 'other' && (
              <Button variant="primary" size="sm" leadingIcon={<Icon.Download size={14} />} onClick={download} loading={downloading} disabled={badRange}>
                Download as Excel
              </Button>
            )}
            <Button variant="primary" size="sm" leadingIcon={<Icon.Print size={14} />} onClick={() => window.print()}>Print</Button>
          </div>
        )}
      />

      <div className="surface-card p-4 mb-4 no-print">
        <div className="grid grid-cols-1 md:grid-cols-[16rem_auto] gap-4 items-end">
          <Field label="Report" htmlFor="movements-report">
            <Select id="movements-report" value={report.id} onChange={(e) => showReport(e.target.value as ReportId)}>
              {reports.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </Select>
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={ranged ? 'From' : 'Date'} htmlFor="movements-from">
              <Input id="movements-from" type="date" className="sm:w-44" value={from} max={ranged ? to : undefined} onChange={(e) => setParam('from', e.target.value || day)} invalid={badRange} />
            </Field>
            {ranged ? (
              <>
                <Field label="To" htmlFor="movements-to">
                  <Input id="movements-to" type="date" className="sm:w-44" value={to} min={from} onChange={(e) => setParam('to', e.target.value || from)} invalid={badRange} />
                </Field>
                <Button variant="ghost" size="sm" onClick={() => setParam('to', null)}>Single day</Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setParam('to', from)}>Add end date</Button>
            )}
          </div>
        </div>
      </div>

      <Toolbar
        className="no-print"
        left={(
          <>
            {has('supplierId') && (
              <Select value={params.get('supplierId') ?? ''} onChange={(e) => setParam('supplierId', e.target.value)} aria-label="Filter by supplier">
                <option value="">All suppliers</option>
                {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            )}
            {has('recipientId') && (
              <Select value={params.get('recipientId') ?? ''} onChange={(e) => setParam('recipientId', e.target.value)} aria-label="Filter by who it was issued to">
                <option value="">Issued to anyone</option>
                {(recipients.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                <option value="__none__">Not recorded</option>
              </Select>
            )}
            {has('locationId') && (
              <Select value={params.get('locationId') ?? ''} onChange={(e) => setParam('locationId', e.target.value)} aria-label="Filter by location">
                <option value="">All locations</option>
                {(locations.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
            {has('entityType') && (
              <Select value={params.get('entityType') ?? ''} onChange={(e) => setParam('entityType', e.target.value)} aria-label="Filter by kind of change">
                <option value="">All changes</option>
                {Object.entries(ACTIVITY_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </Select>
            )}
            {has('actorId') && (
              <Select value={params.get('actorId') ?? ''} onChange={(e) => setParam('actorId', e.target.value)} aria-label="Filter by who did it">
                <option value="">Everyone</option>
                {(actors.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            )}
            {has('materialId') && (
              <div className="w-full sm:w-64">
                <SearchSelect id="movements-item" value={params.get('materialId') ?? ''} onChange={(v) => setParam('materialId', v)} options={itemOptions} placeholder="All items" noMatchText="No item matches" />
              </div>
            )}
            {has('q') && (
              <div className="relative w-full sm:w-64">
                <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
                <Input className="pl-8" placeholder={SEARCH_HINT[report.id]} value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
              </div>
            )}
            {filtersSet && <Button variant="ghost" size="sm" onClick={() => showReport(report.id)}>Reset filters</Button>}
          </>
        )}
      />

      <h2 className="hidden print:block text-h2 mb-2">{report.label}, {from === to ? from : `${from} to ${to}`}</h2>
      {badRange ? <ErrorState message="The start date is after the end date." /> : (
        report.id === 'received' ? <ReceivedStockReport query={query} />
          : report.id === 'issued' ? <IssuedStockReport query={query} />
          : report.id === 'counts' ? <StockCountsReport query={query} />
            : report.id === 'other' ? <OtherActivity query={query} />
              : <LedgerReport kind={report.id as LedgerReportKind} query={query} />
      )}
    </div>
  );
}
