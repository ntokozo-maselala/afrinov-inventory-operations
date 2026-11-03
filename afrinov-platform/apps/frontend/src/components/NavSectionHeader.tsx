// A menu section's title. One that can fold is a button saying whether it is
// open, for the keyboard and screen readers; one that can't is a plain heading.
import { Icon } from './Icon';
import { cn } from '../lib/cn';

export function NavSectionHeader({ title, foldable, open, onToggle, controls, className }: {
  title: string;
  foldable: boolean;
  open: boolean;
  onToggle: () => void;
  /** The id of the list the button opens and folds. */
  controls: string;
  className?: string;
}) {
  if (!foldable) return <div className={cn('px-4 text-eyebrow', className)}>{title}</div>;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className={cn(
        'w-full flex items-center justify-between px-4 text-eyebrow rounded-sm',
        'hover:text-surface-700 focus-visible:outline-2 focus-visible:outline-brand-500',
        className,
      )}
    >
      <span>{title}</span>
      {open ? <Icon.ChevronDown size={12} /> : <Icon.ChevronRight size={12} />}
    </button>
  );
}

/** A stable id for a section's list, unique per menu. */
export const navSectionId = (menu: string, title: string) => `${menu}-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
