// When an adjustment needs someone else's approval (ADR-028): its exact value
// against the limit, a zero limit meaning every one, and no unit cost always.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const settings = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));
vi.mock('../settings/settings.service.js', () => ({ SettingsService: { getValues: async () => settings.values } }));

const { checkWriteOff } = await import('./write-off-limit.js');
const D = (v: number | string) => new Prisma.Decimal(v);

beforeEach(() => {
  settings.values = { 'inventory.requireWriteOffApproval': true, 'inventory.writeOffApprovalAbove': 1000 };
});

describe('checkWriteOff', () => {
  it('posts at once within the limit, either way the stock moves', async () => {
    expect(await checkWriteOff(D(-4), D(250))).toMatchObject({ needsApproval: false, value: D(1000) });
    expect((await checkWriteOff(D(4), D(250))).needsApproval).toBe(false);
  });

  // Qodo, PR #151: rounded first, R 1 000,004 compared as R 1 000,00 and posted.
  it('compares the exact value, rounding only what is stored', async () => {
    const check = await checkWriteOff(D(-1), D('1000.004'));
    expect(check.needsApproval).toBe(true);
    expect(check.value!.toFixed(2)).toBe('1000.00');
  });

  it('always waits for an item with no unit cost', async () => {
    expect(await checkWriteOff(D(-1), null)).toMatchObject({ needsApproval: true, value: null });
  });

  // Qodo, PR #151: "0: every adjustment waits", a free item included.
  it('holds every adjustment when the limit is 0, even of an item that costs nothing', async () => {
    settings.values['inventory.writeOffApprovalAbove'] = 0;
    expect((await checkWriteOff(D(-1), D(0))).needsApproval).toBe(true);
    expect((await checkWriteOff(D('0.0001'), D('0.01'))).needsApproval).toBe(true);
  });

  it('holds nothing when approval is switched off', async () => {
    settings.values['inventory.requireWriteOffApproval'] = false;
    expect((await checkWriteOff(D(-100), null)).needsApproval).toBe(false);
    expect((await checkWriteOff(D(-100), D(999))).needsApproval).toBe(false);
  });
});
