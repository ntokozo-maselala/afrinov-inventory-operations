import { describe, it, expect } from 'vitest';
import { locationLabel } from './locations';

describe('locationLabel', () => {
  it('names a rack with the room it stands in', () => {
    expect(locationLabel({ name: 'D-1', parent: { name: 'Main Storeroom' } })).toBe('D-1 · Main Storeroom');
  });

  it('names anything else by its own name', () => {
    expect(locationLabel({ name: 'Boiler Shop', parent: null })).toBe('Boiler Shop');
    expect(locationLabel({ name: 'Boiler Shop' })).toBe('Boiler Shop');
  });
});
