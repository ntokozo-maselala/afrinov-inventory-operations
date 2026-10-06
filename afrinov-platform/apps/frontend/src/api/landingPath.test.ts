import { describe, it, expect, vi, afterEach } from 'vitest';
import { landingPathFor } from './landingPath';

const features = vi.hoisted(() => ({ procurement: true }));
vi.mock('../config/features', () => ({
  get PROCUREMENT_ENABLED() { return features.procurement; },
}));

describe('landingPathFor', () => {
  afterEach(() => { features.procurement = true; });

  it('maps known landing pages to their routes', () => {
    expect(landingPathFor('dashboard')).toBe('/');
    expect(landingPathFor('inventory')).toBe('/stock');
    expect(landingPathFor('purchase-orders')).toBe('/purchase-orders');
  });

  it('falls back to the dashboard for unknown values', () => {
    expect(landingPathFor('nope')).toBe('/');
  });

  it('falls back to the dashboard for purchase orders when procurement is disabled', () => {
    features.procurement = false;
    expect(landingPathFor('purchase-orders')).toBe('/');
  });
});
