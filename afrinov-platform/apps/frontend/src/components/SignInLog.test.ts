// The sign-in log's filters (system audit F3).
import { describe, it, expect } from 'vitest';
import { OUTCOME_LABEL, signInQuery } from './SignInLog';

describe('signInQuery', () => {
  it('sends only the filters that are set, a page at a time', () => {
    expect(signInQuery({ outcome: '', email: ' ', from: '', to: '', offset: 0 })).toBe('limit=50');
    expect(signInQuery({ outcome: 'FAILED', email: 'thabo', from: '2026-11-01', to: '2026-11-12', offset: 50 }))
      .toBe('outcome=FAILED&email=thabo&from=2026-11-01&to=2026-11-12&limit=50&offset=50');
  });

  it('names every outcome the server writes', () => {
    expect(Object.keys(OUTCOME_LABEL)).toEqual(['SIGN_IN', 'FAILED', 'THROTTLED', 'SIGN_OUT']);
  });
});
