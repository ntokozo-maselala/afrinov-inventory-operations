// The orders behind a Procurement step (Project Tracking Roadmap, Phase 4).
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProcurementOrdersDialog, procurementStepOf, procurementSummary, procurementWarnings } from './ProcurementStep';
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

  it('lists the orders, linking them for those who see orders, with the project when it covers several', () => {
    const p = procurement({}, [
      { id: 'po-1', number: 'AFRI-0101', status: 'RECEIVED', projectNumber: 'AFRI-1086', supplierName: 'Steel Co', lines: 2, linesOwed: 0, expectedDelivery: '2026-03-06', lastReceivedOn: '2026-03-09', overdue: false, closedShort: false },
      { id: 'po-3', number: 'AFRI-0103', status: 'CLOSED', projectNumber: 'AFRI-1086', supplierName: 'Bolt Co', lines: 1, linesOwed: 0, expectedDelivery: '2026-03-04', lastReceivedOn: null, overdue: false, closedShort: true },
      { id: 'po-2', number: 'AFRI-0102', status: 'APPROVED', projectNumber: 'AFRI-1087', supplierName: 'Pipe Co', lines: 3, linesOwed: 2, expectedDelivery: '2026-03-05', lastReceivedOn: null, overdue: true, closedShort: false },
    ]);
    p.projects = ['AFRI-1086', 'AFRI-1087'];
    const { unmount } = render(<MemoryRouter><ProcurementOrdersDialog procurement={p} canOpenOrders onClose={() => {}} /></MemoryRouter>);
    const rows = within(screen.getByRole('table', { name: 'Orders for this job' })).getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByRole('link', { name: 'AFRI-0101' })).toHaveAttribute('href', '/purchase-orders/po-1');
    expect(within(rows[1]!).getByText('Closed short')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('AFRI-1087')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('2 of 3 lines')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Overdue')).toBeInTheDocument();
    unmount();

    render(<MemoryRouter><ProcurementOrdersDialog procurement={p} canOpenOrders={false} onClose={() => {}} /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'AFRI-0101' })).not.toBeInTheDocument();
    expect(screen.getByText('AFRI-0101')).toBeInTheDocument();
  });
});
