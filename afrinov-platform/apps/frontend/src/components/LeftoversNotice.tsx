// Completed and cancelled projects still holding stock (materials sections
// roadmap, Phase 7): closing a project moves nothing, so its leftovers are
// flagged here until someone moves them to Stores.
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { Alert } from './Alert';
import type { StockValue } from '../pages/Dashboard';
import type { CurrentStockRow } from '../api/types';
import { sectionOf } from '../lib/categories';
import { isStoresStock } from '../lib/heldFor';
import { formatNumber } from '../lib/format';
import { usePermissions } from '../hooks/usePermissions';
import type { IssuePrefill } from '../lib/issuePrefill';

export interface ProjectLeftoverCount { projectNumber: string; name: string | null; status: string; items: number }

export const isClosedStatus = (status: string | null | undefined) => status === 'COMPLETED' || status === 'CANCELLED';

/**
 * Closed projects with leftovers in stock, by project number. Stock held for a
 * project is not a leftover: Move to Stores refuses it (Qodo, PR #143).
 */
export function useLeftovers(): ProjectLeftoverCount[] {
  const value = useApi<StockValue>('/reports/stock-value');
  return (value.data?.projects ?? [])
    .filter((p) => p.projectNumber && isClosedStatus(p.status) && (p.leftovers ?? 0) > 0)
    .map((p) => ({ projectNumber: p.projectNumber!, name: p.name, status: p.status!, items: p.leftovers ?? 0 }))
    .sort((a, b) => a.projectNumber.localeCompare(b.projectNumber));
}

export const leftoversLink = (projectNumber: string) => `/projects/${encodeURIComponent(projectNumber)}/leftovers`;

/** Projects items with no project still in stock, to move to Stores (Project on the Order Roadmap). */
export const NO_PROJECT_LEFTOVERS = '/materials/no-project/leftovers';

/** "N items to move to Stores" for each closed project holding stock, or only `projectNumber`'s. */
export function LeftoversNotice({ projectNumber, className }: { projectNumber?: string; className?: string }) {
  const leftovers = useLeftovers().filter((p) => !projectNumber || p.projectNumber === projectNumber);
  if (leftovers.length === 0) return null;
  return (
    <Alert tone="warning" title="Leftovers to move to Stores" className={className}>
      <ul className="space-y-0.5">
        {leftovers.map((p) => (
          <li key={p.projectNumber}>
            Project {p.projectNumber}{p.name ? ` · ${p.name}` : ''} is {p.status === 'COMPLETED' ? 'completed' : 'cancelled'}:{' '}
            <Link to={leftoversLink(p.projectNumber)} className="btn-link">
              {p.items} item{p.items === 1 ? '' : 's'} to move to Stores
            </Link>
          </li>
        ))}
      </ul>
    </Alert>
  );
}

interface HeldForProject { projectNumber: string | null; name: string | null; status: string | null; items: number }

const itemsText = (n: number) => `${n} item${n === 1 ? '' : 's'}`;

/**
 * Project material still in the store, received before project material went
 * straight to site (Stores and Procurement Separation Roadmap). Stock shows
 * Stores only, so it is listed here by project: a closed project's as
 * leftovers to move to Stores, an open project's as still to be issued to it,
 * and any with no project yet as needing one first. Built from the Stock
 * page's own rows (inactive items included), so it shows whenever the table
 * can, and the page's load error covers both (Qodo, PR #126).
 * Stock received for a project and not yet issued is listed first
 * (ReceivedNotIssuedNotice).
 */
export function ProjectStockNotice({ rows, className }: { rows: CurrentStockRow[]; className?: string }) {
  const byProject = new Map<string, HeldForProject & { ids: Set<string> }>();
  for (const r of rows) {
    // Leftovers are Stores stock with the item's project; stock held for a
    // project is that project's own, not a leftover.
    if (sectionOf(r.category) !== 'PROJECTS' || !isStoresStock(r) || Number(r.quantity) <= 0) continue;
    const key = r.projectNumber ?? '';
    const held = byProject.get(key) ?? { projectNumber: r.projectNumber ?? null, name: r.project?.name ?? null, status: r.project?.status ?? null, items: 0, ids: new Set<string>() };
    held.ids.add(r.materialId);
    held.items = held.ids.size;
    byProject.set(key, held);
  }
  const projects = [...byProject.values()].filter((p) => p.projectNumber).sort((a, b) => a.projectNumber!.localeCompare(b.projectNumber!));
  const closed = projects.filter((p) => isClosedStatus(p.status));
  const open = projects.filter((p) => !isClosedStatus(p.status));
  const unassigned = byProject.get('');
  const name = (p: HeldForProject) => `Project ${p.projectNumber}${p.name ? ` · ${p.name}` : ''}`;
  return (
    <>
      <ReceivedNotIssuedNotice rows={rows} className={className} />
      {closed.length > 0 && (
        <Alert tone="warning" title="Leftovers to move to Stores" className={className}>
          <ul className="space-y-0.5">
            {closed.map((p) => (
              <li key={p.projectNumber}>
                {name(p)} is {p.status === 'COMPLETED' ? 'completed' : 'cancelled'}:{' '}
                <Link to={leftoversLink(p.projectNumber!)} className="btn-link">{itemsText(p.items)} to move to Stores</Link>
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {(open.length > 0 || unassigned) && (
        <Alert tone="info" title="Project material still in the store" className={className}>
          <p>Received before project material went straight to site.</p>
          {open.length > 0 && (
            <>
              <p className="mt-1">Issued to its project on Issue stock:</p>
              <ul className="space-y-0.5">
                {open.map((p) => (
                  <li key={p.projectNumber}>
                    <Link to={leftoversLink(p.projectNumber!)} className="btn-link">{name(p)}: {itemsText(p.items)}</Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          {unassigned && (
            <p className="mt-1">
              {itemsText(unassigned.items)} with no project, which aren&rsquo;t issued:{' '}
              <Link to={NO_PROJECT_LEFTOVERS} className="btn-link">Move them to Stores</Link>
            </p>
          )}
        </Alert>
      )}
    </>
  );
}

/**
 * Project material received and not yet issued. It isn't shelved: it goes to
 * the workshop as it arrives, so anything listed here is waiting to be issued
 * (Project Material Through the Store Roadmap, Phase 4). Per project, each item
 * with what is held, linking to its page, and Issue opening Issue stock with the
 * project and its lines filled in. Built from current-stock rows.
 */
export function ReceivedNotIssuedNotice({ rows, className }: { rows: CurrentStockRow[]; className?: string }) {
  const canIssue = usePermissions().hasPermission('inventory:issue');
  const byProject = new Map<string, CurrentStockRow[]>();
  for (const r of rows) {
    if (isStoresStock(r) || Number(r.quantity) <= 0) continue;
    byProject.set(r.heldForProject!, [...(byProject.get(r.heldForProject!) ?? []), r]);
  }
  const projects = [...byProject].sort(([a], [b]) => a.localeCompare(b));
  // Whether each project still takes issues, as Issue stock decides: active,
  // and neither completed nor cancelled (Qodo, PR #146).
  // Every project, archived ones too: a closed project's stock moves to Stores
  // even once it is archived (Qodo, PR #149); Issue still needs an active one.
  const active = useApi<Array<{ projectNumber: string; status?: string; active?: boolean }>>(projects.length > 0 && canIssue ? '/projects' : null);
  if (projects.length === 0) return null;
  // Unknown when the projects couldn't be read: Issue isn't offered then, and
  // the notice says so with a retry (Qodo, PR #146).
  const projectsUnknown = canIssue && !!active.error && !active.data;
  const whyNot = (project: string): string | null => {
    if (!active.data) return 'unknown';
    const p = active.data.find((x) => x.projectNumber === project);
    if (p?.status === 'COMPLETED') return 'project completed';
    if (p?.status === 'CANCELLED') return 'project cancelled';
    return !p || p.active === false ? 'project not active' : null;
  };
  /** Why Issue stock wouldn't offer a balance, or null when it would. */
  const whyNotRow = (r: CurrentStockRow): string | null => {
    if (r.category === 'TOOLS') return 'a tool, lent on Tools';
    if (r.materialActive === false) return 'item not in use';
    if (r.locationActive === false) return 'location not in use';
    return null;
  };
  return (
    <Alert tone="info" title="Received for projects, not yet issued" className={className}>
      <p>Project material goes to the workshop as it arrives: issue it to its project.</p>
      {projectsUnknown && (
        <p className="mt-1">
          The projects couldn&rsquo;t be checked, so Issue isn&rsquo;t offered.{' '}
          <button type="button" className="btn-link" onClick={() => active.reload()}>Try again</button>
        </p>
      )}
      <ul className="mt-1 space-y-1">
        {projects.map(([project, held]) => {
          // One entry per item, across its locations, saying how much of it
          // Issue won't take and why; the issue keeps each location's line.
          const items = new Map<string, { materialId: string; name: string; unit: string; quantity: number; notIssued: number; reasons: Set<string> }>();
          for (const r of held) {
            const i = items.get(r.materialId) ?? { materialId: r.materialId, name: r.materialName, unit: r.unitOfMeasure, quantity: 0, notIssued: 0, reasons: new Set<string>() };
            i.quantity += Number(r.quantity);
            const why = whyNotRow(r);
            if (why) { i.notIssued += Number(r.quantity); i.reasons.add(why); }
            items.set(r.materialId, i);
          }
          // Only what Issue stock offers: an active item and location, and no tools.
          const prefill: IssuePrefill = {
            projectNumber: project,
            lines: held.filter((r) => !whyNotRow(r)).map((r) => ({ materialId: r.materialId, locationId: r.locationId, quantity: Number(r.quantity) })),
          };
          const reason = canIssue ? whyNot(project) : null;
          return (
            <li key={project}>
              Project {project}:{' '}
              {[...items.values()].sort((a, b) => a.name.localeCompare(b.name)).map((i, n) => (
                <span key={i.materialId}>
                  {n > 0 && ', '}
                  <Link to={`/materials/${i.materialId}`} className="btn-link">{i.name}</Link> ({formatNumber(i.quantity)} {i.unit}
                  {canIssue && !reason && i.notIssued > 0 && (
                    <span className="text-meta">
                      {'; '}{i.notIssued < i.quantity ? `${formatNumber(i.notIssued)} ${i.unit} ` : ''}not issued: {[...i.reasons].join(', ')}
                    </span>
                  )})
                </span>
              ))}
              {canIssue && prefill.lines.length > 0 && !reason && (
                <>
                  {' · '}
                  <Link to="/stock/issue" state={{ issuePrefill: prefill }} className="btn-link" aria-label={`Issue project ${project}'s material`}>Issue</Link>
                </>
              )}
              {/* A closed project's stock moves to Stores with its item (Project Material Through the Store Roadmap, Phase 5). */}
              {canIssue && (reason === 'project completed' || reason === 'project cancelled') && (
                <span className="text-meta"> · {reason}: <Link to={leftoversLink(project)} className="btn-link">move to Stores</Link></span>
              )}
              {canIssue && reason === 'project not active' && <span className="text-meta"> · not issued: {reason}</span>}
            </li>
          );
        })}
      </ul>
    </Alert>
  );
}
