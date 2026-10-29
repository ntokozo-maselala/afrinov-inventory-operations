// The paged list must pass the first page's stale flag through: a failed
// refresh keeps its rows on screen, and consumers rely on `stale` to warn
// instead of replacing loaded rows with a hard error.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ApiError } from '../api/client';

const get = vi.fn();
vi.mock('../api/client', () => ({
  api: { get: (p: string) => get(p) },
  isApiError: (err: unknown) => typeof err === 'object' && err !== null && 'code' in err,
}));
vi.mock('../components/Toast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn(), show: vi.fn() }),
}));

import { usePagedList } from './usePagedList';

type Row = { cursor: string; id: string };
const apiError = (code: string): ApiError => ({ code, message: code });

describe('usePagedList — stale pass-through', () => {
  beforeEach(() => { get.mockReset(); });

  it('exposes stale when the first-page refresh fails but rows remain', async () => {
    get.mockResolvedValueOnce([{ cursor: 'c1', id: 'a' }]);
    const { result } = renderHook(() => usePagedList<Row>('/activity', 50));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    get.mockRejectedValueOnce(apiError('SERVICE_UNAVAILABLE'));
    result.current.reload();
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.stale).toBe(true);
    expect(result.current.rows).toEqual([{ cursor: 'c1', id: 'a' }]);
  });

  it('is not stale when the first page never loaded', async () => {
    get.mockRejectedValueOnce(apiError('SERVICE_UNAVAILABLE'));
    const { result } = renderHook(() => usePagedList<Row>('/activity', 50));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.stale).toBe(false);
    expect(result.current.loaded).toBe(false);
  });
});
