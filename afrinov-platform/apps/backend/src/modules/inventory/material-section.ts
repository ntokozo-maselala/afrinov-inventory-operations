// Stores and Projects (materials sections roadmap, Phase 1). Every material is
// in one of two sections: Stores, kept on the shelf and topped up, or
// Projects, bought for one job. The "Project Material" category is the
// Projects section and the other categories make up Stores, so reports that
// group by category keep working. A Projects material belongs to one project
// and has no Required Stock, as it is never re-ordered.
//
// Items moved into Projects from the old category have no project yet; they
// are assigned one later (Phase 3), and assigning a first project is always
// allowed. After that an item's project is fixed once it has stock movements,
// so its history never changes jobs.
import type { Prisma, PrismaClient } from '@prisma/client';
import { Errors } from '../../shared/errors.js';

export type MaterialSection = 'STORES' | 'PROJECTS';

export const PROJECTS_CATEGORY = 'PROJECT_MATERIAL';

type Db = PrismaClient | Prisma.TransactionClient;

export function sectionOf(category: string): MaterialSection {
  return category === PROJECTS_CATEGORY ? 'PROJECTS' : 'STORES';
}

/** The category filter for one section. */
export function categoryWhere(section: MaterialSection): Prisma.MaterialWhereInput['category'] {
  return section === 'PROJECTS' ? PROJECTS_CATEGORY : { not: PROJECTS_CATEGORY };
}

/** Refuses a project that doesn't exist or can't take new work: inactive, completed or cancelled. */
async function checkOpenProject(projectNumber: string, db: Db): Promise<void> {
  const p = await db.project.findUnique({ where: { projectNumber }, select: { active: true, status: true } });
  if (!p) throw Errors.validation(`Project ${projectNumber} does not exist`);
  if (!p.active || p.status === 'COMPLETED' || p.status === 'CANCELLED') {
    throw Errors.validation(`Project ${projectNumber} is closed, so no new material can be added to it`);
  }
}

/**
 * The project for a new material, checked against its section: a Projects
 * material has no Required Stock, and any project given must be open; a
 * Stores material has no project. A Projects item needs no project of its own
 * (Project on the Order Roadmap, Phase 2): the order it is bought on says
 * which project it is for. `projectRequired` keeps the old rule where a new
 * item comes with stock (`POST /stock-items`), as stock with no project can't
 * be issued.
 */
export async function projectForNewMaterial(
  input: { category: string; projectNumber?: string | null; requiredStock?: number },
  db: Db,
  opts: { projectRequired?: boolean } = {},
): Promise<string | null> {
  const projectNumber = input.projectNumber?.trim() || null;
  if (sectionOf(input.category) === 'STORES') {
    if (projectNumber) throw Errors.validation('A Stores material has no project. Choose the Project Material category for material bought for one job.');
    return null;
  }
  if (input.requiredStock) throw Errors.validation('A Projects material has no Required Stock: it is bought for its job, not re-ordered');
  if (!projectNumber) {
    if (opts.projectRequired) throw Errors.validation('A Projects material needs the project it is for');
    return null;
  }
  await checkOpenProject(projectNumber, db);
  return projectNumber;
}

/**
 * Checks a change to an existing material: Required Stock and its project.
 * Returns the project to save, or undefined when the project isn't changing.
 */
export async function checkMaterialChange(
  before: { id: string; category: string; projectNumber: string | null },
  change: { projectNumber?: string | null; requiredStock?: number },
  db: Db,
): Promise<string | null | undefined> {
  const projects = sectionOf(before.category) === 'PROJECTS';
  if (projects && change.requiredStock) {
    throw Errors.validation('A Projects material has no Required Stock: it is bought for its job, not re-ordered');
  }
  if (change.projectNumber === undefined) return undefined;
  const next = change.projectNumber?.trim() || null;
  if (next === before.projectNumber) return undefined;
  if (!projects) throw Errors.validation('A Stores material has no project');
  if (!next) throw Errors.validation('A Projects material needs the project it is for');
  await checkOpenProject(next, db);
  // A first project can always be assigned; after that, history fixes it.
  if (before.projectNumber) {
    const moved = await db.inventoryTransaction.count({ where: { materialId: before.id } });
    if (moved > 0) {
      throw Errors.conflict(`This material has stock movements on project ${before.projectNumber}, so it stays with that project. Create a new item for project ${next}.`);
    }
  }
  return next;
}


/**
 * A project's leftovers go only to that project (Phases 5 and 6): an issue
 * holding a Projects item still in the store is for that item's project, so
 * one can't hold two projects' material. Stores items can go to any project,
 * or none. Orders and RFQs take their project from the order instead (Project
 * on the Order Roadmap): project material isn't stock, so only leftovers
 * received before carry a project of their own.
 */
export function checkProjectMaterial(
  projectNumber: string | null | undefined,
  materials: Array<{ sku: string; category: string; projectNumber: string | null }>,
): void {
  const own = materials.filter((m) => sectionOf(m.category) === 'PROJECTS' && m.projectNumber);
  const projects = [...new Set(own.map((m) => m.projectNumber))];
  if (projects.length > 1) {
    throw Errors.validation(`One issue can't hold material for two projects (${projects.join(' and ')}). Issue each project's material separately.`);
  }
  const wrong = own.find((m) => m.projectNumber !== (projectNumber || null));
  if (wrong) {
    throw Errors.validation(projectNumber
      ? `${wrong.sku} is material for project ${wrong.projectNumber}, so it can't be issued to project ${projectNumber}.`
      : `${wrong.sku} is material for project ${wrong.projectNumber}: issue it to that project.`);
  }
}

/**
 * A project order is bought by Procurement for its project, so it holds
 * Projects material only (Stores ordering roadmap): Stores stock is ordered by
 * the store, on an order without a project. Issues are not affected.
 */
export function refuseStoresOnProjectOrder(
  projectNumber: string | null | undefined,
  materials: Array<{ sku: string; category: string }>,
): void {
  if (!projectNumber) return;
  const stores = materials.find((m) => sectionOf(m.category) === 'STORES');
  if (stores) {
    throw Errors.validation(`${stores.sku} is a Stores item, so it isn't bought for project ${projectNumber}. The store orders Stores stock from Stores → Order stock.`);
  }
}

/**
 * A Stores order is the store's, so it holds Stores items only: project
 * material is bought by Procurement on a project order. Until the project
 * moved to the order (Project on the Order Roadmap), the item's own project
 * kept it off a Stores order; this says so outright.
 */
export function refuseProjectMaterialOnStoresOrder(
  projectNumber: string | null | undefined,
  materials: Array<{ sku: string; category: string }>,
): void {
  if (projectNumber) return;
  const project = materials.find((m) => sectionOf(m.category) === 'PROJECTS');
  if (project) {
    throw Errors.validation(`${project.sku} is project material, so it isn't bought on a Stores order. Procurement orders it on a purchase order for its project.`);
  }
}

/**
 * Refuses to issue a Projects item still in the store with no project: no one
 * gives items a project any more (Project on the Order Roadmap), so its
 * leftovers move to Stores, as a closed project's do.
 */
export function refuseUnassigned(m: { sku: string; category: string; projectNumber: string | null }): void {
  if (sectionOf(m.category) === 'PROJECTS' && !m.projectNumber) {
    throw Errors.validation(`${m.sku} has no project, so it isn't issued. Move it to Stores from Project leftovers.`);
  }
}
