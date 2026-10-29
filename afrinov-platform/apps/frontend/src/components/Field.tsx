import type {
  ReactNode,
  Ref,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
} from 'react';

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
  ref?: Ref<HTMLInputElement>;
}

export function Input({ invalid, className = '', ref, ...rest }: InputProps) {
  return <input ref={ref} className={`input ${invalid ? 'input-error' : ''} ${className}`} {...rest} />;
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ invalid, className = '', ref, ...rest }: TextareaProps) {
  return <textarea ref={ref} className={`textarea ${invalid ? 'input-error' : ''} ${className}`} {...rest} />;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  ref?: Ref<HTMLSelectElement>;
}

export function Select({ invalid, className = '', children, ref, ...rest }: SelectProps) {
  return (
    <select ref={ref} className={`select ${invalid ? 'input-error' : ''} ${className}`} {...rest}>
      {children}
    </select>
  );
}
