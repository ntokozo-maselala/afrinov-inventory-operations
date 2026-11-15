// The Procurement step's line (Project Tracking Roadmap, Phase 4): how its orders stand and what to watch.
import { describe, it, expect } from 'vitest';
import { procurementStepOf, procurementSummary, procurementWarnings } from './ProcurementStep';
import type { StepProcurement } from '../api/types';

const procurement = (summary: Partial<StepProcurement['summary']> = {}, orders: StepProcurement['orders'] = []): StepProcurement => ({
  projects: ['AFRI-1086'],
  orders,
  summary: { orders: 2, owing: 1, overdue: 0, notPlaced: 0, allReceived: false, closedShort: 0, lastReceivedOn: null, latestExpected: null, ...summary },
});

describe('the Procurement step', () => {
  it('is the first step whose name says Procurement', () => {
    expect(procurementStepOf([{ name: 'Engineering' }, { name: 'Procurement of plate' }, { name: 'Procurement' }])?.name).toBe('Procurement of plate');
    expect(procurementStepOf([{ name: 'Engineering' }])).toBeUndefined();
  });

  it('sums up how the orders stand', () => {
    expect(procurementSummary(procurement({ orders: 0, owing: 0 }))).toBe('No orders yet');
    expect(procurementSummary(procurement({ orders: 3, owing: 1 }))).toBe('3 orders · 1 owing');
    expect(procurementSummary(procurement({ allReceived: true, lastReceivedOn: '2026-03-09' }))).toBe('All delivered, last 09 Mar 2026');
    // Closed short: nothing more is coming, but it is never "All delivered".
    expect(procurementSummary(procurement({ allReceived: true, closedShort: 1, lastReceivedOn: '2026-03-09' }))).toBe('Nothing more coming (1 closed short), last delivery 09 Mar 2026');
    expect(procurementSummary(procurement({ allReceived: true, closedShort: 2 }))).toBe('Nothing more coming (2 closed short)');
  });

  it('warns of overdue orders, material due after the step ends, and orders not placed', () => {
    expect(procurementWarnings(procurement({ overdue: 1, latestExpected: '2026-03-20', notPlaced: 2 }), '2026-03-13')).toEqual([
      '1 order is overdue.',
      'Material is expected 20 Mar 2026, after this step is expected to end (13 Mar 2026).',
      '2 orders are not placed yet (draft or waiting to be signed).',
    ]);
    expect(procurementWarnings(procurement({ latestExpected: '2026-03-10' }), '2026-03-13')).toEqual([]);
    expect(procurementWarnings(procurement({ allReceived: true, closedShort: 1 }), null)).toEqual([
      '1 order was closed short: part of what it ordered never came. Check whether it is still needed before marking this step done.',
    ]);
  });
});
