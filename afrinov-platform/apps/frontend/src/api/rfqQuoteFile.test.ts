// The quotation PDF is checked before it is sent: a PDF, up to 10 MB, as the server takes it.
import { describe, it, expect, vi } from 'vitest';

const fetchSpy = vi.fn();
vi.stubGlobal('fetch', fetchSpy);

const { QUOTE_FILE_LIMIT, uploadQuoteFile } = await import('./rfqQuoteFile');

describe('uploadQuoteFile', () => {
  it('refuses a file over 10 MB or one that is not a PDF, without sending it', async () => {
    const big = new File([new Uint8Array(QUOTE_FILE_LIMIT + 1)], 'scan.pdf', { type: 'application/pdf' });
    await expect(uploadQuoteFile('r-1', 's-1', big)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('10 MB') });
    const word = new File(['quote'], 'quote.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    await expect(uploadQuoteFile('r-1', 's-1', word)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('not a PDF') });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the PDF itself, with its name in the X-File-Name header', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'r-1' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const pdf = new File(['%PDF-1.4'], 'EMV quote é.pdf', { type: 'application/pdf' });
    await expect(uploadQuoteFile('r-1', 's 1', pdf)).resolves.toEqual({ id: 'r-1' });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/v1/rfqs/r-1/suppliers/s%201/quote-file');
    expect(init).toMatchObject({ method: 'PUT', headers: expect.objectContaining({ 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent('EMV quote é.pdf') }) });
  });
});
