// Movements: the shop's records as reports. Choose a report and a day (or add
// an end date for a range) and narrow it with the filters that report has.
// Every record has one home: receipts under Received stock, issues under Issued
// stock, count differences under Stock counts, transfers under Transfers, other
// adjustments under Write-offs, tools lent and back under Tool loans,
// catalogue and user changes under Other changes
// (Admin and Store Controller); All movements is the full ledger. The report,
// day and filters live in the address, so a report can be bookmarked or shared.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { useDebounced } from '../hooks/useDebounced';
import { PageHeader } from '../components/PageHeader';
import { FilterBar, SearchField, FILTER_WIDTH } from '../components/FilterBar';
import { Field, Input, Select } from '../components/Field';
import { Button } from '../components/Button';
import { ErrorState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { DownloadMenu, type DownloadFormat } from '../components/DownloadMenu';
import { SearchSelect, type SearchOption } from '../components/SearchSelect';
import { LedgerReport, type LedgerReportKind } from '../components/reports/LedgerReport';
import { ReceivedStockReport } from '../components/reports/ReceivedStockReport';
import { IssuedStockReport } from '../components/reports/IssuedStockReport';
import { StockCountsReport } from '../components/reports/StockCountsReport';
import type { ReportView } from '../components/reports/ReportView';
import { OtherActivity, ACTIVITY_TYPE_LABEL } from '../components/OtherActivity';
import { downloadMovements, downloadMovementsPdf } from '../api/exportMovements';
import {
  downloadIssuedStock, downloadIssuedStockPdf, downloadReceivedStock, downloadReceivedStockPdf, downloadStockCounts, downloadStockCountsPdf,
} from '../api/exportReports';
import type { Material } from '../api/types';
import { useCanViewActivity } from '../hooks/usePermissions';
import { today } from '../lib/dates';
import { formatDate } from '../lib/format';
import { locationLabel } from '../lib/locations';

type Filter = 'recipientId' | 'locationId' | 'actorId' | 'materialId' | 'supplierId' | 'entityType' | 'q';
type ReportId = 'all' | 'received' | 'issued' | 'returned' | 'counts' | 'transfers' | 'writeoffs' | 'loans' | 'other';

const REPORTS: Array<{ id: ReportId; label: string; filters: Filter[] }> = [
  { id: 'all', label: 'All movements', filters: ['locationId', 'actorId', 'materialId', 'q'] },
  { id: 'received', label: 'Received stock', filters: ['supplierId', 'locationId', 'q'] },
  { id: 'issued', label: 'Issued stock', filters: ['recipientId', 'locationId', 'actorId', 'materialId', 'q'] },
  // Dated when the stock came back, so a return shows in its own period even when the issue was earlier.
  { id: 'returned', label: 'Returned stock', filters: ['recipientId', 'locationId', 'materialId', 'q'] },
  { id: 'counts', label: 'Stock counts', filters: ['locationId'] },
  { id: 'transfers', label: 'Transfers', filters: ['actorId', 'materialId'] },
  { id: 'writeoffs', label: 'Write-offs and adjustments', filters: ['locationId', 'actorId', 'materialId'] },
  { id: 'loans', label: 'Tools check in/out', filters: ['recipientId', 'materialId', 'locationId'] },
  { id: 'other', label: 'Other changes', filters: ['entityType', 'actorId'] },
];

const SEARCH_HINT: Partial<Record<ReportId, string>> = {
  all: 'Search item, location, project, recipient…',
  issued: 'Search item, location, project, recipient…',
  returned: 'Search item, location, project, who returned it…',
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
  // Received, issued and counts read as a flat table unless cards are asked for.
  const view: ReportView = params.get('view') === 'cards' ? 'cards' : 'table';

  // What every request of this report shares: the day or range, and its filters.
  const queryParams = new URLSearchParams({ from, to });
  for (const f of report.filters) { const v = params.get(f); if (v) queryParams.set(f, v); }
  // A room "with the racks inside" covers the room and the locations inside it.
  if (report.filters.includes('locationId') && queryParams.has('locationId') && params.get('inside') === 'true') queryParams.set('inside', 'true');
  const query = queryParams.toString();

  const ledgerActors = has('actorId') && report.id !== 'other';
  const locations = useApi<Array<Option & { parentId?: string | null; parent?: { name: string } | null }>>(has('locationId') ? '/locations' : null);
  // Rooms with locations inside them, offered "with the racks inside" (inside=true).
  const rooms = (locations.data ?? []).filter((l) => (locations.data ?? []).some((x) => x.parentId === l.id));
  const inside = params.get('inside') === 'true';
  const suppliers = useApi<Option[]>(has('supplierId') ? '/suppliers' : null);
  const recipients = useApi<Option[]>(has('recipientId') ? '/recipients' : null);
  const materials = useApi<Material[]>(has('materialId') ? '/materials' : null);
  const actors = useApi<Option[]>(!has('actorId') ? null : ledgerActors ? '/inventory-transactions/actors' : '/activity/actors');
  const itemOptions = useMemo<SearchOption[]>(() => (materials.data ?? [])
    .map((m) => ({ value: m.id, label: `${m.name} (${m.sku})` }))
    .sort((a, b) => a.label.localeCompare(b.label)), [materials.data]);

  const [search, setSearch] = useState(params.get('q') ?? '');
  const debouncedSearch = useDebounced(search, 300);

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
    if (view === 'cards') keep.set('view', 'cards');
    setSearch('');
    setParams(keep, { replace: true });
  }

  /** A location, or a room with the racks inside it ("inside:<id>"). */
  function chooseLocation(value: string) {
    setParams((p) => {
      const next = new URLSearchParams(p);
      const id = value.startsWith('inside:') ? value.slice('inside:'.length) : value;
      if (id) next.set('locationId', id); else next.delete('locationId');
      if (value.startsWith('inside:')) next.set('inside', 'true'); else next.delete('inside');
      return next;
    }, { replace: true });
  }

  const showView = (v: ReportView) => setParam('view', v === 'cards' ? 'cards' : null);

  // Tools are checked out to someone; stock is issued to them, and returned by them.
  const recipientLabel = report.id === 'loans' ? 'Checked out to' : report.id === 'returned' ? 'Returned by' : 'Issued to';

  /** The filters that are set, in words, for the top of the PDF. */
  function filterWords(): string[] {
    const name = (list: Option[] | null | undefined, id: string) => (list ?? []).find((o) => o.id === id)?.name ?? id;
    const words: string[] = [];
    for (const f of report.filters) {
      const v = params.get(f);
      if (!v) continue;
      if (f === 'supplierId') words.push(`Supplier: ${name(suppliers.data, v)}`);
      else if (f === 'recipientId') words.push(`${recipientLabel}: ${v === '__none__' ? 'Not recorded' : name(recipients.data, v)}`);
      else if (f === 'locationId') words.push(`Location: ${name(locations.data, v)}${inside ? ' and the locations inside it' : ''}`);
      else if (f === 'actorId') words.push(`Person: ${name(actors.data, v)}`);
      else if (f === 'materialId') words.push(`Item: ${itemOptions.find((o) => o.value === v)?.label ?? v}`);
      else if (f === 'q') words.push(`Search: "${v}"`);
    }
    return words;
  }

  async function download(format: DownloadFormat) {
    if (format === 'pdf') {
      const words = filterWords();
      const about = { title: `${report.label}, ${from === to ? formatDate(from) : `${formatDate(from)} to ${formatDate(to)}`}`, lines: words.length ? [words.join('  ·  ')] : [] };
      if (report.id === 'received') await downloadReceivedStockPdf(query, about);
      else if (report.id === 'issued') await downloadIssuedStockPdf(query, about);
      else if (report.id === 'counts') await downloadStockCountsPdf(query, about);
      else if (report.id !== 'other') await downloadMovementsPdf(query, report.id, about);
      return;
    }
    if (report.id === 'received') await downloadReceivedStock(query);
    else if (report.id === 'issued') await downloadIssuedStock(query);
    else if (report.id === 'counts') await downloadStockCounts(query);
    else await downloadMovements(report.id === 'all' ? query : `${query}&report=${report.id}`);
  }

  const filtersSet = report.filters.some((f) => params.get(f));

  return (
    <div>
      <PageHeader
        title="Movements"
        description="The shop's records by report: choose what to see and the day, then narrow it down."
        actions={(
          <div className="flex gap-2 no-print">
            {report.id !== 'other' && <DownloadMenu onDownload={download} disabled={badRange} />}
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

      <FilterBar onClear={filtersSet ? () => showReport(report.id) : undefined}>
        {has('supplierId') && (
          <Field label="Supplier" htmlFor="mv-supplier" className={FILTER_WIDTH}>
            <Select id="mv-supplier" value={params.get('supplierId') ?? ''} onChange={(e) => setParam('supplierId', e.target.value)}>
              <option value="">All suppliers</option>
              {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        )}
        {has('recipientId') && (
          <Field label={recipientLabel} htmlFor="mv-recipient" className={FILTER_WIDTH}>
            <Select id="mv-recipient" value={params.get('recipientId') ?? ''} onChange={(e) => setParam('recipientId', e.target.value)}>
              <option value="">Anyone</option>
              {(recipients.data ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              <option value="__none__">Not recorded</option>
            </Select>
          </Field>
        )}
        {has('locationId') && (
          <Field label="Location" htmlFor="mv-location" className={FILTER_WIDTH}>
            <Select
              id="mv-location"
              value={params.get('locationId') ? `${inside ? 'inside:' : ''}${params.get('locationId')}` : ''}
              onChange={(e) => chooseLocation(e.target.value)}
            >
              <option value="">All locations</option>
              {rooms.length > 0 && (
                <optgroup label="Rooms, with the racks inside">
                  {rooms.map((r) => <option key={`inside:${r.id}`} value={`inside:${r.id}`}>{r.name} and its racks</option>)}
                </optgroup>
              )}
              <optgroup label={rooms.length > 0 ? 'One location' : 'Locations'}>
                {(locations.data ?? []).map((l) => <option key={l.id} value={l.id}>{locationLabel(l)}</option>)}
              </optgroup>
            </Select>
          </Field>
        )}
        {has('entityType') && (
          <Field label="Kind of change" htmlFor="mv-kind" className={FILTER_WIDTH}>
            <Select id="mv-kind" value={params.get('entityType') ?? ''} onChange={(e) => setParam('entityType', e.target.value)}>
              <option value="">All changes</option>
              {Object.entries(ACTIVITY_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
        )}
        {has('actorId') && (
          <Field label="Person" htmlFor="mv-person" className={FILTER_WIDTH}>
            <Select id="mv-person" value={params.get('actorId') ?? ''} onChange={(e) => setParam('actorId', e.target.value)}>
              <option value="">Everyone</option>
              {(actors.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
        )}
        {has('materialId') && (
          <Field label="Item" htmlFor="movements-item" className={FILTER_WIDTH}>
            <SearchSelect id="movements-item" value={params.get('materialId') ?? ''} onChange={(v) => setParam('materialId', v)} options={itemOptions} placeholder="All items" noMatchText="No item matches" />
          </Field>
        )}
        {has('q') && <SearchField id="mv-search" value={search} onChange={setSearch} placeholder={SEARCH_HINT[report.id] ?? ''} />}
      </FilterBar>

      <h2 className="hidden print:block text-h2 mb-2">{report.label}, {from === to ? from : `${from} to ${to}`}</h2>
      {badRange ? <ErrorState message="The start date is after the end date." /> : (
        report.id === 'received' ? <ReceivedStockReport query={query} view={view} onView={showView} />
          : report.id === 'issued' ? <IssuedStockReport query={query} view={view} onView={showView} />
          : report.id === 'counts' ? <StockCountsReport query={query} view={view} onView={showView} />
            : report.id === 'other' ? <OtherActivity query={query} />
              : <LedgerReport kind={report.id as LedgerReportKind} query={query} />
      )}
    </div>
  );
}
