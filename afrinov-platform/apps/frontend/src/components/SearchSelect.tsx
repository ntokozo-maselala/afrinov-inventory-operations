// A select you can type into: the list narrows to options containing every
// word typed (name, SKU, location, ...), as the workbook's lookup does. Used
// for picking items on the entry screens, where a plain <select> runs to
// hundreds of rows. Follows the ARIA combobox pattern.
import { useId, useMemo, useRef, useState } from 'react';

export interface SearchOption {
  value: string;
  label: string;
  /** Second line under the label, e.g. stock on hand. */
  detail?: string;
  /** Extra text to match on besides the label and detail. */
  keywords?: string;
}

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchOption[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Shown when nothing matches what was typed. */
  noMatchText?: string;
  autoFocus?: boolean;
}

const MAX_SHOWN = 50;

export function matches(option: SearchOption, query: string): boolean {
  const haystack = `${option.label} ${option.detail ?? ''} ${option.keywords ?? ''}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
}

export function SearchSelect({ id, value, onChange, options, placeholder = 'Type to search…', disabled, invalid, noMatchText = 'Nothing matches', autoFocus }: Props) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => (query.trim() ? options.filter((o) => matches(o, query)) : options), [options, query]);
  const shown = filtered.slice(0, MAX_SHOWN);

  function pick(option: SearchOption) {
    onChange(option.value);
    setQuery('');
    setOpen(false);
  }

  function close() {
    setQuery('');
    setActive(0);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      // Never submit the surrounding form from the search box.
      e.preventDefault();
      if (open && shown[active]) pick(shown[active]);
      else setOpen(true);
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); close(); }
    }
  }

  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? optionId(active) : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        className={`input pr-8 ${invalid ? 'input-error' : ''}`}
        placeholder={selected ? undefined : placeholder}
        value={open ? query : (selected?.label ?? '')}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={close}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      <span aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-surface-400 text-xs">▾</span>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded border border-surface-200 bg-surface-0 shadow-lg py-1"
        >
          {shown.length === 0 && <li className="px-3 py-2 text-sm text-surface-500">{noMatchText}</li>}
          {shown.map((o, i) => (
            <li
              key={o.value}
              id={optionId(i)}
              role="option"
              aria-selected={o.value === value}
              className={`search-option px-3 py-2 cursor-pointer ${i === active ? 'bg-brand-50' : ''}`}
              // mousedown, not click: it fires before the input's blur closes the list.
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setActive(i)}
            >
              <div className="text-sm text-surface-900">{o.label}</div>
              {o.detail && <div className="text-xs text-surface-500">{o.detail}</div>}
            </li>
          ))}
          {filtered.length > MAX_SHOWN && (
            <li className="px-3 py-2 text-xs text-surface-500">{filtered.length - MAX_SHOWN} more. Keep typing to narrow the list.</li>
          )}
        </ul>
      )}
    </div>
  );
}
