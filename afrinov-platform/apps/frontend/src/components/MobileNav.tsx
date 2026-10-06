import { NavLink, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAppShell } from '../hooks/useAppShell';
import { Icon } from './Icon';

interface MobileNavItemProps {
  item: {
    to: string;
    label: string;
    end?: boolean;
    icon: ReactNode;
    exact?: boolean;
    children?: Array<{
      to: string;
      label: string;
      end?: boolean;
      icon: ReactNode;
      exact?: boolean;
    }>;
  };
  onNavigate: () => void;
  level?: number;
  prefersReducedMotion?: boolean;
}

function MobileNavItem({ item, onNavigate, prefersReducedMotion = false }: MobileNavItemProps) {
  const location = useLocation();
  const isActive = item.exact || item.end
    ? location.pathname === item.to
    : location.pathname.startsWith(item.to);
  const hasChildren = item.children && item.children.length > 0;

  const handleClick = () => {
    onNavigate();
  };

  if (hasChildren) {
    return (
      <div className="space-y-1">
        <button
          onClick={handleClick}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-sm ${prefersReducedMotion ? 'transition-none' : 'transition-colors'} ${
            isActive
              ? 'bg-brand-50 text-brand-700 font-semibold dark:bg-brand-50 dark:text-brand-700'
              : 'text-surface-700 hover:bg-surface-100 dark:text-surface-700 dark:hover:bg-surface-100'
          }`}
          aria-expanded={false}
        >
          <span aria-hidden="true" className={`shrink-0 h-5 w-5 flex items-center justify-center ${
            isActive ? 'text-brand-600 dark:text-brand-600' : 'text-surface-400 dark:text-surface-400'
          }`}>
            {item.icon}
          </span>
          <span className="flex-1 truncate">{item.label}</span>
          <Icon.ChevronRight size={16} className="text-surface-400 dark:text-surface-400 shrink-0" />
        </button>
        <div className="pl-8 space-y-0.5 border-l border-surface-200 dark:border-surface-200 mt-1">
          {item.children!.map((child) => (
            <NavLink
              key={child.to}
              to={child.to}
              end={child.end}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-3 py-2 rounded text-sm ${prefersReducedMotion ? 'transition-none' : 'transition-colors'} ${
                (child.exact || child.end
                  ? location.pathname === child.to
                  : location.pathname.startsWith(child.to))
                  ? 'bg-brand-50 text-brand-700 font-semibold dark:bg-brand-50 dark:text-brand-700'
                  : 'text-surface-700 hover:bg-surface-100 dark:text-surface-700 dark:hover:bg-surface-100'
              }`}
            >
              <span aria-hidden="true" className={`shrink-0 h-5 w-5 flex items-center justify-center ${
                (child.exact || child.end
                  ? location.pathname === child.to
                  : location.pathname.startsWith(child.to))
                    ? 'text-brand-600 dark:text-brand-600'
                    : 'text-surface-400 dark:text-surface-400'
              }`}>
                {child.icon}
              </span>
              <span className="flex-1 truncate">{child.label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={`flex items-center gap-3 px-3 py-2.5 rounded text-sm ${prefersReducedMotion ? 'transition-none' : 'transition-colors'} ${
        isActive
          ? 'bg-brand-50 text-brand-700 font-semibold dark:bg-brand-50 dark:text-brand-700'
          : 'text-surface-700 hover:bg-surface-100 dark:text-surface-700 dark:hover:bg-surface-100'
      }`}
    >
      <span aria-hidden="true" className={`shrink-0 h-5 w-5 flex items-center justify-center ${
        isActive ? 'text-brand-600 dark:text-brand-600' : 'text-surface-400 dark:text-surface-400'
      }`}>
        {item.icon}
      </span>
      <span className="flex-1 truncate">{item.label}</span>
    </NavLink>
  );
}

interface MobileNavProps {
  groups: Array<{
    title: string;
    items: Array<{
      to: string;
      label: string;
      end?: boolean;
      icon: ReactNode;
      exact?: boolean;
      children?: Array<{
        to: string;
        label: string;
        end?: boolean;
        icon: ReactNode;
        exact?: boolean;
      }>;
    }>;
  }>;
  onNavigate: () => void;
}

export function MobileNav({ groups, onNavigate }: MobileNavProps) {
  const { prefersReducedMotion } = useAppShell();

  return (
    <nav aria-label="Mobile navigation" className="flex-1 overflow-y-auto py-3 pb-safe">
      {groups.map((g) => (
        <div key={g.title} className="mb-4">
          <div className="px-4 mb-2 text-eyebrow">{g.title}</div>
          <div className="space-y-0.5 px-2" role="list">
            {g.items.map((it) => (
              <div key={it.to} role="listitem">
                <MobileNavItem item={it} onNavigate={onNavigate} prefersReducedMotion={prefersReducedMotion} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}