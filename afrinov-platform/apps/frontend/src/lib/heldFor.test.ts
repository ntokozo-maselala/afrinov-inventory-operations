import { describe, it, expect } from 'vitest';
import { movementProject } from './heldFor';

// Qodo, PR #145: a project's history lists its own stock moving, which names no
// project it was used for; the project column says whose stock it was instead.
describe('movementProject', () => {
  it('names the project the stock was used for, else the one it is held for, else none', () => {
    expect(movementProject({ projectNumber: 'AFRI-1325', heldForProject: 'AFRI-1325' })).toBe('AFRI-1325');
    expect(movementProject({ projectNumber: 'AFRI-1402', heldForProject: null })).toBe('AFRI-1402');
    expect(movementProject({ projectNumber: null, heldForProject: 'AFRI-1325' })).toBe('held for AFRI-1325');
    expect(movementProject({ projectNumber: null, heldForProject: null })).toBeNull();
    expect(movementProject({})).toBeNull();
  });
});
