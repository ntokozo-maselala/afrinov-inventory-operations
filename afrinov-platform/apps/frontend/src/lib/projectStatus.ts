// A project's status, as the Projects page and a Projects item's page show it.
export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';

export const PROJECT_STATUS_OPTIONS: Array<{ value: ProjectStatus; label: string }> = [
  { value: 'PLANNING', label: 'Planning' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export const PROJECT_STATUS_TONE: Record<ProjectStatus, 'neutral' | 'success' | 'warning' | 'brand' | 'danger'> = {
  PLANNING: 'neutral',
  ACTIVE: 'success',
  ON_HOLD: 'warning',
  COMPLETED: 'brand',
  CANCELLED: 'danger',
};

/** "Active", or the status as given if it is not one of the five. */
export function projectStatusLabel(status: string | null | undefined): string {
  return PROJECT_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status ?? '';
}

/** Completed and Cancelled close a project. */
export function isClosedProjectStatus(status: string | null | undefined): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

/**
 * Whether this user completes, cancels, archives or hands on a project: an
 * Admin, anyone granted close:project, or the project's own manager, as the
 * server decides (system audit E3).
 */
export function canCloseProject(user: { id?: string; roles?: string[]; permissions?: string[] } | null | undefined, managerId: string | null | undefined): boolean {
  if (!user) return false;
  if ((user.roles ?? []).some((r) => r.toUpperCase() === 'ADMIN')) return true;
  if (user.permissions?.includes('close:project')) return true;
  return !!managerId && user.id === managerId;
}
