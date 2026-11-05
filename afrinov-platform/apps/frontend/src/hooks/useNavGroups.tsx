import { Icon } from '../components/Icon';
import type { ReactNode } from 'react';
import { usePermissions } from './usePermissions';
import { PROCUREMENT_ENABLED } from '../config/features';

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  icon: ReactNode;
  badge?: ReactNode;
  permissions?: string[];
  children?: NavItem[];
  exact?: boolean;
  /** Pages under `to` that have their own entry, so this one isn't highlighted there too. */
  excludes?: string[];
}

/** Whether a menu entry is the page being shown. */
export function isNavItemActive(item: Pick<NavItem, 'to' | 'end' | 'exact' | 'excludes'>, pathname: string): boolean {
  if (item.exact || item.end) return pathname === item.to;
  if (item.excludes?.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false;
  return pathname.startsWith(item.to);
}

export interface NavGroup {
  title: string;
  items: NavItem[];
  permissions?: string[];
  /** Shown as a header with no entries yet: kept although its list is empty. */
  placeholder?: boolean;
}

export function useNavGroups(): NavGroup[] {
  const { hasPermission } = usePermissions();

  // In the order the work happens: the store counter first, then reports,
  // then the lists the counter work draws on. Actions show only to the roles
  // the server lets do them (see PERMISSION_ROLES).
  const allGroups: NavGroup[] = [
    {
      title: 'Overview',
      items: [
        { to: '/', label: 'Dashboard', end: true, icon: <Icon.Home /> },
      ],
    },
    {
      title: 'Store',
      items: [
        // `end`: Stock is not also lit on /stock/issue and the other action pages below it.
        { to: '/stock', label: 'Stock', end: true, icon: <Icon.Box /> },
        { to: '/stock/issue', label: 'Issue stock', icon: <Icon.ArrowRight />, permissions: ['inventory:issue'] },
        // With procurement on, a delivery is always against one of the store's orders.
        { to: '/stock/receive', label: 'Receive stock', icon: <Icon.ArrowDown />, permissions: PROCUREMENT_ENABLED ? ['inventory:receive', 'orders:receive'] : ['inventory:receive'] },
        { to: '/stock/return', label: 'Return stock', icon: <Icon.Arrows />, permissions: ['inventory:return'] },
        { to: '/stock/count', label: 'Count stock', icon: <Icon.Check />, permissions: ['inventory:count'] },
        // Adjustments over the write-off limit, waiting for someone other than whoever asked.
        { to: '/stock/write-offs', label: 'Write-offs to approve', icon: <Icon.Warning />, permissions: ['writeoffs:view'] },
        // The storeman orders stock for the shelf; Procurement buys for projects.
        ...(PROCUREMENT_ENABLED ? [{ to: '/stock/orders', label: 'Order stock', icon: <Icon.Cart />, permissions: ['stores:view'] }] : []),
        { to: '/tools', label: 'Tools', icon: <Icon.Wrench /> },
      ],
    },
    {
      title: 'Reports',
      items: [
        { to: '/reports/stock-status', label: 'Stock status', icon: <Icon.Warning /> },
        { to: '/reports/consumption', label: 'Stock used', icon: <Icon.Cash /> },
        { to: '/reports/stock-report', label: 'Stock report', icon: <Icon.Doc /> },
        // The history of every movement, as reports with downloads; mistakes are reversed from here.
        { to: '/movements', label: 'Movements', icon: <Icon.Activity /> },
      ],
    },
    {
      // The lists the store's work draws on.
      title: 'Operations',
      items: [
        { to: '/materials', label: 'Materials', icon: <Icon.Layers /> },
        { to: '/locations', label: 'Locations', icon: <Icon.Map /> },
        { to: '/recipients', label: 'Recipients', icon: <Icon.Users /> },
        { to: '/suppliers', label: 'Suppliers', icon: <Icon.Truck /> },
      ],
    },
    {
      // The jobs the business wins and works on for its clients.
      title: 'Sales',
      items: [
        { to: '/projects', label: 'Projects', icon: <Icon.Tag /> },
        // What suppliers quote Sales can give away a job's margin, so buyers and the store don't see it.
        ...(PROCUREMENT_ENABLED ? [{ to: '/sales-rfqs', label: 'Sales RFQ', icon: <Icon.Doc />, permissions: ['sales:view'] }] : []),
      ],
    },
    {
      // A header for now: its pages come later.
      title: 'Production',
      items: [],
      placeholder: true,
    },
    ...(PROCUREMENT_ENABLED ? [{
      title: 'Procurement',
      // In the order the work goes: ask for prices, raise the order, then follow it.
      items: [
        // Buyers ask suppliers for prices before ordering; approvers and the store don't.
        { to: '/rfqs', label: 'RFQ', icon: <Icon.Doc />, permissions: ['procurement:manage'] },
        { to: '/purchase-orders/new', label: 'New purchase order', icon: <Icon.Plus />, permissions: ['procurement:manage'] },
        // Highlighted on an order's page too, but not on the new-order page, which has its own entry.
        { to: '/purchase-orders', label: 'Purchase orders', icon: <Icon.Cart />, permissions: ['orders:view'], excludes: ['/purchase-orders/new'] },
      ],
    }] : []),
    {
      title: 'Account',
      items: [
        { to: '/settings', label: 'Settings', icon: <Icon.Settings /> },
      ],
    },
  ];

  function filterItems(items: NavItem[]): NavItem[] {
    return items
      .filter((item) => {
        if (item.permissions && item.permissions.length > 0) {
          return item.permissions.every((p) => hasPermission(p));
        }
        return true;
      })
      .map((item) => ({
        ...item,
        children: item.children ? filterItems(item.children) : undefined,
      }));
  }

  function filterGroups(groups: NavGroup[]): NavGroup[] {
    return groups
      .filter((group) => {
        if (group.permissions && group.permissions.length > 0) {
          return group.permissions.every((p) => hasPermission(p));
        }
        return true;
      })
      .map((group) => ({
        ...group,
        items: filterItems(group.items),
      }))
      // A section whose entries the user may not use is left out; a placeholder stays.
      .filter((group) => group.items.length > 0 || group.placeholder);
  }

  return filterGroups(allGroups);
}