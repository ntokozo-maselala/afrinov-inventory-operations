import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react';
import { forwardRef } from 'react';

interface FieldProps {
  label?: string;
  htmlFor?: string;
  required?: boolean;
  help?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, required, help, error, children, className = '' }: FieldProps) {
  return (
    <div className={`field ${className}`}>
      {label && (
        <label htmlFor={htmlFor} className={`field-label ${required ? 'field-required' : ''}`}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p role="alert" className="field-error">{error}</p>
      ) : help ? (
        <p className="field-help">{help}</p>
      ) : null}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ invalid, className = '', ...rest }, ref) => (
  <input ref={ref} className={`input ${invalid ? 'input-error' : ''} ${className}`} {...rest} />
));
Input.displayName = 'Input';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ invalid, className = '', ...rest }, ref) => (
  <textarea ref={ref} className={`textarea ${invalid ? 'input-error' : ''} ${className}`} {...rest} />
));
Textarea.displayName = 'Textarea';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ invalid, className = '', children, ...rest }, ref) => (
  <select ref={ref} className={`select ${invalid ? 'input-error' : ''} ${className}`} {...rest}>
    {children}
  </select>
));
Select.displayName = 'Select';
