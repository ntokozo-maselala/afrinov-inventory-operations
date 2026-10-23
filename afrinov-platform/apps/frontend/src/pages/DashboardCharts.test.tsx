import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardLocationDonut, groupByRoom, type RoomOf } from './DashboardCharts';
import type { ReportLocationRow } from '../api/reportTypes';

const at = (locationId: string, locationName: string, inventoryValue: number, locationType = 'RACK'): ReportLocationRow =>
  ({ locationId, locationName, locationType, quantity: 1, inventoryValue, share: 0 });

describe('groupByRoom', () => {
  it('adds each rack’s value into its room, and keeps locations in no room as they are', () => {
    const roomOf: RoomOf = new Map([['d1', { id: 'store', name: 'Main Storeroom' }], ['f7', { id: 'store', name: 'Main Storeroom' }]]);
    const rows = groupByRoom([
      at('store', 'Main Storeroom', 1000, 'STOREROOM'), at('d1', 'D-1', 90), at('f7', 'F-7', 10), at('boiler', 'Boiler Shop', 500, 'SHOP_FLOOR_AREA'),
    ], roomOf);
    expect(rows.map((r) => [r.locationName, r.inventoryValue, r.quantity])).toEqual([
      ['Main Storeroom', 1100, 3],
      ['Boiler Shop', 500, 1],
    ]);
  });

  it('names a room from its own row, or from a rack when the room holds nothing itself', () => {
    const roomOf: RoomOf = new Map([['d1', { id: 'store', name: 'Main Storeroom' }]]);
    expect(groupByRoom([at('d1', 'D-1', 90)], roomOf)).toEqual([expect.objectContaining({ locationId: 'store', locationName: 'Main Storeroom', inventoryValue: 90 })]);
  });
});

describe('DashboardLocationDonut', () => {
  const rows = [at('d1', 'D-1', 90), at('boiler', 'Boiler Shop', 500, 'SHOP_FLOOR_AREA')];

  it('switches to rooms, with each rack’s value in its room', () => {
    render(<DashboardLocationDonut locations={rows} currency="ZAR" roomOf={new Map([['d1', { id: 'store', name: 'Main Storeroom' }]])} />);
    expect(screen.getByRole('button', { name: 'By location' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('D-1').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'By room' }));
    expect(screen.getByRole('button', { name: 'By room' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('Main Storeroom').length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: /^Share of priced stock value by room:/ })).toBeInTheDocument();
    expect(screen.queryByText('D-1')).toBeNull();
  });

  it('offers no grouping while no location stands in a room', () => {
    render(<DashboardLocationDonut locations={rows} currency="ZAR" roomOf={new Map()} />);
    expect(screen.queryByRole('button', { name: 'By room' })).toBeNull();
  });
});
