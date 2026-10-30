// The password rules, in one place for creating a user, an administrator's
// reset and a user's own change (PRA-05).
//
// Length is what makes a password hard to guess, so the rule is a minimum
// length rather than character classes (NIST SP 800-63B). The maximum keeps
// the input bounded: bcrypt only reads the first 72 bytes anyway.
import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`)
  .regex(/[^\0]/)
  .refine((p) => p.trim().length > 0, 'The password cannot be only spaces');
