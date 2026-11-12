// The sign-in log's keeping and writing (system audit F3).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = { deleted: [] as unknown[], created: [] as unknown[], fail: false };
vi.mock('../../shared/db.js', () => ({
  prisma: {
    signInEvent: {
      deleteMany: async (args: unknown) => { calls.deleted.push(args); return { count: 3 }; },
      create: async (args: { data: unknown }) => {
        if (calls.fail) throw new Error('database down');
        calls.created.push(args.data);
        return args.data;
      },
    },
  },
}));

beforeEach(() => { calls.deleted.length = 0; calls.created.length = 0; calls.fail = false; });

describe('sign-in log', () => {
  it('removes rows older than 12 months', async () => {
    const { pruneSignIns } = await import('./sign-in-log.js');
    expect(await pruneSignIns(new Date('2026-11-12T08:00:00Z'))).toBe(3);
    expect(calls.deleted).toEqual([{ where: { createdAt: { lt: new Date('2025-11-12T08:00:00Z') } } }]);
  });

  it('keeps the address and browser short, the email in lower case, and never fails the sign-in', async () => {
    const { recordSignIn } = await import('./sign-in-log.js');
    await recordSignIn({ userId: 'u-1', email: ' Alice@Afrinov.local ', outcome: 'SIGN_IN', ip: '10.0.0.5', userAgent: 'x'.repeat(400) });
    expect(calls.created[0]).toMatchObject({ email: 'alice@afrinov.local', ip: '10.0.0.5', userAgent: 'x'.repeat(300) });
    calls.fail = true;
    const errors: string[] = [];
    await expect(recordSignIn({ userId: null, email: 'a@b.c', outcome: 'FAILED' }, (e) => errors.push(e.message))).resolves.toBeUndefined();
    expect(errors).toEqual(['database down']);
  });
});
