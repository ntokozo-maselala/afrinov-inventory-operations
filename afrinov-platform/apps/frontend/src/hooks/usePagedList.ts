// A list the API pages newest first by cursor: the first page through useApi,
// then "Load more" appends the rows after the last one shown. Pages loaded for
// one path are dropped when the path changes (a new filter or date).
import { useMemo, useState } from 'react';
import { useApi } from './useApi';
import { useToast } from '../components/Toast';
import { api, type ApiError } from '../api/client';

export function usePagedList<T extends { cursor: string }>(path: string | null, pageSize: number) {
  const sep = path?.includes('?') ? '&' : '?';
  const first = useApi<T[]>(path ? `${path}${sep}limit=${pageSize}` : null);
  const [more, setMore] = useState<{ path: string | null; rows: T[]; done: boolean }>({ path: null, rows: [], done: false });
  const [loadingMore, setLoadingMore] = useState(false);
  const toast = useToast();
  const extra = more.path === path ? more : { path, rows: [] as T[], done: false };
  const rows = useMemo(() => [...(first.data ?? []), ...extra.rows], [first.data, extra.rows]);
  const hasMore = !!first.data && first.data.length === pageSize && !extra.done;

  async function loadMore() {
    const last = rows[rows.length - 1];
    if (!path || !last) return;
    setLoadingMore(true);
    try {
      const page = await api.get<T[]>(`${path}${sep}limit=${pageSize}&before=${encodeURIComponent(last.cursor)}`);
      setMore({ path, rows: [...extra.rows, ...page], done: page.length < pageSize });
    } catch (err) {
      toast.error("Couldn't load more", (err as ApiError).message);
    } finally {
      setLoadingMore(false);
    }
  }

  function reload() {
    setMore({ path: null, rows: [], done: false });
    first.reload();
  }

  return { rows, loading: first.loading, error: first.error, loaded: !!first.data, hasMore, loadMore, loadingMore, reload };
}
