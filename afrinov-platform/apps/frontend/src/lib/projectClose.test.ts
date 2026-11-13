// Who completes, cancels, archives or hands on a project (system audit E3).
import { describe, it, expect } from 'vitest';
import { canCloseProject, isClosedProjectStatus } from './projectStatus';

describe('canCloseProject', () => {
  it('lets an Admin, a close:project grant or the project manager close it, and nobody else', () => {
    expect(canCloseProject({ id: 'u-1', roles: ['ADMIN'] }, null)).toBe(true);
    expect(canCloseProject({ id: 'u-2', roles: ['SALES'], permissions: ['close:project'] }, 'u-9')).toBe(true);
    expect(canCloseProject({ id: 'u-3', roles: ['SALES'] }, 'u-3')).toBe(true);
    expect(canCloseProject({ id: 'u-3', roles: ['SALES', 'PROCUREMENT', 'STORE_CONTROLLER'] }, 'u-9')).toBe(false);
    expect(canCloseProject({ id: 'u-3', roles: ['SALES'] }, null)).toBe(false);
    expect(canCloseProject(null, 'u-3')).toBe(false);
  });

  it('counts Completed and Cancelled as closed', () => {
    expect(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'].filter(isClosedProjectStatus)).toEqual(['COMPLETED', 'CANCELLED']);
  });
});
