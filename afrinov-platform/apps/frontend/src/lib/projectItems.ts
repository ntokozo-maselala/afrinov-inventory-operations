// A Projects item is added for one project (ADR-046). These decide which
// projects an item can be added for, and which items a project's RFQ or order
// line offers: the project's own items, then those with no project yet (added
// before items had one), never another project's.

export interface ProjectChoice { projectNumber: string; name?: string | null; status?: string | null; active?: boolean }

/** The projects an item can be added for: open ones, and the item's own even once it has closed. */
export function openProjects<P extends ProjectChoice>(projects: P[], current: string | null): P[] {
  const open = projects.filter((p) => p.active !== false && p.status !== 'COMPLETED' && p.status !== 'CANCELLED');
  if (current && !open.some((p) => p.projectNumber === current)) {
    const own = projects.find((p) => p.projectNumber === current);
    return [...open, (own ?? { projectNumber: current, name: null }) as P];
  }
  return open;
}

export interface ProjectItems<M> {
  /** Items added for the project. */
  own: M[];
  /** Items with no project yet. */
  unassigned: M[];
  /** Another project's items a line already holds, so it can still show them. */
  held: M[];
}

export const GROUPS = ['own', 'unassigned', 'held'] as const;

/**
 * The Projects items a line of `project`'s RFQ or order offers. `keep` are
 * items the lines already hold: another project's stay listed in their own
 * group, so a line can still show and change them after the project changes.
 * Nothing is offered before the project is chosen.
 */
export function itemsForProject<M extends { id: string; projectNumber?: string | null }>(items: M[], project: string, keep: ReadonlySet<string> = new Set()): ProjectItems<M> {
  if (!project) return { own: [], unassigned: [], held: [] };
  return {
    own: items.filter((m) => m.projectNumber === project),
    unassigned: items.filter((m) => !m.projectNumber),
    held: items.filter((m) => !!m.projectNumber && m.projectNumber !== project && keep.has(m.id)),
  };
}

/** The group headings a line's item list shows. */
export function itemGroupLabels(project: string): Record<(typeof GROUPS)[number], string> {
  return { own: `For ${project}`, unassigned: 'No project yet', held: 'Another project’s, on a line already' };
}
