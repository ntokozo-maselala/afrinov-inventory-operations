import { describe, it, expect } from 'vitest';
import { canChangeSchedules } from './projectSchedule';

describe('who may change a project’s schedules on screen, as the server decides', () => {
  it('lets Admin, a holder of manage:project_schedule, and the project’s own manager', () => {
    expect(canChangeSchedules({ id: 'a', roles: ['ADMIN'] }, 'm')).toBe(true);
    expect(canChangeSchedules({ id: 'x', roles: ['VIEWER'], permissions: ['manage:project_schedule'] }, 'm')).toBe(true);
    expect(canChangeSchedules({ id: 'm', roles: ['VIEWER'] }, 'm')).toBe(true);
  });

  it('refuses everyone else, and anyone when the project has no manager', () => {
    expect(canChangeSchedules({ id: 'x', roles: ['PROCUREMENT'], permissions: ['manage:projects'] }, 'm')).toBe(false);
    expect(canChangeSchedules({ id: 'x', roles: ['VIEWER'] }, null)).toBe(false);
    expect(canChangeSchedules(null, 'm')).toBe(false);
  });
});
