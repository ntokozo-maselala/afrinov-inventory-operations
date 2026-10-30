import { describe, expect, it } from 'vitest';
import { demoDataRequested, SeedModeError } from './seed-mode.js';

describe('demoDataRequested', () => {
  it('writes only the bootstrap unless demo data is asked for', () => {
    expect(demoDataRequested([], { NODE_ENV: 'development' })).toBe(false);
    expect(demoDataRequested([], { NODE_ENV: 'production' })).toBe(false);
    expect(demoDataRequested([], {})).toBe(false);
  });

  it('loads demo data in development and test when asked for by flag or variable', () => {
    expect(demoDataRequested(['--demo'], { NODE_ENV: 'development' })).toBe(true);
    expect(demoDataRequested([], { NODE_ENV: 'test', SEED_DEMO_DATA: 'true' })).toBe(true);
    expect(demoDataRequested([], { NODE_ENV: 'test', SEED_DEMO_DATA: 'TRUE' })).toBe(true);
    expect(demoDataRequested([], { NODE_ENV: 'test', SEED_DEMO_DATA: 'false' })).toBe(false);
  });

  it('refuses demo data in production', () => {
    expect(() => demoDataRequested(['--demo'], { NODE_ENV: 'production' })).toThrow(SeedModeError);
    expect(() => demoDataRequested([], { NODE_ENV: 'production', SEED_DEMO_DATA: 'true' })).toThrow(SeedModeError);
  });

  it('treats an unset NODE_ENV as production, as loadConfig does', () => {
    expect(() => demoDataRequested(['--demo'], {})).toThrow(/never loaded into production/);
  });
});
