// Translate a technical failure into calm, user-safe feedback.
//
// This is the single place that decides what a user reads when something goes
// wrong. It is deliberately framework-free (no React) so it can be unit-tested
// on its own and reused by toasts, inline panels and full-page states alike.
//
// Rules:
//   * The user-facing text is chosen from this module, never taken verbatim
//     from an exception, a stack trace or an arbitrary server string.
//   * Business-rule failures are the exception: the server owns the wording of
//     the constraint it enforced (the SKU and quantities, say), and inventing
//     our own would misstate the rule. For those codes the server message is
//     shown, but only when the code is on the approved list below.
//   * Every message names what happened and what to do next, and never claims
//     data is safe unless the system can establish that.
import { isApiError, isSafeServerMessage, type ApiError } from '../api/client';

export type ErrorTone = 'info' | 'warning' | 'danger';

export interface PresentedError {
  /** Short heading, e.g. "We're having trouble connecting". */
  title: string;
  /** One or two calm sentences naming what happened and what to do. */
  message: string;
  tone: ErrorTone;
  /** Whether a plain retry is appropriate. False for failures that will repeat. */
  retryable: boolean;
  /** Label for the retry action, when retryable. */
  retryLabel: string;
  /** Correlation id to quote to support, when the server supplied one. */
  reference?: string;
}

/**
 * Codes whose server-supplied message is domain wording we must not replace:
 * it names the actual constraint (an item and its available stock, a duplicate
 * value, an invalid state transition). For these, `message` is shown as-is.
 */
const DOMAIN_MESSAGE_CODES = new Set([
  'VALIDATION_ERROR',
  'CONFLICT',
  'INVALID_STATE',
  'INSUFFICIENT_BALANCE',
]);

function titleFor(code: string): { title: string; message: string; tone: ErrorTone; retryable: boolean; retryLabel: string } {
  switch (code) {
    // Network / availability — the user's work is not the problem.
    case 'SERVICE_UNAVAILABLE':
      return {
        title: "We're having trouble connecting",
        message: 'Afrinov Inventory is temporarily unavailable. Please try again in a moment.',
        tone: 'warning',
        retryable: true,
        retryLabel: 'Try again',
      };
    case 'NETWORK_ERROR':
      return {
        title: 'Connection interrupted',
        message: "We couldn't reach the server. Check your connection and try again.",
        tone: 'warning',
        retryable: true,
        retryLabel: 'Retry',
      };
    case 'TIMEOUT':
      return {
        title: 'This is taking longer than expected',
        message: 'The server did not respond in time. Please try again.',
        tone: 'warning',
        retryable: true,
        retryLabel: 'Try again',
      };
    // Authentication / authorization.
    case 'UNAUTHENTICATED':
      return {
        title: 'Your session has ended',
        message: 'Please sign in again to continue.',
        tone: 'warning',
        retryable: false,
        retryLabel: 'Sign in',
      };
    case 'FORBIDDEN':
      return {
        title: "You don't have access to this action",
        message: "Your current permissions don't allow you to complete this operation. Contact your administrator if you believe you need access.",
        tone: 'warning',
        retryable: false,
        retryLabel: 'Back',
      };
    // Missing resource.
    case 'NOT_FOUND':
      return {
        title: "We couldn't find that record",
        message: 'The item may have been moved, removed, or may no longer be available.',
        tone: 'info',
        retryable: false,
        retryLabel: 'Back',
      };
    // Throttling.
    case 'TOO_MANY_REQUESTS':
      return {
        title: 'Too many requests',
        message: 'Please wait a moment before trying again.',
        tone: 'warning',
        retryable: true,
        retryLabel: 'Try again',
      };
    // A mutation whose outcome could not be confirmed: the request may have
    // been committed and only the answer lost. Never invite a blind retry —
    // the user is asked to check the records first.
    case 'OUTCOME_UNKNOWN':
      return {
        title: "We couldn't confirm that change",
        message: 'The connection was lost before we could confirm whether it was saved. Check the records before trying again, so the change is not made twice.',
        tone: 'warning',
        retryable: false,
        retryLabel: 'Back',
      };
    // A form resubmitted with a stale submission identifier. Not the user's
    // fault and not a data problem: invite them to submit again.
    case 'IDEMPOTENCY_KEY_REUSED':
      return {
        title: 'Please submit this again',
        message: 'This form was already submitted with different details. Review what you entered and submit it once more.',
        tone: 'warning',
        retryable: false,
        retryLabel: 'Back',
      };
    // A field-level validation failure. Not a defect and not retryable
    // unchanged: the user must correct the highlighted input first.
    case 'VALIDATION_ERROR':
      return {
        title: 'A few details need attention',
        message: 'Please review the highlighted fields and correct the information before continuing.',
        tone: 'warning',
        retryable: false,
        retryLabel: 'Back',
      };
    // A business-rule refusal the server owns the wording for: insufficient
    // stock, a duplicate, an invalid state transition. Retrying unchanged
    // cannot succeed, so no retry is offered.
    case 'CONFLICT':
    case 'INVALID_STATE':
    case 'INSUFFICIENT_BALANCE':
      return {
        title: 'This change needs your attention',
        message: 'This change could not be made as asked. Review the details below and adjust before trying again.',
        tone: 'warning',
        retryable: false,
        retryLabel: 'Back',
      };
    // Malformed request the client produced.
    case 'BAD_REQUEST':
    case 'METHOD_NOT_ALLOWED':
    case 'PAYLOAD_TOO_LARGE':
    case 'UNSUPPORTED_MEDIA_TYPE':
      return {
        title: "That request couldn't be completed",
        message: 'Something about this request was not accepted. Please check your input and try again.',
        tone: 'warning',
        retryable: false,
        retryLabel: 'Back',
      };
    // Anything unrecognised is an unexpected defect: generic, honest, no detail.
    default:
      return {
        title: "Something didn't go as expected",
        message: "We couldn't complete this request. Please try again if it's safe to do so. If the problem continues, contact your system administrator.",
        tone: 'danger',
        retryable: true,
        retryLabel: 'Try again',
      };
  }
}

/**
 * Present any thrown value as user-safe feedback. Never throws and never
 * returns raw exception text: an unknown shape becomes the generic message.
 */
export function presentError(err: unknown): PresentedError {
  const code = isApiError(err) ? err.code : 'INTERNAL_ERROR';
  const base = titleFor(code);

  let message = base.message;
  // Domain wording comes from the server and is shown as-is, but only when it
  // passes the safety check; otherwise the calm fallback stands. The API client
  // already rejects unsafe server text at the boundary; this second check keeps
  // the guarantee even if an error object is constructed elsewhere.
  if (DOMAIN_MESSAGE_CODES.has(code) && isApiError(err) && isSafeServerMessage(err.message)) {
    message = err.message;
  }

  const reference = isApiError(err) && err.requestId ? err.requestId : undefined;

  return {
    title: base.title,
    message,
    tone: base.tone,
    retryable: base.retryable,
    retryLabel: base.retryLabel,
    ...(reference ? { reference } : {}),
  };
}

/** The first field-level message from a validation failure, keyed by field. */
export function fieldErrorsFrom(err: unknown): Record<string, string> {
  const details = isApiError(err) ? err.details : undefined;
  const out: Record<string, string> = {};
  if (!details || typeof details !== 'object') return out;
  const issues = (details as { fieldErrors?: unknown }).fieldErrors;
  if (issues && typeof issues === 'object') {
    for (const [field, messages] of Object.entries(issues as Record<string, unknown>)) {
      const first = Array.isArray(messages) ? messages[0] : messages;
      if (typeof first === 'string' && first.trim()) out[field] = first;
    }
  }
  return out;
}

/** True when the failure is worth retrying without changing the request. */
export function isRetryable(err: unknown): boolean {
  return presentError(err).retryable;
}

/** A short toast description for a failure, used where a toast is the channel. */
export function errorToast(err: unknown): { title: string; description: string } {
  const p = presentError(err);
  return { title: p.title, description: p.message };
}

export type { ApiError };
