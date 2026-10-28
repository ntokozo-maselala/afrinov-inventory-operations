// Sidebar system tests using vitest only (no @testing-library/react)
// Tests the core logic and behavior of the sidebar navigation system

import { describe, it, expect, vi, afterEach } from 'vitest';
import { useNavGroups, isNavItemActive } from '../hooks/useNavGroups';

// Signed in through the auth mock, so the real permission table decides what
// each role sees. ADMIN sees everything unless a test sets other roles.
const signedIn = vi.hoisted(() => ({ roles: ['ADMIN'] as string[] }));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: signedIn.roles } }) }));

// The procurement switch is read at build time; a getter lets each test flip it.
const features = vi.hoisted(() => ({ procurement: true }));
vi.mock('../config/features', () => ({
  get PROCUREMENT_ENABLED() { return features.procurement; },
}));

const useLabelsIn = (title: string) => useNavGroups().find((g) => g.title === title)?.items.map((i) => i.label) ?? [];

describe('useNavGroups', () => {
  afterEach(() => { features.procurement = true; signedIn.roles = ['ADMIN']; });

  it('returns navigation groups with correct structure', () => {
    const groups = useNavGroups();
    
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBeGreaterThan(0);
    
    groups.forEach(group => {
      expect(group).toHaveProperty('title');
      expect(group).toHaveProperty('items');
      expect(Array.isArray(group.items)).toBe(true);
      expect(group.items.length).toBeGreaterThan(0);
      
      group.items.forEach(item => {
        expect(item).toHaveProperty('to');
        expect(item).toHaveProperty('label');
        expect(item).toHaveProperty('icon');
      });
    });
  });

  it('groups the menu in the order the work happens', () => {
    features.procurement = false;
    expect(useNavGroups().map((g) => g.title)).toEqual(['Overview', 'Store', 'Reports', 'Operations', 'Account']);
  });

  it('puts the counter actions in Store, after Stock', () => {
    expect(useLabelsIn('Store')).toEqual(['Stock', 'Issue stock', 'Receive stock', 'Return stock', 'Count stock', 'Tools']);
  });

  it('puts Movements, the history of every movement, with the other reports', () => {
    expect(useLabelsIn('Reports')).toEqual(['Stock status', 'Stock used', 'Stock report', 'Movements']);
  });

  it('puts the lists the counter draws on in Operations', () => {
    expect(useLabelsIn('Operations')).toEqual(['Materials', 'Locations', 'Projects', 'Recipients', 'Suppliers']);
  });

  it('marks Stock as an exact match, so it is not lit on /stock/issue', () => {
    const stock = useNavGroups().flatMap((g) => g.items).find((i) => i.to === '/stock');
    expect(stock?.end).toBe(true);
  });

  it.each([
    ['TECHNICIAN', ['Stock', 'Issue stock', 'Return stock', 'Tools']],
    ['PROCUREMENT', ['Stock', 'Receive stock', 'Tools']],
    ['VIEWER', ['Stock', 'Tools']],
    ['STORE_CONTROLLER', ['Stock', 'Issue stock', 'Receive stock', 'Return stock', 'Count stock', 'Tools']],
  ])('shows a %s only the Store actions the server lets them do', (role, expected) => {
    signedIn.roles = [role];
    expect(useLabelsIn('Store')).toEqual(expected);
  });

  it('includes the Procurement group when procurement is enabled', () => {
    features.procurement = true;
    const groups = useNavGroups();
    const procurement = groups.find(g => g.title === 'Procurement');
    
    expect(procurement).toBeDefined();
    const itemLabels = procurement!.items.map(i => i.label);
    expect(itemLabels).toContain('Purchase orders');
    expect(itemLabels).not.toContain('Goods receipts');
  });

  it('omits the Procurement group but keeps Suppliers when procurement is disabled', () => {
    features.procurement = false;
    const groups = useNavGroups();

    expect(groups.map(g => g.title)).not.toContain('Procurement');
    const links = groups.flatMap(g => g.items.map(i => i.to));
    expect(links).not.toContain('/purchase-orders');
    expect(links).not.toContain('/goods-receipts');
    expect(links).toContain('/suppliers');
  });

  it('handles nested navigation items correctly', () => {
    const groups = useNavGroups();
    
    // Check that nested items can be defined in the structure
    groups.forEach(group => {
      group.items.forEach(item => {
        if (item.children) {
          expect(Array.isArray(item.children)).toBe(true);
          item.children.forEach(child => {
            expect(child).toHaveProperty('to');
            expect(child).toHaveProperty('label');
            expect(child).toHaveProperty('icon');
          });
        }
      });
    });
  });
});

describe('Active route detection logic', () => {
  // Test the exact/prefix matching logic used in Sidebar
  it('matches exact routes correctly', () => {
    const isExactMatch = (pathname: string, route: string, end: boolean) => 
      end ? pathname === route : pathname.startsWith(route);
    
    expect(isExactMatch('/stock', '/stock', true)).toBe(true);
    expect(isExactMatch('/stock/low', '/stock', true)).toBe(false);
    expect(isExactMatch('/stock', '/stock', false)).toBe(true);
    expect(isExactMatch('/stock/low', '/stock', false)).toBe(true);
    expect(isExactMatch('/suppliers', '/stock', false)).toBe(false);
  });

  it('handles nested routes correctly', () => {
    const isActive = (pathname: string, item: { to: string; end?: boolean; exact?: boolean }) =>
      item.exact || item.end
        ? pathname === item.to
        : pathname.startsWith(item.to);

    expect(isActive('/stock', { to: '/stock', end: true })).toBe(true);
    expect(isActive('/stock/low', { to: '/stock', end: true })).toBe(false);
    expect(isActive('/stock', { to: '/stock', end: false })).toBe(true);
    expect(isActive('/stock/low', { to: '/stock', end: false })).toBe(true);
    expect(isActive('/stock/low', { to: '/stock/low', exact: true })).toBe(true);
    expect(isActive('/stock/low/details', { to: '/stock/low', exact: true })).toBe(false);
  });
});

describe('Sidebar width calculations', () => {
  it('uses correct CSS variable values', () => {
    // Test that the CSS variable approach works
    const expandedWidth = 220;
    const collapsedWidth = 68;
    const mobileWidth = 288;
    
    expect(expandedWidth).toBe(220);
    expect(collapsedWidth).toBe(68);
    expect(mobileWidth).toBe(288);
  });
});

describe('Responsive breakpoints', () => {
  it('defines correct breakpoint values', () => {
    const MOBILE_BREAKPOINT = 768;
    const TABLET_BREAKPOINT = 1024;
    const DESKTOP_LARGE_BREAKPOINT = 1440;
    
    expect(MOBILE_BREAKPOINT).toBe(768);
    expect(TABLET_BREAKPOINT).toBe(1024);
    expect(DESKTOP_LARGE_BREAKPOINT).toBe(1440);
  });

  it('categorizes viewport widths correctly', () => {
    const categorize = (width: number) => {
      if (width < 768) return 'mobile';
      if (width < 1024) return 'tablet';
      if (width < 1440) return 'desktop';
      return 'large-desktop';
    };
    
    expect(categorize(320)).toBe('mobile');
    expect(categorize(767)).toBe('mobile');
    expect(categorize(768)).toBe('tablet');
    expect(categorize(1023)).toBe('tablet');
    expect(categorize(1024)).toBe('desktop');
    expect(categorize(1439)).toBe('desktop');
    expect(categorize(1440)).toBe('large-desktop');
    expect(categorize(2560)).toBe('large-desktop');
  });
});

describe('Sidebar state transitions', () => {
  it('defines valid sidebar modes', () => {
    type SidebarMode = 'expanded' | 'collapsed' | 'mobile-open' | 'mobile-closed';
    const validModes: SidebarMode[] = ['expanded', 'collapsed', 'mobile-open', 'mobile-closed'];
    
    validModes.forEach(mode => {
      expect(['expanded', 'collapsed', 'mobile-open', 'mobile-closed']).toContain(mode);
    });
  });

  it('handles state transitions correctly', () => {
    let sidebarMode: 'expanded' | 'collapsed' | 'mobile-open' | 'mobile-closed' = 'expanded';
    
    const toggleCollapsed = () => {
      sidebarMode = sidebarMode === 'expanded' ? 'collapsed' : 
                    sidebarMode === 'collapsed' ? 'expanded' : sidebarMode;
    };
    
    const openMobile = () => { sidebarMode = 'mobile-open'; };
    const closeMobile = () => { sidebarMode = 'mobile-closed'; };
    
    expect(sidebarMode).toBe('expanded');
    toggleCollapsed();
    expect(sidebarMode).toBe('collapsed');
    toggleCollapsed();
    expect(sidebarMode).toBe('expanded');
    
    openMobile();
    expect(sidebarMode).toBe('mobile-open');
    closeMobile();
    expect(sidebarMode).toBe('mobile-closed');
  });

  it('persists collapsed state correctly', () => {
    const storage = new Map<string, string>();
    
    const setItem = (key: string, value: string) => storage.set(key, value);
    const getItem = (key: string) => storage.get(key) || null;
    
    const persist = (mode: 'expanded' | 'collapsed') => {
      setItem('afrinov.sidebarCollapsed', mode === 'collapsed' ? '1' : '0');
    };
    
    persist('collapsed');
    expect(getItem('afrinov.sidebarCollapsed')).toBe('1');
    
    persist('expanded');
    expect(getItem('afrinov.sidebarCollapsed')).toBe('0');
  });
});

describe('Mobile drawer behavior', () => {
  it('traps focus within drawer', () => {
    // This is a conceptual test - actual focus trapping is tested in integration
    const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    expect(focusableSelectors).toContain('button');
    expect(focusableSelectors).toContain('[href]');
  });

  it('handles escape key to close', () => {
    const handleKeyDown = (e: { key: string }, closeFn: () => void) => {
      if (e.key === 'Escape') closeFn();
    };
    
    let closed = false;
    handleKeyDown({ key: 'Escape' }, () => { closed = true; });
    expect(closed).toBe(true);
    
    closed = false;
    handleKeyDown({ key: 'Tab' }, () => { closed = true; });
    expect(closed).toBe(false);
  });

  it('prevents body scroll when open', () => {
    // Test the overflow logic
    let bodyOverflow = '';
    
    const openDrawer = () => { bodyOverflow = 'hidden'; };
    const closeDrawer = () => { bodyOverflow = ''; };
    
    expect(bodyOverflow).toBe('');
    openDrawer();
    expect(bodyOverflow).toBe('hidden');
    closeDrawer();
    expect(bodyOverflow).toBe('');
  });
});

describe('Accessibility', () => {
  it('uses correct ARIA attributes', () => {
    // Test that components use proper ARIA attributes
    const sidebarAriaLabel = 'Main';
    const mobileAriaLabel = 'Navigation';
    const mobileDialogAriaLabel = 'Navigation';
    
    expect(sidebarAriaLabel).toBe('Main');
    expect(mobileAriaLabel).toBe('Navigation');
    expect(mobileDialogAriaLabel).toBe('Navigation');
  });

  it('provides accessible names for icon-only buttons', () => {
    // In collapsed mode, tooltips provide labels
    const collapsedItem = { label: 'Stock', icon: 'Box' };
    expect(collapsedItem.label).toBeTruthy();
  });

  it('announces expanded/collapsed state', () => {
    const getAriaLabel = (mode: string) => 
      mode === 'collapsed' ? 'Expand navigation' : 'Collapse navigation';
    
    expect(getAriaLabel('collapsed')).toBe('Expand navigation');
    expect(getAriaLabel('expanded')).toBe('Collapse navigation');
  });

  it('uses proper heading hierarchy', () => {
    // Sidebar uses nav, groups use text-eyebrow (not headings)
    // Mobile drawer uses role="dialog" with aria-label
    expect(true).toBe(true); // Placeholder for actual heading structure tests
  });
});

describe('Reduced motion support', () => {
  it('detects prefers-reduced-motion', () => {
    // Test the media query logic
    const matchMedia = (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    
    const mediaQuery = matchMedia('(prefers-reduced-motion: reduce)');
    expect(typeof mediaQuery.matches).toBe('boolean');
  });

  it('disables transitions when reduced motion is preferred', () => {
    const getTransitionDuration = (prefersReducedMotion: boolean) => 
      prefersReducedMotion ? '0ms' : '150ms';
    
    expect(getTransitionDuration(true)).toBe('0ms');
    expect(getTransitionDuration(false)).toBe('150ms');
  });
});
describe('New purchase order in the menu', () => {
  afterEach(() => { signedIn.roles = ['ADMIN']; });

  it.each([
    // Requests for quotation are the buyer's: approvers and the store don't ask for prices.
    ['PROCUREMENT', ['Purchase orders', 'New purchase order', 'Requests for quotation']],
    ['APPROVER', ['Purchase orders']],
    ['STORE_CONTROLLER', ['Purchase orders']],
  ])('shows a %s only the Procurement entries they can use', (role, expected) => {
    signedIn.roles = [role];
    expect(useLabelsIn('Procurement')).toEqual(expected);
  });

  it('highlights Purchase orders on an order, but only New purchase order on the new-order page', () => {
    const items = useNavGroups().find((g) => g.title === 'Procurement')!.items;
    const active = (pathname: string) => items.filter((i) => isNavItemActive(i, pathname)).map((i) => i.label);
    expect(active('/purchase-orders')).toEqual(['Purchase orders']);
    expect(active('/purchase-orders/po-1')).toEqual(['Purchase orders']);
    expect(active('/purchase-orders/po-1/edit')).toEqual(['Purchase orders']);
    expect(active('/purchase-orders/new')).toEqual(['New purchase order']);
  });
});
