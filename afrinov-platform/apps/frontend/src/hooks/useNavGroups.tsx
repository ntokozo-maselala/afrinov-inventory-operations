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
        { to: '/stock/receive', label: 'Receive stock', icon: <Icon.ArrowDown />, permissions: ['inventory:receive'] },
        { to: '/stock/return', label: 'Return stock', icon: <Icon.Arrows />, permissions: ['inventory:return'] },
        { to: '/stock/count', label: 'Count stock', icon: <Icon.Check />, permissions: ['inventory:count'] },
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
        { to: '/projects', label: 'Projects', icon: <Icon.Tag /> },
        { to: '/recipients', label: 'Recipients', icon: <Icon.Users /> },
        { to: '/suppliers', label: 'Suppliers', icon: <Icon.Truck /> },
        { to: '/racks', label: 'Racks', icon: <Icon.Layers /> },
      ],
    },
    ...(PROCUREMENT_ENABLED ? [{
      title: 'Procurement',
      items: [
        // Highlighted on an order's page too, but not on the new-order page, which has its own entry.
        { to: '/purchase-orders', label: 'Purchase orders', icon: <Icon.Cart />, permissions: ['orders:view'], excludes: ['/purchase-orders/new'] },
        { to: '/purchase-orders/new', label: 'New purchase order', icon: <Icon.Plus />, permissions: ['procurement:manage'] },
        { to: '/goods-receipts', label: 'Goods receipts', icon: <Icon.Truck />, permissions: ['receipts:view'] },
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
      .filter((group) => group.items.length > 0);
  }

  return filterGroups(allGroups);
}