import { useEffect, useState } from 'react';
import { api, type ApiError, isApiError } from '../api/client';

export function useApi<T>(path: string | null): {
  data: T | null;
  dataPath: string | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
} {
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
        if (!cancelled) setError(isApiError(e) ? e : { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
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

  return { data, dataPath, error, loading, reload: () => setNonce((n) => n + 1) };
}
