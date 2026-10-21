import { afterEach, describe, expect, it, vi } from 'vitest';

async function readProcurementEnabled(value: string) {
  vi.resetModules();
  vi.stubEnv('VITE_PROCUREMENT_ENABLED', value);
  const features = await import('./features');
  return features.PROCUREMENT_ENABLED;
}

describe('PROCUREMENT_ENABLED', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    ['', true],
    ['true', true],
    ['1', true],
    ['false', false],
    ['FALSE', false],
  ])('resolves VITE_PROCUREMENT_ENABLED=%s to %s', async (value, expected) => {
    await expect(readProcurementEnabled(value)).resolves.toBe(expected);
  });
});
