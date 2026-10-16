// The filter row above a list or report: labelled fields, each only as wide as
// it needs, side by side and wrapping (one to a row on a phone), with Clear
// filters and how much is shown underneath. Pages put Field-wrapped controls
// inside, sized with the widths below.
import type { ReactNode, Ref } from 'react';
import { Button } from './Button';
import { Field, Input } from './Field';
import { Icon } from './Icon';

export const FILTER_WIDTH = 'w-full sm:w-64';
export const SEARCH_WIDTH = 'w-full sm:w-80';
export const DATE_WIDTH = 'w-full sm:w-44';

export function FilterBar({ children, onClear, count }: {
  children: ReactNode;
  /** Shown as Clear filters when given; pass it only while a filter is set. */
  onClear?: () => void;
  /** What is shown, e.g. "12 of 40". */
  count?: ReactNode;
}) {
  return (
    <div className="mb-3 no-print">
      <div className="flex flex-wrap items-end gap-3">{children}</div>
      {(onClear || count) && (
        <div className="flex items-center justify-end gap-3 mt-2">
          {onClear && <Button variant="ghost" size="sm" onClick={onClear}>Clear filters</Button>}
          {count && <span className="text-meta">{count}</span>}
        </div>
      )}
    </div>
  );
}

/** The labelled search box of a filter row. */
export function SearchField({ id, value, onChange, placeholder, inputRef }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <Field label="Search" htmlFor={id} className={SEARCH_WIDTH}>
      <div className="relative">
        <span aria-hidden="true" className="absolute left-2.5 top-2.5 text-surface-400"><Icon.Search /></span>
        <Input id={id} ref={inputRef} className="pl-8" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </Field>
  );
}
