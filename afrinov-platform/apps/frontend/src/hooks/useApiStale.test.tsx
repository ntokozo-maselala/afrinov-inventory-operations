// The stale-data policy: a failed refresh keeps the last good data visible, but
// only for transient availability failures. A refusal that says the user may no
// longer see this data (403) must not be softened into "here is the old copy".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ApiError } from '../api/client';

const get = vi.fn();
vi.mock('../api/client', () => ({
  api: { get: (p: string) => get(p) },
  isApiError: (err: unknown) => typeof err === 'object' && err !== null && 'code' in err,
}));

import { useApi } from './useApi';

const apiError = (code: string): ApiError => ({ code, message: code });

describe('useApi — stale presentation policy', () => {
  beforeEach(() => {
    get.mockReset();
  });

  it('keeps the last data and marks it stale when a refresh fails with an outage', async () => {
    get.mockResolvedValueOnce([{ id: 'a' }]);
    const { result } = renderHook(() => useApi<{ id: string }[]>('/materials'));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    get.mockRejectedValueOnce(apiError('SERVICE_UNAVAILABLE'));
    result.current.reload();
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.stale).toBe(true);
    expect(result.current.data).toEqual([{ id: 'a' }]);
  });

  it('does not mark data stale on a permission refusal, so protected rows are suppressed', async () => {
    get.mockResolvedValueOnce([{ id: 'po-1', supplier: 'Acme' }]);
    const { result } = renderHook(() => useApi<{ id: string }[]>('/purchase-orders'));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    get.mockRejectedValueOnce(apiError('FORBIDDEN'));
    result.current.reload();
    await waitFor(() => expect(result.current.error?.code).toBe('FORBIDDEN'));

    expect(result.current.stale).toBe(false);
  });

  it('does not mark data stale when the session ended', async () => {
    get.mockResolvedValueOnce([{ id: 'a' }]);
    const { result } = renderHook(() => useApi<{ id: string }[]>('/materials'));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    get.mockRejectedValueOnce(apiError('UNAUTHENTICATED'));
    result.current.reload();
    await waitFor(() => expect(result.current.error?.code).toBe('UNAUTHENTICATED'));

    expect(result.current.stale).toBe(false);
  });

  it('is not stale when the very first load fails (nothing to keep)', async () => {
    get.mockRejectedValueOnce(apiError('SERVICE_UNAVAILABLE'));
    const { result } = renderHook(() => useApi<unknown[]>('/materials'));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.stale).toBe(false);
    expect(result.current.data).toBeNull();
  });
});
