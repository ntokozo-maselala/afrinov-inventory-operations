// Stock count by location: choose a location and whose stock (Stores, or a
// project's), type what is on the shelf next to each item, and post. Each
// difference from the system becomes a COUNT_VARIANCE adjustment (POST
// /stock-counts). A spot count leaves blank items alone; a full count needs
// every item, a blank one confirmed as 0. With blind counts on, the sheet shows
// no system figures. A line whose stock moved while counting is held back for
// a recount and the rest post (system audit C4-C7, ADR-040). A half-done count
// is kept in this browser per location and stock.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field, Input, Select, Textarea } from '../components/Field';
import { Alert } from '../components/Alert';
import { ErrorState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { SearchSelect, type SearchOption } from '../components/SearchSelect';
import { usePermissions } from '../hooks/usePermissions';
import { NoAccess } from '../components/NoAccess';
import { api, type ApiError } from '../api/client';
import type { CountRecord, Material } from '../api/types';
import { formatDateTime } from '../lib/format';
import { daysAgo, today } from '../lib/dates';
import { locationLabel } from '../lib/locations';
import { useIdempotencyKey } from '../lib/idempotency';
import { StaleDataNotice } from '../components/StaleDataNotice';
import { useUnits } from '../hooks/useUnits';
import { parseQuantity, type UnitKind } from '../lib/quantity';

interface Location { id: string; name: string; active: boolean; parent?: { name: string } | null }
/** A line of the count: system null on a blind sheet; onSheet false for an item added as found. */
interface Row { materialId: string; sku: string; name: string; unit: string; system: number | null; onSheet: boolean }
/** The count sheet (GET /stock-counts/sheet). */
interface CountSheet {
  locationId: string; heldForProject: string | null; blind: boolean; openedAt: string; projects: string[];
  lines: Array<{ materialId: string; sku: string; name: string; unitOfMeasure: string; expected: string | null }>;
}
interface CountResult { adjusted: number; waitingForApproval?: number; heldBack?: Array<{ materialId: string; sku: string }> }
type CountKind = 'SPOT' | 'FULL';
interface Draft { counts: Record<string, string>; notes: Record<string, string>; extra: string[]; note: string }

const EMPTY: Draft = { counts: {}, notes: {}, extra: [], note: '' };
// Stores stock keeps the key drafts had before project stock could be counted.
const draftKey = (locationId: string, stockOf = '') => `stock-count-draft:${locationId}${stockOf ? `:${stockOf}` : ''}`;

function loadDraft(locationId: string, stockOf = ''): Draft {
  try {
    const raw = localStorage.getItem(draftKey(locationId, stockOf));
    if (!raw) return EMPTY;
    const d = JSON.parse(raw) as Partial<Draft>;
    return { counts: d.counts ?? {}, notes: d.notes ?? {}, extra: d.extra ?? [], note: d.note ?? '' };
  } catch {
    return EMPTY;
  }
}

function saveDraft(locationId: string, stockOf: string, draft: Draft) {
  try {
    if (Object.keys(draft.counts).length === 0 && Object.keys(draft.notes).length === 0 && draft.extra.length === 0 && !draft.note) localStorage.removeItem(draftKey(locationId, stockOf));
    else localStorage.setItem(draftKey(locationId, stockOf), JSON.stringify(draft));
  } catch {
    // Private windows and blocked storage: the count still works, it just is not kept.
  }
}

/** The counted number, or null when blank; NaN when it is not a usable count. */
/** What was counted: null when left blank, NaN when it can't be a count in this unit (part of a counted item, say). */
function parseCount(text: string | undefined, kind: UnitKind): number | null {
  if (text === undefined || text.trim() === '') return null;
  const parsed = parseQuantity(text, kind, '', { allowZero: true });
  return parsed.ok ? parsed.value : NaN;
}

const fmt = (n: number) => String(Math.round(n * 10000) / 10000);

export function StockCount() {
  const locations = useApi<Location[]>('/locations');
  const materials = useApi<Material[]>('/materials');
  const { kindOf } = useUnits();
  const [locationId, setLocationId] = useState('');
  // Whose stock: '' for Stores, or a project number (system audit C6).
  const [stockOf, setStockOf] = useState('');
  const [kind, setKind] = useState<CountKind>('SPOT');
  const sheetPath = locationId ? `/stock-counts/sheet?locationId=${encodeURIComponent(locationId)}${stockOf ? `&heldForProject=${encodeURIComponent(stockOf)}` : ''}` : null;
  const stock = useApi<CountSheet>(sheetPath);
  // Blind counts (inventory.blindCounts): the sheet carries no system figures at all.
  const blind = stock.data?.blind === true;
  // The last few counts here, including ones that found no differences.
  const recent = useApi<CountRecord[]>(locationId ? `/stock-counts?locationId=${encodeURIComponent(locationId)}&limit=5` : null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState('');
  const [hideSystem, setHideSystem] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; moved: boolean; blanks?: string[] } | null>(null);
  // Lines held back because their stock moved while counting (system audit C7).
  const [heldBack, setHeldBack] = useState<string[]>([]);
  const toast = useToast();
  const idem = useIdempotencyKey('stock-count');

  useEffect(() => { if (locationId) saveDraft(locationId, stockOf, draft); }, [locationId, stockOf, draft]);

  const activeLocations = useMemo(() => (locations.data ?? []).filter((l) => l.active).sort((a, b) => a.name.localeCompare(b.name)), [locations.data]);
  const location = activeLocations.find((l) => l.id === locationId);
  const materialById = useMemo(() => new Map((materials.data ?? []).map((m) => [m.id, m])), [materials.data]);

  // The sheet's items, every one with stock in the chosen stock here, and any added as found (0 on the books).
  const rows = useMemo<Row[]>(() => {
    const listed: Row[] = (stock.data?.lines ?? []).map((r) => ({ materialId: r.materialId, sku: r.sku, name: r.name, unit: r.unitOfMeasure, system: r.expected === null ? null : Number(r.expected), onSheet: true }));
    const ids = new Set(listed.map((r) => r.materialId));
    const extra = draft.extra.filter((id) => !ids.has(id)).flatMap((id) => {
      const m = materialById.get(id);
      return m ? [{ materialId: id, sku: m.sku, name: m.name, unit: m.unitOfMeasure, system: blind ? null : 0, onSheet: false }] : [];
    });
    return [...listed, ...extra].sort((a, b) => a.name.localeCompare(b.name));
  }, [stock.data, draft.extra, materialById, blind]);
  const hidden = hideSystem || blind;

  const shown = useMemo(() => {
    const terms = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return terms.length === 0 ? rows : rows.filter((r) => terms.every((t) => `${r.name} ${r.sku}`.toLowerCase().includes(t)));
  }, [rows, filter]);

  const addOptions = useMemo<SearchOption[]>(() => {
    const listed = new Set(rows.map((r) => r.materialId));
    return (materials.data ?? []).filter((m) => m.active && !listed.has(m.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => ({ value: m.id, label: `${m.name} (${m.sku})` }));
  }, [materials.data, rows]);

  const countOf = (r: Row) => parseCount(draft.counts[r.materialId], kindOf(r.unit));
  const counted = rows.filter((r) => countOf(r) !== null);
  const invalid = counted.filter((r) => Number.isNaN(countOf(r)));
  const differences = counted.filter((r) => {
    const c = countOf(r);
    return c !== null && !Number.isNaN(c) && r.system !== null && Math.abs(c - r.system) > 0.00005;
  });
  const up = differences.filter((r) => countOf(r)! > r.system!).length;
  // Stock cannot really be below zero; such a figure comes from a booking mistake, and the count corrects it.
  const belowZero = rows.filter((r) => r.system !== null && r.system < 0);
  // A full count needs every item on the sheet (system audit C5).
  const blanks = rows.filter((r) => r.onSheet && countOf(r) === null);

  function chooseLocation(id: string) {
    setLocationId(id);
    setStockOf('');
    setDraft(id ? loadDraft(id) : EMPTY);
    setFilter('');
    setConfirming(false);
    setError(null);
    setHeldBack([]);
  }

  function chooseStock(of: string) {
    setStockOf(of);
    setDraft(locationId ? loadDraft(locationId, of) : EMPTY);
    setConfirming(false);
    setError(null);
    setHeldBack([]);
  }

  /** A full count's blank items, confirmed as not found: counted as 0. */
  function countBlanksAsZero() {
    setDraft((d) => ({ ...d, counts: { ...d.counts, ...Object.fromEntries(blanks.map((r) => [r.materialId, '0'])) } }));
    setError(null);
  }

  function setLineNote(materialId: string, value: string) {
    setDraft((d) => {
      const notes = { ...d.notes };
      if (value === '') delete notes[materialId];
      else notes[materialId] = value;
      return { ...d, notes };
    });
  }

  /**
   * Whether a row offers a note: when its count differs from the system, or,
   * counting blind, once anything is counted (so the box gives nothing away).
   */
  function offersNote(r: Row): boolean {
    const c = countOf(r);
    if (c === null || Number.isNaN(c)) return false;
    return hidden || r.system === null || Math.abs(c - r.system) > 0.00005;
  }

  function setCount(materialId: string, value: string) {
    setDraft((d) => {
      const counts = { ...d.counts };
      if (value === '') delete counts[materialId];
      else counts[materialId] = value;
      return { ...d, counts };
    });
    setConfirming(false);
  }

  function addFound(materialId: string) {
    if (!materialId) return;
    setDraft((d) => ({ ...d, extra: [...d.extra, materialId] }));
    setAdding('');
  }

  function askToPost() {
    setError(null);
    if (counted.length === 0) { setError({ message: 'Type the counted quantity of at least one item.', moved: false }); return; }
    if (invalid.length > 0) { setError({ message: `Check the count for ${invalid.map((r) => r.sku).join(', ')}: enter a number of 0 or more, and a whole number for an item counted in each, pair, box and the like.`, moved: false }); return; }
    if (kind === 'FULL' && blanks.length > 0) {
      setError({ message: `A full count needs every item on the sheet. ${blanks.length} ${blanks.length === 1 ? 'is' : 'are'} blank: ${blanks.slice(0, 5).map((r) => r.sku).join(', ')}${blanks.length > 5 ? ', …' : ''}. Count ${blanks.length === 1 ? 'it' : 'them'}, or confirm ${blanks.length === 1 ? 'it was' : 'they were'} not found.`, moved: false, blanks: blanks.map((r) => r.materialId) });
      return;
    }
    setConfirming(true);
  }

  async function post() {
    setBusy(true);
    setError(null);
    const countBody = {
      locationId,
      ...(stockOf ? { heldForProject: stockOf } : {}),
      kind,
      // When the sheet was opened: movements since are held back, blind or not.
      openedAt: stock.data?.openedAt,
      note: draft.note.trim() || undefined,
      lines: counted.map((r) => {
        const lineNote = offersNote(r) ? draft.notes[r.materialId]?.trim() : '';
        return { materialId: r.materialId, ...(r.system !== null ? { expectedQuantity: r.system } : {}), countedQuantity: countOf(r)!, ...(lineNote ? { note: lineNote } : {}) };
      }),
    };
    try {
      const result = await api.post<CountResult>('/stock-counts', countBody, { idempotencyKey: idem.keyFor(countBody) });
      // Differences over the write-off limit wait for someone else's approval (ADR-028).
      const waiting = result.waitingForApproval ?? 0;
      toast.success(
        `Count posted at ${location?.name ?? 'the location'}: ${result.adjusted} adjustment${result.adjusted === 1 ? '' : 's'}`,
        waiting > 0 ? `${waiting} difference${waiting === 1 ? '' : 's'} over the write-off limit wait${waiting === 1 ? 's' : ''} for someone else to approve under Write-offs to approve.` : undefined,
      );
      idem.confirm();
      // The lines whose stock moved stay on the draft, for counting again (system audit C7).
      const back = (result.heldBack ?? []).map((h) => h.materialId);
      setHeldBack((result.heldBack ?? []).map((h) => h.sku));
      setDraft((d) => (back.length === 0 ? EMPTY : {
        ...d,
        counts: Object.fromEntries(Object.entries(d.counts).filter(([id]) => back.includes(id)).map(([id]) => [id, ''])),
        notes: Object.fromEntries(Object.entries(d.notes).filter(([id]) => back.includes(id))),
        extra: d.extra.filter((id) => back.includes(id)),
      }));
      setConfirming(false);
      stock.reload();
      recent.reload();
    } catch (err) {
      const e = err as ApiError;
      // A failed or unconfirmed attempt keeps its key so a retry replays the
      // committed count rather than posting a second one.
      idem.resolve(err);
      setError({ message: e.message, moved: e.code === 'CONFLICT' });
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  // Each required list is judged on its own: a stale result from one must not
  // conceal a hard failure in another and leave the form with an empty list.
  const sources = [locations, materials];
  const hardError = sources.find((s) => s.error && !s.stale)?.error ?? null;
  const loadFailed = hardError !== null;
  const loadStale = !loadFailed && sources.some((s) => s.stale);

  // Reached by a typed or old link: say so rather than offer a form the server would refuse.
  const allowed = usePermissions().hasPermission('inventory:count');
  if (!allowed) return <NoAccess title="Count stock" action="post stock counts" />;

  return (
    <div className="print-area">
      <PageHeader
        title="Count stock"
        description="Count what is on the shelves at one location. Differences from the system are posted as count-variance adjustments."
        breadcrumb={[{ label: 'Stock', to: '/stock' }, { label: 'Count stock' }]}
      />

      {loadFailed && <ErrorState error={hardError} onRetry={() => { locations.reload(); materials.reload(); }} />}
      {loadStale && <StaleDataNotice error={sources.find((s) => s.stale)?.error} onRetry={() => { locations.reload(); materials.reload(); }} label="Some lists could not be refreshed" />}

      {!loadFailed && (
        <div className="space-y-4">
          <div className="surface-card p-4 grid grid-cols-1 md:grid-cols-[16rem_1fr] gap-4 items-end no-print">
            <Field label="Location" htmlFor="count-location" required>
              <Select id="count-location" value={locationId} onChange={(e) => chooseLocation(e.target.value)} disabled={locations.loading}>
                <option value="">{locations.loading ? 'Loading…' : '— choose a location —'}</option>
                {activeLocations.map((l) => <option key={l.id} value={l.id}>{locationLabel(l)}</option>)}
              </Select>
            </Field>
            {locationId && (
              <div className="flex flex-wrap gap-2 md:justify-end items-end">
                <Field label="Whose stock" htmlFor="count-stock">
                  <Select id="count-stock" value={stockOf} onChange={(e) => chooseStock(e.target.value)}>
                    <option value="">Stores stock</option>
                    {(stock.data?.projects ?? (stockOf ? [stockOf] : [])).map((p) => <option key={p} value={p}>Held for {p}</option>)}
                  </Select>
                </Field>
                <Field label="Count" htmlFor="count-kind">
                  <Select id="count-kind" value={kind} onChange={(e) => { setKind(e.target.value as CountKind); setError(null); }}>
                    <option value="SPOT">Spot: the items I count</option>
                    <option value="FULL">Full: everything here</option>
                  </Select>
                </Field>
                {blind
                  ? <span className="text-sm text-surface-600 pb-2">Blind count: system quantities are not shown</span>
                  : (
                    <label className="inline-flex items-center gap-2 text-sm text-surface-700 pb-2">
                      <input type="checkbox" checked={hideSystem} onChange={(e) => setHideSystem(e.target.checked)} />
                      Hide system quantities while counting
                    </label>
                  )}
                <Button type="button" variant="secondary" leadingIcon={<Icon.Print size={14} />} onClick={() => window.print()}>Print count sheet</Button>
              </div>
            )}
          </div>

          {locationId && (
            <div className="surface-card p-4 no-print">
              <div className="flex items-center justify-between gap-3 mb-2">
                <h2 className="text-h3 text-surface-900">Recent counts here</h2>
                <Link
                  to={`/movements?report=counts&locationId=${encodeURIComponent(locationId)}&from=${daysAgo(90)}&to=${today()}`}
                  className="btn-link text-sm"
                >
                  All counts, last 90 days
                </Link>
              </div>
              {recent.loading && <p className="text-sm text-surface-500">Loading…</p>}
              {recent.error && <p className="text-sm text-danger-700">Couldn&apos;t load recent counts: {recent.error.message}</p>}
              {recent.data && recent.data.length === 0 && <p className="text-sm text-surface-500">No counts recorded here yet.</p>}
              {recent.data && recent.data.length > 0 && (
                <ul className="text-sm divide-y divide-surface-200">
                  {recent.data.map((c) => (
                    <li key={c.id} className="py-1.5 flex flex-wrap gap-x-3">
                      <span className="text-meta whitespace-nowrap">{formatDateTime(c.at)}</span>
                      <span>{c.kind === 'FULL' ? 'Full count' : 'Spot count'}{c.heldForProject ? ` of ${c.heldForProject}'s stock` : ''}: {c.counted} item{c.counted === 1 ? '' : 's'} counted, {c.adjusted === 0 ? 'no differences' : `${c.adjusted} adjusted`}{c.note ? ` (${c.note})` : ''}</span>
                      <span className="text-meta">by {c.countedByName}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {locationId && stock.error && !stock.stale && <ErrorState error={stock.error} onRetry={stock.reload} />}
          {locationId && stock.stale && <StaleDataNotice error={stock.error} onRetry={stock.reload} />}

          {locationId && (!stock.error || stock.stale) && (
            <>
              <div className="hidden print:block">
                <h1>Stock count: {location?.name}</h1>
                <p>Date: ____________ Counted by: ______________________</p>
              </div>

              <div className="surface-card p-4 space-y-3">
                <div className="flex flex-wrap items-end gap-3 no-print">
                  <Field label="Find an item" htmlFor="count-filter" className="flex-1 min-w-56">
                    <Input id="count-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Name or code" />
                  </Field>
                  <p className="text-sm text-surface-600 pb-2" aria-live="polite">
                    {counted.length} of {rows.length} counted · {differences.length} difference{differences.length === 1 ? '' : 's'}
                  </p>
                </div>

                {belowZero.length > 0 && !hidden && (
                  <Alert tone="warning" title={`${belowZero.length} item${belowZero.length === 1 ? ' shows' : 's show'} below zero here`}>
                    Stock can never really be below zero, so these figures come from a booking mistake. Count these items carefully:
                    posting the count sets them to what is on the shelf.
                  </Alert>
                )}

                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Item</th>
                        <th scope="col">Code</th>
                        <th scope="col">Unit</th>
                        <th scope="col" className={`text-right print:hidden ${hidden ? 'hidden' : ''}`}>System</th>
                        <th scope="col" className="text-right">Counted</th>
                        <th scope="col" className={`text-right print:hidden ${hidden ? 'hidden' : ''}`}>Difference</th>
                        <th scope="col">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stock.loading && <tr><td colSpan={7} className="text-surface-500">Loading stock…</td></tr>}
                      {!stock.loading && shown.length === 0 && (
                        <tr><td colSpan={7} className="text-surface-500">{rows.length === 0 ? (stockOf ? `Nothing is held for ${stockOf} here. Add any items you find below.` : 'Nothing is booked at this location. Add any items you find below.') : 'No item matches.'}</td></tr>
                      )}
                      {!stock.loading && shown.map((r) => {
                        const c = countOf(r);
                        const diff = c === null || Number.isNaN(c) || r.system === null ? null : c - r.system;
                        return (
                          <tr key={r.materialId}>
                            <td>
                              {r.name}
                              {r.system !== null && r.system < 0 && !hidden && <span className="block text-xs text-danger-600 print:hidden">Below zero: cannot be right</span>}
                            </td>
                            <td className="text-surface-600">{r.sku}</td>
                            <td className="text-surface-600">{r.unit}</td>
                            <td className={`text-right tabular-nums print:hidden ${hidden ? 'hidden' : ''} ${r.system !== null && r.system < 0 ? 'text-danger-600 font-medium' : ''}`}>{r.system === null ? '' : fmt(r.system)}</td>
                            <td className="text-right">
                              <span className="hidden print:inline">____________</span>
                              <Input
                                aria-label={`Counted ${r.name}`}
                                className="w-28 ml-auto text-right print:hidden"
                                type="text"
                                inputMode={kindOf(r.unit) === 'COUNTED' ? 'numeric' : 'decimal'}
                                value={draft.counts[r.materialId] ?? ''}
                                onChange={(e) => setCount(r.materialId, e.target.value)}
                                invalid={c !== null && Number.isNaN(c)}
                              />
                            </td>
                            <td className={`text-right tabular-nums print:hidden ${hidden ? 'hidden' : ''} ${diff && diff < 0 ? 'text-danger-600' : diff && diff > 0 ? 'text-success-600' : 'text-surface-500'}`}>
                              {diff === null ? '' : Math.abs(diff) < 0.00005 ? '✓' : `${diff > 0 ? '+' : ''}${fmt(diff)}`}
                            </td>
                            <td>
                              <span className="hidden print:inline">______________________</span>
                              {offersNote(r) && (
                                <Input
                                  aria-label={`Note for ${r.name}`}
                                  className="w-48 print:hidden"
                                  maxLength={200}
                                  value={draft.notes[r.materialId] ?? ''}
                                  onChange={(e) => setLineNote(r.materialId, e.target.value)}
                                  placeholder="Why it differs"
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="no-print pt-2 md:w-1/2">
                  <Field
                    label="Found an item that is not listed?"
                    htmlFor="count-add"
                    help="It is added to the list with a system quantity of 0. Type what you counted there, and add a note if needed."
                  >
                    <SearchSelect id="count-add" value={adding} onChange={addFound} options={addOptions} placeholder="Search by name or code" noMatchText="No other item matches" />
                  </Field>
                </div>
              </div>

              {heldBack.length > 0 && (
                <Alert tone="warning" title={`${heldBack.length} item${heldBack.length === 1 ? '' : 's'} moved while you were counting`}>
                  The rest of the count posted. {heldBack.join(', ')} {heldBack.length === 1 ? 'was' : 'were'} held back: count {heldBack.length === 1 ? 'it' : 'them'} again and post.
                </Alert>
              )}

              {error && (
                <Alert tone="danger" title={error.moved ? 'Stock moved while you were counting' : 'Cannot post the count'}>
                  <p>{error.message}</p>
                  {error.blanks && error.blanks.length > 0 && (
                    <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={countBlanksAsZero}>
                      Not found: count the {error.blanks.length} blank item{error.blanks.length === 1 ? '' : 's'} as 0
                    </Button>
                  )}
                  {error.moved && (
                    <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => { setError(null); stock.reload(); }}>
                      Reload system quantities
                    </Button>
                  )}
                </Alert>
              )}

              {confirming && (
                <Alert tone="warning" title="Post this count?">
                  {blind
                    ? `${counted.length} item${counted.length === 1 ? '' : 's'} counted at ${location?.name}. Differences from the system are worked out when it posts.${kind === 'SPOT' ? ' Items left blank are not changed.' : ''}`
                    : differences.length === 0
                      ? `All ${counted.length} counted items match the system, so nothing will change. The count is recorded.`
                      : `${differences.length} adjustment${differences.length === 1 ? '' : 's'} will be posted at ${location?.name}: ${up} up, ${differences.length - up} down.${kind === 'SPOT' ? ' Items left blank are not changed.' : ''}`}
                </Alert>
              )}

              {/* About the whole count, so it sits with posting it, apart from the item search. */}
              <div className="no-print">
                <Field label="Note on this count (optional)" htmlFor="count-note" help="Applies to the whole count; use a row's note to explain one item.">
                  <Textarea id="count-note" rows={2} maxLength={500} value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} placeholder="e.g. Go-live count, rack A" />
                </Field>
              </div>

              <div className="entry-actions flex flex-wrap justify-end gap-2 py-3 border-t border-surface-200 no-print">
                <Link to="/stock"><Button type="button" variant="ghost" disabled={busy}>Back to stock</Button></Link>
                {confirming ? (
                  <>
                    <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Keep counting</Button>
                    <Button type="button" variant="primary" onClick={post} loading={busy}>Post count</Button>
                  </>
                ) : (
                  <Button type="button" variant="primary" onClick={askToPost} disabled={stock.loading}>Post count</Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
