import { useEffect, useState } from 'react';
import { api, type ApiError, isApiError } from '../api/client';

export interface UseApiResult<T> {
  data: T | null;
  dataPath: string | null;
  error: ApiError | null;
  loading: boolean;
  /**
   * True when a refresh failed but earlier data for the same path is still
   * shown. The data is real, just not freshly confirmed — the UI must say so
   * rather than present it as current or blank the page out.
   */
  stale: boolean;
  reload: () => void;
}

const unknownError = (): ApiError => ({
  code: 'INTERNAL_ERROR',
  message: 'An unexpected error occurred.',
});

export function useApi<T>(path: string | null): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [dataPath, setDataPath] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [nonce, setNonce] = useState(0);

  // eslint-disable react-hooks/set-state-in-effect
  useEffect(() => {
    if (path === null) return;
    let cancelled = false;
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
    api
      .get<T>(path)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setDataPath(path);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(isApiError(e) ? e : unknownError());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, nonce]);
  // eslint-enable react-hooks/set-state-in-effect

  // eslint-disable react-hooks/set-state-in-effect
  useEffect(() => {
    setData(null); // eslint-disable-line react-hooks/set-state-in-effect
    setDataPath(null);
    setError(null);
    setLoading(path !== null);
  }, [path]);
  // eslint-enable react-hooks/set-state-in-effect

  // A failed refresh keeps the previous data visible, so the failure is a stale
  // warning, not a blank page. Only a failure with no prior data for this path
  // is a hard error state.
  //
  // Stale presentation is limited to transient availability failures. A refusal
  // that says the user may no longer see this data (403, or a session that
  // ended) must not be softened into "here is the old copy": the protected rows
  // are suppressed and the refusal is shown.
  const stale = !!error && data !== null && dataPath === path && isTransientFailure(error);

  return { data, dataPath, error, loading, stale, reload: () => setNonce((n) => n + 1) };
}

/** Failures where showing the last good data beside a warning is appropriate. */
function isTransientFailure(error: ApiError): boolean {
  return error.code === 'SERVICE_UNAVAILABLE'
    || error.code === 'NETWORK_ERROR'
    || error.code === 'TIMEOUT'
    || error.code === 'TOO_MANY_REQUESTS'
    || error.code === 'INTERNAL_ERROR';
}
