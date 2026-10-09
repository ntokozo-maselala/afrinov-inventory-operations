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
}

export interface NavGroup {
  title: string;
  items: NavItem[];
  permissions?: string[];
}

export function useNavGroups(): NavGroup[] {
  const { hasPermission } = usePermissions();

  const allGroups: NavGroup[] = [
    {
      title: 'Overview',
      items: [
        { to: '/', label: 'Dashboard', end: true, icon: <Icon.Home /> },
      ],
    },
    {
      title: 'Operations',
      items: [
        { to: '/stock', label: 'Stock', icon: <Icon.Box /> },
        { to: '/racks', label: 'Racks', icon: <Icon.Layers /> },
        { to: '/locations', label: 'Locations', icon: <Icon.Map /> },
        { to: '/projects', label: 'Projects', icon: <Icon.Tag /> },
        { to: '/recipients', label: 'Recipients', icon: <Icon.Users /> },
        { to: '/movements', label: 'Movements', icon: <Icon.Arrows /> },
        { to: '/suppliers', label: 'Suppliers', icon: <Icon.Users /> },
      ],
    },
    ...(PROCUREMENT_ENABLED ? [{
      title: 'Procurement',
      items: [
        { to: '/purchase-orders', label: 'Purchase orders', icon: <Icon.Cart /> },
        { to: '/goods-receipts', label: 'Goods receipts', icon: <Icon.Truck /> },
      ],
    }] : []),
    {
      title: 'Catalogue',
      items: [
        { to: '/materials', label: 'Materials', icon: <Icon.Layers /> },
      ],
    },
    {
      title: 'Insights',
      items: [
        { to: '/reports/inventory', label: 'Inventory report', icon: <Icon.Chart /> },
        { to: '/reports/stock-status', label: 'Stock status', icon: <Icon.Warning /> },
        { to: '/reports/consumption', label: 'Stock used', icon: <Icon.Cash /> },
        { to: '/reports/month-end', label: 'Month-end report', icon: <Icon.Doc /> },
      ],
    },
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