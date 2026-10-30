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
