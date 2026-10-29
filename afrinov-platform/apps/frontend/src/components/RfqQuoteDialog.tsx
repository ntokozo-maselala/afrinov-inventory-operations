// Recording one supplier's answer to a request for quotation (RFQ roadmap,
// Phase 4): either their quote, typed in from the quotation they sent back
// (a unit price per line, their reference, when it came in, how long it holds,
// their lead time) with their own PDF attached, or that they declined.
//
// Prices exclude VAT and are in the supplier's currency; the totals under the
// lines are worked out as the server will, with VAT at the supplier's rate.
// A line the supplier doesn't offer is left blank.
import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Field, Input, Textarea } from './Field';
import { Alert } from './Alert';
import { api, type ApiError } from '../api/client';
import { QUOTE_FILE_LIMIT, uploadQuoteFile } from '../api/rfqQuoteFile';
import { formatMoney, formatRate, priceLines } from '../lib/poMoney';
import { formatNumber } from '../lib/format';
import { fourDecimals, todayInSouthAfrica, type Rfq, type RfqSupplier } from '../lib/rfq';

const LINE_GRID = 'grid grid-cols-12 sm:grid-cols-[2.5rem_minmax(0,1fr)_4.5rem_5.5rem_8rem_8.5rem] gap-2 items-center';

/** As the server takes it: 0 or more, to at most 4 decimal places. */
function badPrice(v: string): boolean {
  const n = Number(v);
  return !(n >= 0 && n <= 1e12) || !fourDecimals(n);
}

const sizeLabel = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function RfqQuoteDialog({ rfq, asked, onClose, onSaved, onChanged }: {
  rfq: Rfq;
  asked: RfqSupplier;
  onClose: () => void;
  /** Everything saved: the RFQ after the last save, and what was done. */
  onSaved: (saved: Rfq, message: string) => void;
  /** Part saved before a failure: the page reloads, the dialog stays open with the message. */
  onChanged: () => void;
}) {
  const name = asked.supplier?.name ?? asked.supplierId;
  const currency = asked.supplier?.currency ?? 'ZAR';
  const vatRate = asked.vatRate ?? 0;
  const today = todayInSouthAfrica();
  const lines = [...rfq.lines].sort((a, b) => a.lineNo - b.lineNo);
  const [answer, setAnswer] = useState<'quoted' | 'declined'>(asked.declined ? 'declined' : 'quoted');
  const [prices, setPrices] = useState<Record<string, string>>(
    () => Object.fromEntries((asked.prices ?? []).map((p) => [p.rfqLineId, String(Number(p.unitPrice))])),
  );
  const [quotedAt, setQuotedAt] = useState(asked.quotedAt?.slice(0, 10) ?? today);
  const [reference, setReference] = useState(asked.quoteReference ?? '');
  const [validUntil, setValidUntil] = useState(asked.validUntil?.slice(0, 10) ?? '');
  const [leadTime, setLeadTime] = useState(asked.leadTime ?? '');
  const [notes, setNotes] = useState(asked.notes ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const preview = priceLines(lines.map((l) => ({ id: l.id, orderedQty: l.quantity, unitPrice: prices[l.id]?.trim() ? prices[l.id] : null })), vatRate);

  function check(): string | null {
    if (file && file.size > QUOTE_FILE_LIMIT) return `${file.name} is larger than 10 MB. Attach a smaller copy of the quotation.`;
    if (answer === 'declined') return null;
    const priced = lines.filter((l) => prices[l.id]?.trim());
    if (priced.length === 0) return 'Enter a price for at least one line, or record that the supplier declined.';
    const bad = priced.find((l) => badPrice(prices[l.id]!));
    if (bad) return `Line ${bad.lineNo} needs a price of 0 or more, to at most 4 decimal places.`;
    if (!quotedAt || quotedAt > today) return 'Enter the day the quote came in; it can’t be later than today.';
    if (validUntil && validUntil < quotedAt) return 'The quote can’t be valid only until a day before it came in. Check the valid-until date.';
    return null;
  }

  async function save() {
    const why = check();
    setProblem(why);
    if (why) return;
    setBusy(true);
    const base = `/rfqs/${rfq.id}/suppliers/${encodeURIComponent(asked.supplierId)}`;
    let saved: Rfq | null = null;
    try {
      saved = answer === 'declined'
        ? await api.post<Rfq>(`${base}/decline`, { notes: notes.trim() || null })
        : await api.put<Rfq>(`${base}/quote`, {
          quotedAt,
          quoteReference: reference.trim() || null,
          validUntil: validUntil || null,
          leadTime: leadTime.trim() || null,
          notes: notes.trim() || null,
          prices: lines.filter((l) => prices[l.id]?.trim()).map((l) => ({ rfqLineId: l.id, unitPrice: Number(prices[l.id]) })),
        });
      if (removeFile && asked.quoteFile && !file) saved = await api.del<Rfq>(`${base}/quote-file`);
      if (file) saved = await uploadQuoteFile<Rfq>(rfq.id, asked.supplierId, file);
      onSaved(saved, answer === 'declined' ? `${name} declined to quote` : `Quote from ${name} recorded`);
    } catch (err) {
      const message = (err as ApiError).message ?? String(err);
      // Their answer saved but the file didn't: say so, and show the page what did save.
      setProblem(saved ? `Their answer is saved, but the PDF change isn't: ${message}` : message);
      if (saved) onChanged();
      setBusy(false);
    }
  }

  return (
    <Modal
      open onClose={onClose} size="lg"
      title={`${asked.quotedAt ? 'Edit quote' : 'Record quote'}: ${name}`}
      description={`Type the prices in from ${name}'s quotation for ${rfq.number}, excluding VAT, in ${currency}.`}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} loading={busy}>Save</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <fieldset className="flex flex-wrap gap-4 text-sm" aria-label="Their answer">
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="rfq-answer" checked={answer === 'quoted'} onChange={() => setAnswer('quoted')} /> Quoted
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="rfq-answer" checked={answer === 'declined'} onChange={() => setAnswer('declined')} /> Declined to quote
          </label>
        </fieldset>

        {answer === 'quoted' && (
          <>
            <div>
              <div className={`hidden sm:grid ${LINE_GRID} text-meta mb-1`}>
                <span className="text-right">Item</span><span>Description</span><span>Units</span><span className="text-right">Qty</span>
                <span className="text-right">Unit price</span><span className="text-right">Subtotal</span>
              </div>
              <div className="space-y-1">
                {lines.map((l, i) => (
                  <div key={l.id} className={LINE_GRID}>
                    <span className="hidden sm:block text-right font-mono text-sm text-surface-500">{l.lineNo}</span>
                    <span className="col-span-12 sm:col-span-1 text-sm truncate">{l.material ? `${l.material.sku} ${l.material.name}` : l.materialId}</span>
                    <span className="col-span-3 sm:col-span-1 text-sm text-surface-600">{l.material?.unitOfMeasure ?? '—'}</span>
                    <span className="col-span-3 sm:col-span-1 text-sm text-right font-mono">{formatNumber(Number(l.quantity))}</span>
                    <Input
                      className="col-span-3 sm:col-span-1 text-right" type="number" min="0" step="0.0001" inputMode="decimal" placeholder="Not offered"
                      value={prices[l.id] ?? ''} onChange={(e) => setPrices((p) => ({ ...p, [l.id]: e.target.value }))}
                      aria-label={`Line ${l.lineNo} unit price`}
                    />
                    <output aria-label={`Line ${l.lineNo} subtotal`} className="col-span-3 sm:col-span-1 text-sm text-right font-mono">
                      {preview.lines[i]?.subtotal ? formatMoney(preview.lines[i]!.subtotal, currency) : '—'}
                    </output>
                  </div>
                ))}
              </div>
              <dl className="mt-3 ml-auto text-sm grid grid-cols-2 gap-x-6 gap-y-1 w-full sm:w-72" aria-label="Quote total">
                <dt className="text-surface-500">Total (excl. VAT)</dt><dd className="text-right font-mono">{formatMoney(preview.totals.subtotal, currency)}</dd>
                <dt className="text-surface-500">VAT {formatRate(vatRate)}</dt><dd className="text-right font-mono">{formatMoney(preview.totals.vat, currency)}</dd>
                <dt className="font-semibold">Net value</dt><dd className="text-right font-mono font-semibold">{formatMoney(preview.totals.net, currency)}</dd>
                {preview.totals.unpricedLines > 0 && (
                  <dd className="col-span-2 text-meta text-right">{preview.totals.unpricedLines === 1 ? '1 line' : `${preview.totals.unpricedLines} lines`} not offered</dd>
                )}
              </dl>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Their quote reference" htmlFor="rfq-quote-ref"><Input id="rfq-quote-ref" maxLength={100} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
              <Field label="Received" htmlFor="rfq-quote-at"><Input id="rfq-quote-at" type="date" max={today} value={quotedAt} onChange={(e) => setQuotedAt(e.target.value)} /></Field>
              <Field label="Valid until" htmlFor="rfq-quote-valid" help="How long their prices hold."><Input id="rfq-quote-valid" type="date" min={quotedAt} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
              <Field label="Lead time" htmlFor="rfq-quote-lead" help="e.g. 2 weeks from order."><Input id="rfq-quote-lead" maxLength={100} value={leadTime} onChange={(e) => setLeadTime(e.target.value)} /></Field>
            </div>
          </>
        )}

        <Field label="Notes" htmlFor="rfq-quote-notes" help={answer === 'declined' ? 'Why they declined, if they said.' : undefined}>
          <Textarea id="rfq-quote-notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <Field label="Their quotation (PDF)" htmlFor="rfq-quote-file" help="Up to 10 MB. Replaces one attached before.">
          <div className="space-y-2">
            {asked.quoteFile && !removeFile && !file && (
              <p className="text-sm">
                {asked.quoteFile.fileName} <span className="text-meta">({sizeLabel(asked.quoteFile.size)})</span>{' '}
                <button type="button" className="btn-link text-sm" onClick={() => setRemoveFile(true)}>Take it off</button>
              </p>
            )}
            {removeFile && <p className="text-sm text-surface-600">It will be taken off when you save. <button type="button" className="btn-link text-sm" onClick={() => setRemoveFile(false)}>Keep it</button></p>}
            <input id="rfq-quote-file" type="file" accept="application/pdf,.pdf" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        </Field>

        {problem && <Alert tone="danger" title="Not saved">{problem}</Alert>}
      </div>
    </Modal>
  );
}
