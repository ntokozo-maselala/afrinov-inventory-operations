import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { movementReason, stillOutOn, visitFigures } from './movementReason';

// The same rows, and the same text, the server's download is tested against.
const shared = JSON.parse(readFileSync(resolve(process.cwd(), '../backend/src/modules/inventory/movement-reason.cases.json'), 'utf8')) as {
  cases: Array<{ name: string; row: Parameters<typeof movementReason>[0]; text: string }>;
};

// Five cut-off discs to Khodani; at the counter, two back on the shelf, two used up, one broken.
const issue = {
  type: 'ISSUE', quantity: '-5', reasonCode: null, reversesId: null, recipientName: 'Khodani',
  returnedQuantity: '2', usedUpQuantity: '2', brokenQuantity: '1', trackUse: true,
};
const ret = { type: 'RETURN', quantity: '2', reasonCode: null, reversesId: null, recipientName: 'Khodani', usedUpQuantity: '2', brokenQuantity: '1' };

describe('movementReason', () => {
  it.each(shared.cases.map((c) => [c.name, c] as const))('writes the same text as the server download: %s', (_name, c) => {
    expect(movementReason(c.row)).toBe(c.text);
  });

  it('says on an issue only who it went to and how much is still out, never what came back later', () => {
    expect(stillOutOn(issue)).toBe(0);
    expect(movementReason(issue, { withWho: true })).toBe('To Khodani · still out 0');
    expect(movementReason({ ...issue, returnedQuantity: '0', usedUpQuantity: '1', brokenQuantity: '0' })).toBe('still out 4');
    // Switched off since: the marks made before still count.
    expect(movementReason({ ...issue, trackUse: false })).toBe('still out 0');
    // An item that does not track use is used once issued: nothing to say.
    expect(movementReason({ ...issue, trackUse: false, usedUpQuantity: '0', brokenQuantity: '0' })).toBe('');
  });

  it('says on a return what came back in that visit', () => {
    expect(visitFigures(ret)).toEqual({ back: 2, usedUp: 2, broken: 1, withdrawn: false });
    expect(movementReason(ret, { withWho: true })).toBe('From Khodani · back 2, used up 2, broken 1');
    expect(movementReason({ ...ret, usedUpQuantity: '0', brokenQuantity: '0' })).toBe('back 2');
  });

  it('says on a mark of its own, and on a withdrawal, how many', () => {
    expect(movementReason({ type: 'USED_UP', quantity: null, reasonCode: null, recipientName: 'Khodani', usedUpQuantity: '3' }, { withWho: true }))
      .toBe('From Khodani · used up 3');
    expect(movementReason({ type: 'OUTCOME_WITHDRAWN', quantity: null, reasonCode: null, brokenQuantity: '1' })).toBe('withdrawn: broken 1');
  });

  it('keeps an adjustment reason, every word of it, and says nothing about a reversal', () => {
    expect(movementReason({ type: 'ADJUSTMENT', quantity: '-5', reasonCode: 'COUNT_VARIANCE' })).toBe('count variance');
    expect(movementReason({ ...issue, quantity: '5', reversesId: 'tx-1' }, { withWho: true })).toBe('');
  });
});
