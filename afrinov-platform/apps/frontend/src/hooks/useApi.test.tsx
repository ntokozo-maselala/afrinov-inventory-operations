import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createMockApi, resetMockState } from '../mock/mockApi';
import type { MockMaterial } from '../mock/types';

vi.mock('../api/client', () => {
  const mockApi = createMockApi();
  return {
    api: mockApi,
    FRONTEND_ONLY: true,
    isApiError: (err: unknown) => typeof err === 'object' && err !== null && 'code' in err,
  };
});

import { useApi } from '../hooks/useApi';

describe('hooks/useApi.ts — data fetching hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockState();
  });

  it('returns loading state initially', () => {
    const { result } = renderHook(() => useApi<MockMaterial[]>('/materials'));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('fetches data and returns success state', async () => {
    const { result } = renderHook(() => useApi<MockMaterial[]>('/materials'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeTruthy();
    expect(Array.isArray(result.current.data)).toBe(true);
    expect(result.current.data!.length).toBeGreaterThan(0);
    expect(result.current.error).toBeNull();
  });

  it('returns dataPath matching the request path', async () => {
    const { result } = renderHook(() => useApi<MockMaterial[]>('/materials'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dataPath).toBe('/materials');
  });

  it('handles error for non-existent path', async () => {
    const { result } = renderHook(() => useApi<MockMaterial[]>('/non-existent-path'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.error!.code).toBe('NOT_FOUND');
    expect(result.current.data).toBeNull();
  });

  it('reload function triggers new fetch', async () => {
    const { result } = renderHook(() => useApi<MockMaterial[]>('/materials'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      result.current.reload();
    });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeTruthy();
  });

  it('returns null data when path is null', () => {
    const { result } = renderHook(() => useApi<MockMaterial[]>(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.dataPath).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('clears data when path changes', async () => {
    const { result, rerender } = renderHook(({ path }) => useApi<MockMaterial[]>(path), { initialProps: { path: '/materials' } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeTruthy();
    rerender({ path: '/suppliers' });
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeTruthy();
    expect(result.current.dataPath).toBe('/suppliers');
  });

  it('cancels previous request when path changes', async () => {
    const { result, rerender } = renderHook(({ path }) => useApi<MockMaterial[]>(path), { initialProps: { path: '/materials' } });
    rerender({ path: '/suppliers' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dataPath).toBe('/suppliers');
  });
});