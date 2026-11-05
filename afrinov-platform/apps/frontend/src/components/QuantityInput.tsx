import type { InputHTMLAttributes, Ref } from 'react';
import { Input } from './Field';
import type { UnitKind } from '../lib/quantity';

interface QuantityInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode'> {
  /** Counted units get the number pad with no decimal key on a phone. */
  kind: UnitKind;
  /** Shown inside the field, after the number. Left out where a column already says it. */
  unit?: string;
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}

/**
 * A stock quantity in an item's unit. Plain text, not type="number", so there
 * are no spinner steps of 0,0001, a comma reads as the decimal mark, and what
 * was typed is checked by parseQuantity (lib/quantity.ts) rather than dropped.
 */
export function QuantityInput({ kind, unit, className = '', ref, ...rest }: QuantityInputProps) {
  const input = (
    <Input
      ref={ref}
      type="text"
      inputMode={kind === 'COUNTED' ? 'numeric' : 'decimal'}
      autoComplete="off"
      spellCheck={false}
      className={`font-mono tabular-nums ${unit ? 'pr-14' : ''} ${className}`}
      {...rest}
    />
  );
  if (!unit) return input;
  return (
    <div className="relative">
      {input}
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 font-mono text-xs text-surface-500">
        {unit}
      </span>
    </div>
  );
}
