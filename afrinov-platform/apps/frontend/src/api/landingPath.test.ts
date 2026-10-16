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

  it('maps the counter pages', () => {
    expect(landingPathFor('issue-stock')).toBe('/stock/issue');
    expect(landingPathFor('receive-stock')).toBe('/stock/receive');
  });

  it('by role, sends a technician to Issue stock and everyone else to the Dashboard', () => {
    expect(landingPathFor('by-role', ['TECHNICIAN'])).toBe('/stock/issue');
    expect(landingPathFor('by-role', ['technician'])).toBe('/stock/issue');
    for (const roles of [['STORE_CONTROLLER'], ['ADMIN'], ['TECHNICIAN', 'STORE_CONTROLLER'], ['VIEWER'], []]) {
      expect(landingPathFor('by-role', roles)).toBe('/');
    }
  });

  it('falls back to the dashboard for purchase orders when procurement is disabled', () => {
    features.procurement = false;
    expect(landingPathFor('purchase-orders')).toBe('/');
  });
});
