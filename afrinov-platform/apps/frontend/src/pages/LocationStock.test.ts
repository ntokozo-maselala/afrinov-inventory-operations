// What a location holds, counted as items with stock (system audit A4).
import { describe, it, expect } from 'vitest';
import { stockedText } from './Locations';

describe('stockedText', () => {
  it('says Empty for no stock, and how many items are held for projects', () => {
    expect(stockedText({ inventoryCount: 0, heldForProjectCount: 0 })).toBe('Empty');
    expect(stockedText({})).toBe('Empty');
    expect(stockedText({ inventoryCount: 1 })).toBe('1 item in stock');
    expect(stockedText({ inventoryCount: 3, heldForProjectCount: 1 })).toBe('3 items in stock, 1 of them held for a project');
    expect(stockedText({ inventoryCount: 3, heldForProjectCount: 2 })).toBe('3 items in stock, 2 of them held for projects');
  });
});
