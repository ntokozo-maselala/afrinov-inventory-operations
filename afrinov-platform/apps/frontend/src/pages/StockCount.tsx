// Stock count by location: choose a location, type what is on the shelf next
// to each item, and post. Each difference from the system becomes a
// COUNT_VARIANCE adjustment (POST /stock-counts). Items left blank are not
// touched. A half-done count is kept in this browser per location, and the
// count sheet prints without the system quantities, for counting blind.
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
import { api, type ApiError } from '../api/client';
import type { CurrentStockRow, Material } from '../api/types';

interface Location { id: string; name: string; active: boolean }
interface Row { materialId: string; sku: string; name: string; unit: string; system: number }
interface Draft { counts: Record<string, string>; extra: string[]; note: string }

const EMPTY: Draft = { counts: {}, extra: [], note: '' };
const draftKey = (locationId: string) => `stock-count-draft:${locationId}`;

function loadDraft(locationId: string): Draft {
  try {
    const raw = localStorage.getItem(draftKey(locationId));
    if (!raw) return EMPTY;
    const d = JSON.parse(raw) as Partial<Draft>;
    return { counts: d.counts ?? {}, extra: d.extra ?? [], note: d.note ?? '' };
  } catch {
    return EMPTY;
  }
}

function saveDraft(locationId: string, draft: Draft) {
  try {
    if (Object.keys(draft.counts).length === 0 && draft.extra.length === 0 && !draft.note) localStorage.removeItem(draftKey(locationId));
    else localStorage.setItem(draftKey(locationId), JSON.stringify(draft));
  } catch {
    // Private windows and blocked storage: the count still works, it just is not kept.
  }
}

/** The counted number, or null when blank; NaN when it is not a usable count. */
function parseCount(text: string | undefined): number | null {
  if (text === undefined || text.trim() === '') return null;
  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

const fmt = (n: number) => String(Math.round(n * 10000) / 10000);

export function StockCount() {
  const locations = useApi<Location[]>('/locations');
  const materials = useApi<Material[]>('/materials');
  const [locationId, setLocationId] = useState('');
  const stock = useApi<CurrentStockRow[]>(locationId ? `/reports/current-stock?locationId=${encodeURIComponent(locationId)}` : null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState('');
  const [hideSystem, setHideSystem] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; moved: boolean } | null>(null);
  const toast = useToast();

  useEffect(() => { if (locationId) saveDraft(locationId, draft); }, [locationId, draft]);

  const activeLocations = useMemo(() => (locations.data ?? []).filter((l) => l.active).sort((a, b) => a.name.localeCompare(b.name)), [locations.data]);
  const location = activeLocations.find((l) => l.id === locationId);
  const materialById = useMemo(() => new Map((materials.data ?? []).map((m) => [m.id, m])), [materials.data]);

  const rows = useMemo<Row[]>(() => {
    const listed = (stock.data ?? []).map((r) => ({ materialId: r.materialId, sku: r.materialSku, name: r.materialName, unit: r.unitOfMeasure, system: Number(r.quantity) }));
    const ids = new Set(listed.map((r) => r.materialId));
    const extra = draft.extra.filter((id) => !ids.has(id)).flatMap((id) => {
      const m = materialById.get(id);
      return m ? [{ materialId: id, sku: m.sku, name: m.name, unit: m.unitOfMeasure, system: 0 }] : [];
    });
    return [...listed, ...extra].sort((a, b) => a.name.localeCompare(b.name));
  }, [stock.data, draft.extra, materialById]);

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

  const counted = rows.filter((r) => parseCount(draft.counts[r.materialId]) !== null);
  const invalid = counted.filter((r) => Number.isNaN(parseCount(draft.counts[r.materialId])));
  const differences = counted.filter((r) => {
    const c = parseCount(draft.counts[r.materialId]);
    return c !== null && !Number.isNaN(c) && Math.abs(c - r.system) > 0.00005;
  });
  const up = differences.filter((r) => parseCount(draft.counts[r.materialId])! > r.system).length;
  // Stock cannot really be below zero; such a figure comes from a booking mistake, and the count corrects it.
  const belowZero = rows.filter((r) => r.system < 0);

  function chooseLocation(id: string) {
    setLocationId(id);
    setDraft(id ? loadDraft(id) : EMPTY);
    setFilter('');
    setConfirming(false);
    setError(null);
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
    if (invalid.length > 0) { setError({ message: `Check the count for ${invalid.map((r) => r.sku).join(', ')}: enter a number of 0 or more.`, moved: false }); return; }
    setConfirming(true);
  }

  async function post() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ adjusted: number }>('/stock-counts', {
        locationId,
        note: draft.note.trim() || undefined,
        lines: counted.map((r) => ({ materialId: r.materialId, expectedQuantity: r.system, countedQuantity: parseCount(draft.counts[r.materialId])! })),
      });
      toast.success(`Count posted at ${location?.name ?? 'the location'}: ${result.adjusted} adjustment${result.adjusted === 1 ? '' : 's'}`);
      setDraft(EMPTY);
      setConfirming(false);
      stock.reload();
    } catch (err) {
      const e = err as ApiError;
      setError({ message: e.message, moved: e.code === 'CONFLICT' });
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const loadError = locations.error ?? materials.error;

  return (
    <div className="print-area">
      <PageHeader
        title="Count stock"
        description="Count what is on the shelves at one location. Differences from the system are posted as count-variance adjustments."
        breadcrumb={[{ label: 'Stock', to: '/stock' }, { label: 'Count stock' }]}
      />

      {loadError && <ErrorState message={loadError.message} onRetry={() => { locations.reload(); materials.reload(); }} />}

      {!loadError && (
        <div className="space-y-4">
          <div className="surface-card p-4 grid grid-cols-1 md:grid-cols-[16rem_1fr] gap-4 items-end no-print">
            <Field label="Location" htmlFor="count-location" required>
              <Select id="count-location" value={locationId} onChange={(e) => chooseLocation(e.target.value)} disabled={locations.loading}>
                <option value="">{locations.loading ? 'Loading…' : '— choose a location —'}</option>
                {activeLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            {locationId && (
              <div className="flex flex-wrap gap-2 md:justify-end">
                <label className="inline-flex items-center gap-2 text-sm text-surface-700">
                  <input type="checkbox" checked={hideSystem} onChange={(e) => setHideSystem(e.target.checked)} />
                  Hide system quantities while counting
                </label>
                <Button type="button" variant="secondary" leadingIcon={<Icon.Print size={14} />} onClick={() => window.print()}>Print count sheet</Button>
              </div>
            )}
          </div>

          {locationId && stock.error && <ErrorState message={stock.error.message} onRetry={stock.reload} />}

          {locationId && !stock.error && (
            <>
              <div className="hidden print:block">
                <h1>Stock count: {location?.name}</h1>
                <p>Date: ____________ Counted by: ______________________</p>
              </div>

              <div className="surface-card p-4 space-y-3">
                <div className="flex flex-wrap items-end gap-3 no-print">
                  <Field label="Find an item" htmlFor="count-filter" className="flex-1 min-w-[14rem]">
                    <Input id="count-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Name or code" />
                  </Field>
                  <p className="text-sm text-surface-600 pb-2" aria-live="polite">
                    {counted.length} of {rows.length} counted · {differences.length} difference{differences.length === 1 ? '' : 's'}
                  </p>
                </div>

                {belowZero.length > 0 && !hideSystem && (
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
                        <th scope="col" className={`text-right print:hidden ${hideSystem ? 'hidden' : ''}`}>System</th>
                        <th scope="col" className="text-right">Counted</th>
                        <th scope="col" className={`text-right print:hidden ${hideSystem ? 'hidden' : ''}`}>Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stock.loading && <tr><td colSpan={6} className="text-surface-500">Loading stock…</td></tr>}
                      {!stock.loading && shown.length === 0 && (
                        <tr><td colSpan={6} className="text-surface-500">{rows.length === 0 ? 'Nothing is booked at this location. Add any items you find below.' : 'No item matches.'}</td></tr>
                      )}
                      {!stock.loading && shown.map((r) => {
                        const c = parseCount(draft.counts[r.materialId]);
                        const diff = c === null || Number.isNaN(c) ? null : c - r.system;
                        return (
                          <tr key={r.materialId}>
                            <td>
                              {r.name}
                              {r.system < 0 && !hideSystem && <span className="block text-xs text-danger-600 print:hidden">Below zero: cannot be right</span>}
                            </td>
                            <td className="text-surface-600">{r.sku}</td>
                            <td className="text-surface-600">{r.unit}</td>
                            <td className={`text-right tabular-nums print:hidden ${hideSystem ? 'hidden' : ''} ${r.system < 0 ? 'text-danger-600 font-medium' : ''}`}>{fmt(r.system)}</td>
                            <td className="text-right">
                              <span className="hidden print:inline">____________</span>
                              <Input
                                aria-label={`Counted ${r.name}`}
                                className="w-28 ml-auto text-right print:hidden"
                                type="text"
                                inputMode="decimal"
                                value={draft.counts[r.materialId] ?? ''}
                                onChange={(e) => setCount(r.materialId, e.target.value)}
                                invalid={c !== null && Number.isNaN(c)}
                              />
                            </td>
                            <td className={`text-right tabular-nums print:hidden ${hideSystem ? 'hidden' : ''} ${diff && diff < 0 ? 'text-danger-600' : diff && diff > 0 ? 'text-success-600' : 'text-surface-500'}`}>
                              {diff === null ? '' : Math.abs(diff) < 0.00005 ? '✓' : `${diff > 0 ? '+' : ''}${fmt(diff)}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="no-print grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <Field label="Found an item that is not listed?" htmlFor="count-add" help="It is added with a system quantity of 0.">
                    <SearchSelect id="count-add" value={adding} onChange={addFound} options={addOptions} placeholder="Search by name or code" noMatchText="No other item matches" />
                  </Field>
                  <Field label="Note (optional)" htmlFor="count-note">
                    <Textarea id="count-note" rows={2} maxLength={500} value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} placeholder="e.g. Go-live count, rack A" />
                  </Field>
                </div>
              </div>

              {error && (
                <Alert tone="danger" title={error.moved ? 'Stock moved while you were counting' : 'Cannot post the count'}>
                  <p>{error.message}</p>
                  {error.moved && (
                    <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => { setError(null); stock.reload(); }}>
                      Reload system quantities
                    </Button>
                  )}
                </Alert>
              )}

              {confirming && (
                <Alert tone="warning" title="Post this count?">
                  {differences.length === 0
                    ? `All ${counted.length} counted items match the system, so nothing will change. The count is recorded.`
                    : `${differences.length} adjustment${differences.length === 1 ? '' : 's'} will be posted at ${location?.name}: ${up} up, ${differences.length - up} down. Items left blank are not changed.`}
                </Alert>
              )}

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
