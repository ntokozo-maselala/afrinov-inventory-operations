import { describe, expect, it } from 'vitest';
import { newPasswordErrors } from './passwordPolicy';

describe('newPasswordErrors', () => {
  it('accepts a password of 12 or more characters that matches its confirmation', () => {
    expect(newPasswordErrors('twelve-chars', 'twelve-chars')).toEqual({});
  });

  it('asks for at least 12 characters, as the server does', () => {
    expect(newPasswordErrors('eleven-char', 'eleven-char')).toEqual({ newPassword: 'Use at least 12 characters.' });
  });

  it('refuses only spaces, the email address, and a mismatched confirmation', () => {
    expect(newPasswordErrors('            ', '            ').newPassword).toMatch(/only spaces/);
    expect(newPasswordErrors('Alice@Afrinov.local', 'Alice@Afrinov.local', 'alice@afrinov.local').newPassword).toMatch(/email/);
    expect(newPasswordErrors('a-long-password', 'a-long-passw0rd')).toEqual({ confirm: 'Passwords do not match.' });
  });
});
