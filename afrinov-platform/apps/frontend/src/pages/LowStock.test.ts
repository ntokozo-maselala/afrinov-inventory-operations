// Unit tests for the Low Stock page's classification and shortfall logic.
//
// The page exposes two pure helpers (`classifyStock` and `shortfallOf`)
// so the rendering and the API filtering cannot drift apart. The tests
// pin the documented business rules:
//
//   OUT_OF_STOCK : onHand <= 0
//   LOW_STOCK    : 0 < onHand <= reorderAt
//   IN_STOCK     : onHand >  reorderAt
//
//   shortfall   = max(reorderAt - onHand, 0)  (always non-negative)
import { describe, expect, it } from 'vitest';
import { classifyStock, shortfallOf } from './LowStock';

describe('classifyStock', () => {
  it('scenario 1: onHand 8 / reorder 10 → LOW_STOCK', () => {
    expect(classifyStock(8, 10)).toBe('LOW_STOCK');
  });

  it('scenario 2: onHand exactly equal to reorder 10 → LOW_STOCK', () => {
    expect(classifyStock(10, 10)).toBe('LOW_STOCK');
  });

  it('scenario 3: onHand 15 / reorder 10 → IN_STOCK', () => {
    expect(classifyStock(15, 10)).toBe('IN_STOCK');
  });

  it('scenario 4: onHand 0 / reorder 10 → OUT_OF_STOCK', () => {
    expect(classifyStock(0, 10)).toBe('OUT_OF_STOCK');
  });

  it('negative onHand is treated as OUT_OF_STOCK', () => {
    expect(classifyStock(-1, 10)).toBe('OUT_OF_STOCK');
  });

  it('zero reorder is treated as: any positive balance is IN_STOCK; zero balance is OUT_OF_STOCK', () => {
    expect(classifyStock(0, 0)).toBe('OUT_OF_STOCK');
    expect(classifyStock(1, 0)).toBe('IN_STOCK');
  });
});

describe('shortfallOf', () => {
  it('scenario 1: onHand 8 / reorder 10 → shortfall 2', () => {
    expect(shortfallOf(8, 10)).toBe(2);
  });

  it('scenario 2: onHand 10 / reorder 10 → shortfall 0 (at threshold)', () => {
    expect(shortfallOf(10, 10)).toBe(0);
  });

  it('scenario 3: onHand 15 / reorder 10 → shortfall 0 (above threshold)', () => {
    expect(shortfallOf(15, 10)).toBe(0);
  });

  it('scenario 4: onHand 0 / reorder 10 → shortfall 10', () => {
    expect(shortfallOf(0, 10)).toBe(10);
  });

  it('never returns a negative shortfall', () => {
    expect(shortfallOf(20, 10)).toBe(0);
    expect(shortfallOf(100, 0)).toBe(0);
    expect(shortfallOf(-5, 10)).toBe(15);
  });
});
