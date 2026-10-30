// The five material categories, in the stock workbook's order and wording.
// The one list the forms, filters, tables, reports and exports label from.

export const CATEGORIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'CONSUMABLES', label: 'Consumables' },
  { value: 'FASTENERS_SLUGS_INSULATION', label: 'Fasteners, Slugs & Insulation' },
  { value: 'TOOLING_PPE_ELECTRICAL', label: 'Tooling, PPE & Electrical' },
  { value: 'PROJECT_MATERIAL', label: 'Project Material' },
  { value: 'TOOLS', label: 'Tools' },
];

export function categoryLabel(category: string): string {
  return CATEGORIES.find((c) => c.value === category)?.label ?? category;
}

// Stores and Projects (materials sections roadmap): the Project Material
// category is the Projects section, bought for one job; the other categories
// make up Stores, kept on the shelf and topped up.
export type MaterialSection = 'STORES' | 'PROJECTS';

export const PROJECTS_CATEGORY = 'PROJECT_MATERIAL';

/** The categories a Stores item can be in. */
export const STORES_CATEGORIES = CATEGORIES.filter((c) => c.value !== PROJECTS_CATEGORY);

/** Return Projects for PROJECT_MATERIAL; all other category values, including unknown ones, map to Stores. */
export function sectionOf(category: string): MaterialSection {
  return category === PROJECTS_CATEGORY ? 'PROJECTS' : 'STORES';
}

/**
 * The project a Projects item was tagged with, while it is open: suggested as
 * an order's or RFQ's project when none is chosen yet, never fixed by it (the
 * order says which project its material is for: Project on the Order Roadmap).
 * Blank for a Stores item, an untagged one, or one whose project has closed.
 */
export function suggestedProject(m: { category: string; projectNumber?: string | null; project?: { status?: string | null } | null }): string {
  if (m.category !== PROJECTS_CATEGORY || !m.projectNumber) return '';
  return m.project?.status === 'COMPLETED' || m.project?.status === 'CANCELLED' ? '' : m.projectNumber;
}

/** Projects material with no project yet: its leftovers aren't issued, but moved to Stores. */
export function needsProject(m: { category: string; projectNumber?: string | null }): boolean {
  return m.category === PROJECTS_CATEGORY && !m.projectNumber;
}
