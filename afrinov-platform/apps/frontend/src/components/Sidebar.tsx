import { NavLink, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Logo } from './Logo';
import { Tooltip, TooltipTrigger, TooltipContent } from '@radix-ui/react-tooltip';
import { Icon } from './Icon';
import { useAppShell } from '../hooks/useAppShell';
import { cn } from '../lib/cn';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  icon?: ReactNode;
  badge?: ReactNode;
  children?: NavItem[];
  exact?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

interface SidebarProps {
  groups: NavGroup[];
  onNavigate?: () => void;
  isMobile?: boolean;
}

function NavItemComponent({
  item,
  isCollapsed,
  onNavigate,
  level = 0,
  prefersReducedMotion = false,
}: {
  item: NavItem;
  isCollapsed: boolean;
  onNavigate?: () => void;
  level?: number;
  prefersReducedMotion?: boolean;
}) {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const hasChildren = item.children && item.children.length > 0;
  const isActive = item.exact || item.end
    ? location.pathname === item.to
    : location.pathname.startsWith(item.to);
  const isChildActive = hasChildren && item.children!.some((child) =>
    child.exact || child.end
      ? location.pathname === child.to
      : location.pathname.startsWith(child.to)
  );

  const baseClass = isCollapsed
    ? 'flex justify-center items-center py-2.5 mx-0 rounded text-sm transition-colors'
    : 'flex items-center gap-2.5 px-3 py-1.5 mx-2 rounded text-sm transition-colors';

  const stateClass = (isActive || isChildActive)
    ? 'bg-brand-50 text-brand-700 font-semibold dark:bg-brand-50 dark:text-brand-700'
    : 'text-surface-700 hover:bg-surface-100 dark:text-surface-700 dark:hover:bg-surface-100';

  const iconColorClass = (isActive || isChildActive)
    ? 'text-brand-600 dark:text-brand-600'
    : 'text-surface-400 dark:text-surface-400';

  const handleClick = (e: React.MouseEvent) => {
    if (hasChildren && !isCollapsed) {
      e.preventDefault();
      setIsOpen(!isOpen);
      return;
    }
    onNavigate?.();
  };

  const content = (
    <>
      {item.icon && (
        <span aria-hidden="true" className={cn('shrink-0', isCollapsed ? 'h-5 w-5' : 'h-4 w-4', iconColorClass)}>
          {item.icon}
        </span>
      )}
      {!isCollapsed && (
        <span className="flex-1 truncate">{item.label}</span>
      )}
      {!isCollapsed && hasChildren && (
        <Icon.ChevronRight
          size={14}
          className={cn(
            'shrink-0',
            prefersReducedMotion ? 'transition-none' : 'transition-transform',
            prefersReducedMotion ? 'duration-0' : 'duration-150',
            iconColorClass,
            isOpen && 'rotate-90'
          )}
          aria-hidden="true"
        />
      )}
      {!isCollapsed && item.badge}
    </>
  );

  if (isCollapsed) {
    if (hasChildren) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleClick}
              className={cn(baseClass, stateClass, 'relative w-full')}
              aria-label={item.label}
              aria-expanded={isOpen}
              aria-haspopup="true"
            >
              {content}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" align="center" sideOffset={8} className="bg-surface-900 text-surface-50 text-xs px-2 py-1 rounded">
            {item.label}
          </TooltipContent>
        </Tooltip>
      );
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={cn(baseClass, stateClass, 'relative')}
            aria-label={item.label}
          >
            {content}
          </NavLink>
        </TooltipTrigger>
        <TooltipContent side="right" align="center" sideOffset={8} className="bg-surface-900 text-surface-50 text-xs px-2 py-1 rounded">
          {item.label}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (hasChildren) {
    return (
      <div>
        <button
          onClick={handleClick}
          className={cn(baseClass, stateClass, 'w-full')}
          aria-expanded={isOpen}
          aria-controls={`nav-submenu-${item.to}`}
          id={`nav-trigger-${item.to}`}
        >
          {content}
        </button>
        <ul
          id={`nav-submenu-${item.to}`}
          role="list"
          className={cn(
            'overflow-hidden',
            prefersReducedMotion ? 'transition-none duration-0' : 'transition-all duration-150 ease-out',
            isOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
          )}
          style={{ paddingLeft: level > 0 ? '1.5rem' : '2rem' }}
        >
          {item.children!.map((child) => (
            <li key={child.to}>
              <NavItemComponent item={child} isCollapsed={false} onNavigate={onNavigate} level={level + 1} prefersReducedMotion={prefersReducedMotion} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={cn(baseClass, stateClass)}
    >
      {content}
    </NavLink>
  );
}

export function Sidebar({ groups, onNavigate, isMobile = false }: SidebarProps) {
  const { sidebarMode, prefersReducedMotion } = useAppShell();
  const isCollapsed = sidebarMode === 'collapsed';

  return (
    <nav
      aria-label={isMobile ? 'Mobile navigation' : 'Main'}
      className={cn(
        'h-full flex flex-col bg-surface-0 border-r border-surface-200 dark:bg-surface-0 dark:border-surface-200',
        isCollapsed && 'w-[var(--sidebar-width-collapsed)]',
        !isCollapsed && !isMobile && 'w-[var(--sidebar-width-expanded)]'
      )}
      style={{
        width: isCollapsed
          ? 'var(--sidebar-width-collapsed)'
          : isMobile
          ? 'var(--sidebar-width-mobile)'
          : 'var(--sidebar-width-expanded)',
      }}
    >
      <div className="flex items-center gap-2 border-b border-surface-200 dark:border-surface-200 px-3 py-3">
        <span className="inline-flex items-center justify-center h-8 w-8 rounded-md bg-brand-50 flex-shrink-0">
          <Logo size={22} decorative />
        </span>
        {!isCollapsed && !isMobile && (
          <div className="leading-tight truncate min-w-0">
            <div className="text-sm font-semibold text-surface-900 dark:text-surface-900">Afrinov IMS</div>
            <div className="text-xs text-surface-500 dark:text-surface-500">Inventory & Operations</div>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto py-3" style={{ minHeight: 0 }}>
        {groups.map((g) => (
          <div key={g.title} className="mb-4">
            {!isCollapsed && (
              <div className="px-4 mb-1.5 text-eyebrow">{g.title}</div>
            )}
            <ul className={cn('space-y-0.5', isCollapsed ? 'mx-1.5' : 'mx-2')} role="list">
              {g.items.map((it) => (
                <li key={it.to}>
                  <NavItemComponent item={it} isCollapsed={isCollapsed} onNavigate={onNavigate} prefersReducedMotion={prefersReducedMotion} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

export function CollapsedSidebar({ groups, onNavigate }: SidebarProps) {
  return <Sidebar groups={groups} onNavigate={onNavigate} />;
}