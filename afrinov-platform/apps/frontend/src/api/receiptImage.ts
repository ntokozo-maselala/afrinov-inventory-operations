// The signature or signed-slip photo a slip was confirmed with (ADR-034). An
// <img> can't send the sign-in token, so the image is fetched with it and shown
// from a local object URL. Frontend-only mode keeps it in the mock's memory.
import { useEffect, useState } from 'react';
import { FRONTEND_ONLY, getToken } from './client';

async function fetchReceiptImage(slipId: string): Promise<Blob> {
  if (FRONTEND_ONLY) {
    const { mockGetReceiptImage } = await import('../mock/mockReceipts');
    return mockGetReceiptImage(slipId);
  }
  const token = getToken();
  const res = await fetch(`/api/v1/slips/${encodeURIComponent(slipId)}/confirmation/image`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.blob();
}

/** An object URL for the slip's image while the component is shown; null until it loads, or if it can't. */
export function useReceiptImage(slipId: string, wanted: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    let made: string | null = null;
    fetchReceiptImage(slipId)
      .then((blob) => { if (!cancelled) { made = URL.createObjectURL(blob); setUrl(made); } })
      .catch(() => { if (!cancelled) setUrl(null); });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [slipId, wanted]);
  return url;
}
