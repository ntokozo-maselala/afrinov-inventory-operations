// An enum filter read from the query string (?category=, ?type=). Prisma refuses
// a value outside the enum with a validation error that carries no error code,
// so the error handler could only answer it as a 500 and log it as a defect:
// a mistyped filter looked like a server fault and raised a false alarm. A
// filter the list does not know is the caller's mistake, a 400. Every list
// that passes a query string to an enum column goes through here first.
import { Errors } from './errors.js';

/**
 * The filter value, checked against the enum's values: undefined when not
 * given (an empty value is no filter, as before), the value itself when the
 * enum has it, and a 400 VALIDATION_ERROR otherwise.
 */
export function enumFilter<T extends string>(
  raw: string | undefined,
  values: Readonly<Record<string, T>> | readonly T[],
  name: string,
): T | undefined {
  if (raw === undefined || raw === '') return undefined;
  const allowed: readonly string[] = Array.isArray(values) ? values : Object.values(values);
  if (!allowed.includes(raw)) {
    throw Errors.validation(`${name} must be one of ${allowed.join(', ')}`, { [name]: raw });
  }
  return raw as T;
}
