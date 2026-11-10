// A keypad for a counter PIN (ADR-034): 4 to 6 digits, typed by the person it
// belongs to, on a touch screen or a keyboard. The digits are never shown,
// only how many have been typed.
import { useEffect } from 'react';
import { cn } from '../lib/cn';

export const PIN_MIN = 4;
export const PIN_MAX = 6;

export function PinPad({ value, onChange, onSubmit, submitLabel = 'Confirm', disabled, label }: {
  value: string;
  onChange: (pin: string) => void;
  /** Called with 4 to 6 digits, from the button or the Enter key. */
  onSubmit: (pin: string) => void;
  submitLabel?: string;
  disabled?: boolean;
  /** Read by screen readers above the keys, e.g. "Sabelo, enter your PIN". */
  label: string;
}) {
  const press = (key: string) => {
    if (disabled) return;
    if (key === 'clear') onChange('');
    else if (key === 'back') onChange(value.slice(0, -1));
    else if (value.length < PIN_MAX) onChange(value + key);
  };
  const ready = value.length >= PIN_MIN;

  // Digits typed on a keyboard work too, unless someone is typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled || (e.target instanceof Element && e.target.closest('input, textarea, select'))) return;
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); if (value.length < PIN_MAX) onChange(value + e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); onChange(value.slice(0, -1)); }
      else if (e.key === 'Enter' && value.length >= PIN_MIN) { e.preventDefault(); onSubmit(value); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [value, onChange, onSubmit, disabled]);

  return (
    <div className="flex flex-col items-center gap-3" role="group" aria-label={label}>
      <p className="text-sm text-surface-700">{label}</p>
      <div className="flex gap-3" aria-live="polite" aria-label={`${value.length} digit${value.length === 1 ? '' : 's'} entered`}>
        {Array.from({ length: Math.max(PIN_MIN, value.length) }, (_, i) => (
          <span key={i} className={cn('h-4 w-4 rounded-full border-2', i < value.length ? 'bg-surface-900 border-surface-900' : 'border-surface-400')} aria-hidden="true" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <PadKey key={k} onClick={() => press(k)} disabled={disabled}>{k}</PadKey>
        ))}
        <PadKey onClick={() => press('clear')} disabled={disabled} small>Clear</PadKey>
        <PadKey onClick={() => press('0')} disabled={disabled}>0</PadKey>
        <PadKey onClick={() => press('back')} disabled={disabled} small aria-label="Delete the last digit">⌫</PadKey>
      </div>
      <button type="button" className="btn-primary w-full max-w-[14.5rem]" disabled={disabled || !ready} onClick={() => onSubmit(value)}>
        {submitLabel}
      </button>
    </div>
  );
}

function PadKey({ children, onClick, disabled, small, ...rest }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; small?: boolean; 'aria-label'?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn('h-12 w-[4.5rem] rounded-md border border-surface-200 bg-surface-50 text-surface-900 hover:bg-surface-100 active:bg-surface-200 disabled:opacity-50 font-mono tabular-nums', small ? 'text-xs text-surface-500' : 'text-xl')}
      {...rest}
    >
      {children}
    </button>
  );
}
