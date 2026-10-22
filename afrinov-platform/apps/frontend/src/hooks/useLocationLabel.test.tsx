import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));

const { useLocationLabel } = await import('./useLocationLabel');

describe('useLocationLabel', () => {
  it('adds the room to a stock line location once the rooms arrive', async () => {
    mockGet.mockResolvedValue([
      { id: 'l-1', name: 'D-1', parent: { name: 'Main Storeroom' } },
      { id: 'l-2', name: 'Boiler Shop', parent: null },
    ]);
    const { result } = renderHook(() => useLocationLabel());
    expect(result.current('l-1', 'D-1')).toBe('D-1');
    await waitFor(() => expect(result.current('l-1', 'D-1')).toBe('D-1 · Main Storeroom'));
    expect(result.current('l-2', 'Boiler Shop')).toBe('Boiler Shop');
  });

  it('names a location as it came when the rooms cannot be read', async () => {
    mockGet.mockRejectedValue({ code: 'FORBIDDEN', message: 'No access' });
    const { result } = renderHook(() => useLocationLabel());
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/locations'));
    expect(result.current('l-1', 'D-1')).toBe('D-1');
  });
});
