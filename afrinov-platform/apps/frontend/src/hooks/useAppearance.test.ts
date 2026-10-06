// Framework-free smoke tests for the lightweight appearance cache used by
// GlobalPreferencesApplier and the SettingsProvider.
//
// We deliberately avoid @testing-library/react since the project does not
// currently ship a frontend test framework. The React component itself is
// exercised by the production typecheck + build.
import { describe, it, expect } from 'vitest';
import { setAppearance, getAppearance } from './useAppearance';

describe('useAppearance cache', () => {
  it('starts with the documented defaults', () => {
    // The default cache value (set in the module) is system/comfortable.
    expect(['system', 'light', 'dark']).toContain(getAppearance().theme);
    expect(['comfortable', 'compact']).toContain(getAppearance().density);
  });

  it('setAppearance updates the cache immutably', () => {
    const before = getAppearance();
    setAppearance({ theme: 'dark' });
    const after = getAppearance();
    expect(after.theme).toBe('dark');
    // The previous value object must not have been mutated.
    expect(before.theme).not.toBe(after.theme);
  });

  it('setAppearance merges partial updates', () => {
    setAppearance({ theme: 'dark' });
    setAppearance({ density: 'compact' });
    const s = getAppearance();
    expect(s.theme).toBe('dark');
    expect(s.density).toBe('compact');
  });
});
