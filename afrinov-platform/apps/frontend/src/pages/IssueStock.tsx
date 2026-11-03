// Issue stock at the store counter: one recipient, an optional project, and
// any number of items, booked all-or-nothing (POST /inventory-issues).
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field, Input } from '../components/Field';
import { SearchSelect, type SearchOption } from '../components/SearchSelect';
import { Alert } from '../components/Alert';
import { ErrorState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import { RecipientSelect, ProjectSelect, useIssueOptions } from '../components/IssueFields';
import { usePermissions } from '../hooks/usePermissions';
import { NoAccess } from '../components/NoAccess';
import { api, type ApiError } from '../api/client';
import { today } from '../lib/dates';
import { useIdempotencyKey } from '../lib/idempotency';
import type { CurrentStockRow } from '../api/types';
import { needsProject, sectionOf } from '../lib/categories';
import { isStoresStock, balanceKey } from '../lib/heldFor';
import { useLocationLabel } from '../hooks/useLocationLabel';
import { StaleDataNotice } from '../components/StaleDataNotice';


interface Line { key: number; stockKey: string; quantity: string }

// One option per balance: an item at a location, Stores stock or a project's own.
const stockKey = balanceKey;

// A completed or cancelled project takes no more stock: its leftovers go to Stores.
const isClosed = (status: string | undefined) => status === 'COMPLETED' || status === 'CANCELLED';

/**
 * The project a row's stock goes to: the one it is held for, or, for a
 * leftover (Stores stock of a Projects item), the item's project. Null for
 * Stores stock anyone may take (Project Material Through the Store Roadmap, Phase 3).
 */
const projectOf = (r: CurrentStockRow): string | null =>
  r.heldForProject || (sectionOf(r.category) === 'PROJECTS' ? r.projectNumber ?? null : null);

const isProjectMaterial = (r: CurrentStockRow, projectNumber: string) => projectOf(r) === projectNumber;

let nextKey = 1;
const emptyLine = (): Line => ({ key: nextKey++, stockKey: '', quantity: '' });

export function IssueStock() {
  const stock = useApi<CurrentStockRow[]>('/reports/current-stock');
  const { recipients, projects, loading, error: optionsError, reload: reloadOptions } = useIssueOptions();
  const [recipientId, setRecipientId] = useState('');
  const [projectNumber, setProjectNumber] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  // The line just added with "Add another item", so its search box gets focus.
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The issue just posted, kept on the page (a toast fades) with a way to its slip.
  const [last, setLast] = useState<{ who: string; recipientId: string; count: number } | null>(null);
  const toast = useToast();
  const locationName = useLocationLabel();
  const idem = useIdempotencyKey('issue-stock');

  // Only items with stock can be issued, and tools are lent on the Tools page
  // instead. Nor from a deactivated item or location, which the server refuses
  // (Qodo, PR #132). Stores stock follows its item: a closed project's leftovers
  // wait to move to Stores, and a Projects item with no project isn't issued.
  // Stock held for a project is that project's, whatever its item says, and is
  // offered while that project takes issues: active, and neither completed nor
  // cancelled (Qodo, PR #145).
  const takesIssues = useMemo(() => new Set(projects.filter((p) => !isClosed(p.status)).map((p) => p.projectNumber)), [projects]);
  const available = useMemo(
    () => (stock.data ?? []).filter((r) => Number(r.quantity) > 0 && r.category !== 'TOOLS'
      && r.materialActive !== false && r.locationActive !== false
      && (isStoresStock(r)
        ? !needsProject(r) && !(sectionOf(r.category) === 'PROJECTS' && isClosed(r.project?.status))
        : takesIssues.has(r.heldForProject!)))
      .sort((a, b) => a.materialName.localeCompare(b.materialName) || a.locationName.localeCompare(b.locationName)),
    [stock.data, takesIssues],
  );
  const byKey = useMemo(() => new Map(available.map((r) => [stockKey(r), r])), [available]);

  // Project material goes only to its own project: a line holding some (held
  // for the project, or a leftover) sets the issue's project, which can't change
  // while it is there. Once the issue has a project, only that project's
  // material is offered: no Stores items, and no other project's material.
  const lockedBy = lines.map((l) => byKey.get(l.stockKey)).find((r) => r && projectOf(r));
  const issueProject = (lockedBy && projectOf(lockedBy)) || projectNumber;
  const itemOptions = useMemo<SearchOption[]>(() => available
    .filter((r) => !issueProject || isProjectMaterial(r, issueProject))
    .map((r) => ({
      value: stockKey(r),
      label: `${r.materialName} (${r.materialSku}) · ${locationName(r.locationId, r.locationName)}${r.heldForProject ? ` · held for ${r.heldForProject}` : ''}`,
      detail: `${r.quantity} ${r.unitOfMeasure} on hand`,
    })), [available, issueProject, locationName]);
  const projectOptions = useMemo(() => {
    const open = projects.filter((p) => !isClosed(p.status));
    const locked = lockedBy && projectOf(lockedBy);
    return locked && !open.some((p) => p.projectNumber === locked)
      ? [{ projectNumber: locked, name: lockedBy?.heldForProject ? null : lockedBy?.project?.name ?? null }, ...open]
      : open;
  }, [projects, lockedBy]);

  // An item's page links here with ?materialId=: once stock has loaded, the
  // first line starts on that item, at the location that holds the most.
  const [params] = useSearchParams();
  const [preset, setPreset] = useState(() => params.get('materialId'));
  if (preset && stock.data) {
    setPreset(null);
    const best = available.filter((r) => r.materialId === preset).sort((a, b) => Number(b.quantity) - Number(a.quantity))[0];
    if (best) setLines([{ ...emptyLine(), stockKey: stockKey(best) }]);
  }

  // Requested per item and location, across lines, to warn before submitting.
  const requested = new Map<string, number>();
  for (const l of lines) {
    if (l.stockKey && Number(l.quantity) > 0) requested.set(l.stockKey, (requested.get(l.stockKey) ?? 0) + Number(l.quantity));
  }
  const overIssued = new Set([...requested].filter(([k, q]) => q > Number(byKey.get(k)?.quantity ?? 0)).map(([k]) => k));

  function update(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  // Picking a project drops the Stores lines already chosen, which it no longer
  // offers. (The project can't change while a line holds project material.)
  function chooseProject(next: string) {
    setProjectNumber(next);
    if (!next) return;
    setLines((ls) => {
      const kept = ls.filter((l) => { const r = byKey.get(l.stockKey); return !l.stockKey || (r && isProjectMaterial(r, next)); });
      return kept.length > 0 ? kept : [emptyLine()];
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const filled = lines.filter((l) => l.stockKey || l.quantity);
    if (!recipientId) { setError('Choose who the stock is issued to.'); return; }
    if (filled.length === 0) { setError('Add at least one item.'); return; }
    if (filled.some((l) => !l.stockKey || !(Number(l.quantity) > 0))) { setError('Every line needs an item and a quantity above zero.'); return; }
    if (overIssued.size > 0) { setError('Some lines ask for more than is in stock.'); return; }

    setBusy(true);
    try {
      const issueBody = {
        recipientId,
        projectNumber: issueProject || undefined,
        lines: filled.map((l) => {
          const r = byKey.get(l.stockKey)!;
          // The stock the line takes: the project's own, or Stores stock.
          return { materialId: r.materialId, locationId: r.locationId, quantity: Number(l.quantity), heldForProject: r.heldForProject ?? null };
        }),
      };
      await api.post('/inventory-issues', issueBody, { idempotencyKey: idem.keyFor(issueBody) });
      const who = recipients.find((r) => r.id === recipientId)?.name ?? 'recipient';
      toast.success(`Issued ${filled.length} item${filled.length === 1 ? '' : 's'} to ${who}`);
      setLast({ who, recipientId, count: filled.length });
      setLines([emptyLine()]);
      setProjectNumber('');
      // The submission succeeded: the next one is a new operation, so it gets a
      // fresh key rather than replaying this one.
      idem.confirm();
      stock.reload();
    } catch (err) {
      // A failed or unconfirmed attempt keeps its key, so a retry of the same
      // request replays rather than posting the issue twice. Only a "key reused
      // for different details" refusal clears it.
      idem.resolve(err);
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  // Reached by a typed or old link: say so rather than offer a form the server would refuse.
  const allowed = usePermissions().hasPermission('inventory:issue');
  if (!allowed) return <NoAccess title="Issue stock" action="issue stock" />;

  return (
    <div>
      <PageHeader
        title="Issue stock"
        description={<>Record stock leaving the store: who took it, for which project, and which items. Tools are checked out, not issued: do that on <Link to="/tools" className="btn-link">Tools</Link>.</>}
        breadcrumb={[{ label: 'Stock', to: '/stock' }, { label: 'Issue stock' }]}
      />

      {stock.error && !stock.stale && <ErrorState error={stock.error} onRetry={stock.reload} />}
      {stock.stale && <StaleDataNotice error={stock.error} onRetry={stock.reload} />}

      {last && (
        <Alert tone="success" title={`Issued ${last.count} item${last.count === 1 ? '' : 's'} to ${last.who}`} className="mb-4 max-w-4xl">
          {/* Today's issues to them, newest first, in the slip layout that prints. */}
          <Link to={`/movements?report=issued&view=cards&recipientId=${encodeURIComponent(last.recipientId)}&from=${today()}&to=${today()}`} className="btn-link">
            See the issue slip in Movements
          </Link>
          {' '}to check or print it. The form below is ready for the next issue.
        </Alert>
      )}

      {(!stock.error || stock.stale) && (
        <form onSubmit={submit} className="surface-card p-4 space-y-5 max-w-4xl" noValidate>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RecipientSelect id="issue-recipient" value={recipientId} onChange={setRecipientId} recipients={recipients} disabled={loading} invalid={!!error && !recipientId} />
            <ProjectSelect
              id="issue-project"
              label="Project"
              value={issueProject}
              onChange={chooseProject}
              projects={projectOptions}
              disabled={loading || !!lockedBy}
              help={lockedBy
                ? `Set by ${lockedBy.materialSku}: project material is issued only to its own project.`
                : issueProject ? `Only ${issueProject}'s material is listed. Choose No project to issue Stores items.` : undefined}
            />
          </div>
          {optionsError && (
            <Alert tone="danger" title="Couldn't load recipients and projects">
              {optionsError.message} <button type="button" className="btn-link" onClick={reloadOptions}>Try again</button>
            </Alert>
          )}
          {!loading && !optionsError && recipients.length === 0 && (
            <Alert tone="info" title="No recipients yet">
              Add the people and places stock is issued to on the <Link to="/recipients" className="btn-link">Recipients</Link> page.
            </Alert>
          )}

          <fieldset className="space-y-3">
            <legend className="text-h3 text-surface-900 mb-2">Items</legend>
            {lines.map((l, i) => {
              const row = byKey.get(l.stockKey);
              const over = overIssued.has(l.stockKey);
              return (
                <div key={l.key} className="grid grid-cols-1 sm:grid-cols-[1fr_9rem_auto] gap-2 items-start">
                  <Field label={`Item ${i + 1}`} htmlFor={`issue-item-${l.key}`} help={row ? `${row.heldForProject ? `Held for ${row.heldForProject} at` : 'On hand at'} ${locationName(row.locationId, row.locationName)}: ${row.quantity} ${row.unitOfMeasure}` : undefined}>
                    <SearchSelect
                      id={`issue-item-${l.key}`}
                      value={l.stockKey}
                      onChange={(v) => update(l.key, { stockKey: v })}
                      options={itemOptions}
                      placeholder={stock.loading ? 'Loading stock…' : 'Search by name, code or location'}
                      noMatchText={issueProject ? `No ${issueProject} material in stock matches` : 'No item in stock matches'}
                      disabled={stock.loading}
                      autoFocus={focusKey === l.key}
                    />
                  </Field>
                  <Field label="Quantity" htmlFor={`issue-qty-${l.key}`} error={over ? 'More than on hand' : null}>
                    <Input id={`issue-qty-${l.key}`} type="number" inputMode="decimal" min="0" step="any" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} invalid={over} />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Remove item ${i + 1}`}
                    className="sm:mt-6"
                    onClick={() => setLines((ls) => (ls.length === 1 ? [emptyLine()] : ls.filter((x) => x.key !== l.key)))}
                  >
                    <Icon.Trash size={14} />
                  </Button>
                </div>
              );
            })}
            <Button type="button" variant="secondary" leadingIcon={<Icon.Plus size={14} />} onClick={() => { const line = emptyLine(); setFocusKey(line.key); setLines((ls) => [...ls, line]); }} disabled={lines.length >= 50}>
              Add another item
            </Button>
          </fieldset>

          {error && <Alert tone="danger" title="Cannot issue">{error}</Alert>}

          <div className="entry-actions flex justify-end gap-2 py-3 border-t border-surface-200">
            <Link to="/stock"><Button type="button" variant="ghost" disabled={busy}>Back to stock</Button></Link>
            <Button type="submit" variant="primary" loading={busy}>Issue stock</Button>
          </div>
        </form>
      )}
    </div>
  );
}
