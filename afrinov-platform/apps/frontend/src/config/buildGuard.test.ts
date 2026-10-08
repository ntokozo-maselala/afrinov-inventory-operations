import { describe, it, expect } from 'vitest';
import { demoBuildRefusal, enabledDemoFlags } from './buildGuard';

describe('demo flags in builds', () => {
  it('allows a production build with both flags unset or false', () => {
    expect(demoBuildRefusal('production', {})).toBeNull();
    expect(demoBuildRefusal('production', { VITE_FRONTEND_ONLY: 'false', VITE_DEMO_AUTH_ENABLED: 'false' })).toBeNull();
  });

  it('refuses a production build with mock data switched on', () => {
    expect(demoBuildRefusal('production', { VITE_FRONTEND_ONLY: 'true' })).toMatch(/VITE_FRONTEND_ONLY=true/);
  });

  it('refuses a production build with demo login switched on, whatever the case or spacing', () => {
    expect(demoBuildRefusal('production', { VITE_DEMO_AUTH_ENABLED: ' TRUE ' })).toMatch(/VITE_DEMO_AUTH_ENABLED=true/);
  });

  it('names every flag that is switched on', () => {
    expect(enabledDemoFlags({ VITE_FRONTEND_ONLY: 'true', VITE_DEMO_AUTH_ENABLED: 'true' }))
      .toEqual(['VITE_FRONTEND_ONLY', 'VITE_DEMO_AUTH_ENABLED']);
  });

  it('allows a deliberate demo build in its own mode', () => {
    expect(demoBuildRefusal('demo', { VITE_FRONTEND_ONLY: 'true' })).toBeNull();
  });
});


describe('production guard boundaries', () => {
  it.each(['', 'false', ' FALSE ', '1', 'yes', 'trueish'])('does not enable demo mode for %j', (value) => {
    const env = { VITE_FRONTEND_ONLY: value, VITE_DEMO_AUTH_ENABLED: value, UNRELATED_FLAG: 'true' };
    expect(enabledDemoFlags(env)).toEqual([]);
    expect(demoBuildRefusal('production', env)).toBeNull();
  });

  it('reports both enabled flags and the explicit demo build command', () => {
    const message = demoBuildRefusal('production', { VITE_FRONTEND_ONLY: ' True ', VITE_DEMO_AUTH_ENABLED: 'TRUE' });
    expect(message).toContain('VITE_FRONTEND_ONLY=true and VITE_DEMO_AUTH_ENABLED=true');
    expect(message).toContain('npm run build:frontend-only');
  });
});
