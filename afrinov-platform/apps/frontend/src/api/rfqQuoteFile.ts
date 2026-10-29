// A supplier's quotation PDF on a request for quotation (RFQ roadmap, Phase 4):
// sent to the server as the file itself, not as JSON, with its name in the
// X-File-Name header, and downloaded back as it was attached. Frontend-only
// mode keeps it in the mock's memory.
import { FRONTEND_ONLY, getToken, type ApiError } from './client';
import { errorMessage, triggerDownload } from './exportReport';

/** As the server takes it; the rest of the API takes 1 MB. */
export const QUOTE_FILE_LIMIT = 10 * 1024 * 1024;

const path = (rfqId: string, supplierId: string) => `/rfqs/${rfqId}/suppliers/${encodeURIComponent(supplierId)}/quote-file`;

/**
 * Attaches the file, replacing one attached before, and answers with the RFQ.
 * A file that isn't a PDF or is over 10 MB is refused here, before it is sent.
 */
export async function uploadQuoteFile<T>(rfqId: string, supplierId: string, file: File): Promise<T> {
  if (file.size > QUOTE_FILE_LIMIT) throw apiError('VALIDATION_ERROR', `${file.name} is larger than 10 MB. Attach a smaller copy of the quotation.`);
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw apiError('VALIDATION_ERROR', `${file.name} is not a PDF. The RFQ asks for quotations back as PDF.`);
  const data = new Uint8Array(await file.arrayBuffer());
  if (FRONTEND_ONLY) {
    const { mockPutQuoteFile } = await import('../mock/mockApi');
    return mockPutQuoteFile(rfqId, supplierId, file.name, data) as Promise<T>;
  }
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`/api/v1${path(rfqId, supplierId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/pdf',
        'X-File-Name': encodeURIComponent(file.name),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: data,
    });
  } catch {
    throw apiError('NETWORK_ERROR', 'Unable to reach the server. Check your connection and try again.');
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: ApiError }) | null;
  if (!res.ok) throw body?.error ?? apiError('INTERNAL_ERROR', res.status === 413 ? 'The quotation is larger than 10 MB.' : `Upload failed (${res.status})`);
  return body as T;
}

/** Downloads the quotation as it was attached, under its own name. */
export async function downloadQuoteFile(rfqId: string, supplierId: string, fileName: string): Promise<void> {
  if (FRONTEND_ONLY) {
    const { mockGetQuoteFile } = await import('../mock/mockApi');
    const file = mockGetQuoteFile(rfqId, supplierId);
    triggerDownload(new Blob([file.data as BlobPart], { type: 'application/pdf' }), file.fileName);
    return;
  }
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`/api/v1${path(rfqId, supplierId)}`, { headers: { Accept: 'application/pdf', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  } catch {
    throw new Error('Unable to reach the server. Check your connection and try again.');
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  // The name the RFQ's page shows, accents and all; the header's plain copy swaps those for _.
  triggerDownload(await res.blob(), fileName);
}

function apiError(code: string, message: string): ApiError {
  return { code, message };
}
