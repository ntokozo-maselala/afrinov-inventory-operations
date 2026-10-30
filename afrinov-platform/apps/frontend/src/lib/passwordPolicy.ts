// The password rules, as the server enforces them (backend
// `modules/identity/password-policy.ts`). Checked here first so the user hears
// about a short password before a round trip; the server stays the authority.

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Field errors for a new password and its confirmation; empty when both are fine. */
export function newPasswordErrors(password: string, confirm: string, email?: string): Record<string, string> {
  const errs: Record<string, string> = {};
  if (password.length < PASSWORD_MIN_LENGTH) errs.newPassword = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  else if (password.length > PASSWORD_MAX_LENGTH) errs.newPassword = `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  else if (password.trim().length === 0) errs.newPassword = 'The password cannot be only spaces.';
  else if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) errs.newPassword = 'Your password cannot be your email address.';
  if (password !== confirm) errs.confirm = 'Passwords do not match.';
  return errs;
}
