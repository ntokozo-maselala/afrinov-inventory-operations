// Comparing the quotes on a request for quotation, and awarding it (RFQ
// roadmap, Phase 5). A row per line and a column per supplier who quoted:
// their unit price and subtotal, the lowest price on each line marked among
// quotes in the same currency, and under the lines each quote's total, VAT,
// net value, lead time and how long it holds.
//
// Award raises a draft purchase order for that supplier at their prices. A
// reason is asked for when the award isn't the clear choice, as the server asks.
import { useState, type ReactNode } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Field, Textarea } from './Field';
import { Alert } from './Alert';
import { Badge } from './Badge';
import { api, type ApiError } from '../api/client';
import { formatMoney } from '../lib/poMoney';
import { formatNumber } from '../lib/format';
import { awardConcerns, formatDay, todayInSouthAfrica, type Rfq, type RfqSupplier } from '../lib/rfq';

const nameOf = (s: RfqSupplier) => s.supplier?.name ?? s.supplierId;
const currencyOf = (s: RfqSupplier) => s.supplier?.currency ?? 'ZAR';
const priceOf = (s: RfqSupplier, lineId: string) => {
  const p = s.prices?.find((x) => x.rfqLineId === lineId);
  return p ? Number(p.unitPrice) : null;
};

export function RfqComparison({ rfq, onAward }: {
  rfq: Rfq;
  /** Offered while the RFQ is sent, to those who may award. */
  onAward?: (s: RfqSupplier) => void;
}) {
  const today = todayInSouthAfrica();
  const quotes = rfq.suppliers.filter((s) => s.quotedAt && !s.declined && s.totals);
  if (quotes.length === 0) return null;
  const lines = [...rfq.lines].sort((a, b) => a.lineNo - b.lineNo);
  // The lowest price on a line among quotes in the same currency; other currencies aren't weighed against each other.
  const lowest = (lineId: string, currency: string) => {
    const prices = quotes.filter((s) => currencyOf(s) === currency).map((s) => priceOf(s, lineId)).filter((p): p is number => p !== null);
    return prices.length > 1 ? Math.min(...prices) : null;
  };
  const lowestNet = (currency: string) => {
    const nets = quotes.filter((s) => currencyOf(s) === currency && s.totals!.unpricedLines === 0).map((s) => Number(s.totals!.net));
    return nets.length > 1 ? Math.min(...nets) : null;
  };
  const currencies = new Set(quotes.map(currencyOf));

  return (
    <div className="surface-card overflow-x-auto">
      <table className="w-full text-sm" aria-label="Quote comparison">
        <thead>
          <tr className="border-b border-surface-200 text-left align-bottom">
            <th className="px-3 py-2 font-medium text-surface-500" scope="col">Line</th>
            <th className="px-3 py-2 font-medium text-surface-500 text-right" scope="col">Qty</th>
            {quotes.map((s) => (
              <th key={s.supplierId} scope="col" className="px-3 py-2 text-right font-semibold text-surface-900">
                {nameOf(s)}
                <div className="text-meta font-normal">{currencyOf(s)}{s.quoteReference ? ` · ${s.quoteReference}` : ''}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b border-surface-100">
              <th scope="row" className="px-3 py-2 text-left font-normal">
                <span className="font-mono text-surface-500 mr-1">{l.lineNo}</span>
                {l.material ? `${l.material.sku} ${l.material.name}` : l.materialId}
              </th>
              <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{formatNumber(Number(l.quantity))} <span className="text-meta">{l.material?.unitOfMeasure}</span></td>
              {quotes.map((s) => {
                const price = priceOf(s, l.id);
                const best = price !== null && price === lowest(l.id, currencyOf(s));
                return (
                  <td key={s.supplierId} className={`px-3 py-2 text-right whitespace-nowrap ${best ? 'bg-success-50 dark:bg-success-900/30' : ''}`}>
                    {price === null ? <span className="text-meta">Not offered</span> : (
                      <>
                        <span className="font-mono">{formatMoney(String(price), currencyOf(s))}</span>
                        {best && <span className="sr-only"> (lowest)</span>}
                        <div className="text-meta font-mono">{formatMoney((price * Number(l.quantity)).toFixed(2), currencyOf(s))}</div>
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <Row label="Total (excl. VAT)" quotes={quotes} cell={(s) => <span className="font-mono">{formatMoney(s.totals!.subtotal, currencyOf(s))}</span>} />
          <Row label="VAT" quotes={quotes} cell={(s) => <span className="font-mono">{formatMoney(s.totals!.vat, currencyOf(s))}</span>} />
          <Row label="Net value" quotes={quotes} cell={(s) => {
            const best = s.totals!.unpricedLines === 0 && Number(s.totals!.net) === lowestNet(currencyOf(s));
            return (
              <span className={`font-mono font-semibold ${best ? 'text-success-700' : ''}`}>
                {formatMoney(s.totals!.net, currencyOf(s))}{best && <span className="sr-only"> (lowest complete quote)</span>}
              </span>
            );
          }} />
          <Row label="Lines not offered" quotes={quotes} cell={(s) => (s.totals!.unpricedLines ? <Badge tone="warning">{s.totals!.unpricedLines}</Badge> : <span className="text-meta">None</span>)} />
          <Row label="Lead time" quotes={quotes} cell={(s) => s.leadTime ?? <span className="text-meta">—</span>} />
          <Row label="Valid until" quotes={quotes} cell={(s) => {
            const until = s.validUntil?.slice(0, 10);
            if (!until) return <span className="text-meta">—</span>;
            return until < today ? <Badge tone="danger">Ran out {formatDay(until)}</Badge> : formatDay(until);
          }} />
          {onAward && (
            <Row label="" quotes={quotes} cell={(s) => (
              <Button size="sm" variant="primary" onClick={() => onAward(s)} aria-label={`Award to ${nameOf(s)}`}>Award</Button>
            )} />
          )}
        </tfoot>
      </table>
      {currencies.size > 1 && <p className="text-meta px-3 py-2">Quotes in different currencies are shown side by side, but only compared with quotes in the same currency.</p>}
    </div>
  );
}

function Row({ label, quotes, cell }: { label: string; quotes: RfqSupplier[]; cell: (s: RfqSupplier) => ReactNode }) {
  return (
    <tr className="border-t border-surface-100">
      <th scope="row" colSpan={2} className="px-3 py-2 text-left font-medium text-surface-600">{label}</th>
      {quotes.map((s) => <td key={s.supplierId} className="px-3 py-2 text-right whitespace-nowrap">{cell(s)}</td>)}
    </tr>
  );
}

/**
 * Confirms the award, asking why when it isn't the clear choice. On success,
 * hands back the RFQ with its new order.
 */
export function RfqAwardDialog({ rfq, chosen, onClose, onAwarded }: {
  rfq: Rfq;
  chosen: RfqSupplier;
  onClose: () => void;
  onAwarded: (saved: Rfq) => void;
}) {
  const concerns = awardConcerns(rfq, chosen.supplierId, todayInSouthAfrica());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const needsReason = concerns.length > 0;

  async function award() {
    setBusy(true);
    setProblem(null);
    try {
      onAwarded(await api.post<Rfq>(`/rfqs/${rfq.id}/award`, { supplierId: chosen.supplierId, reason: reason.trim() || null }));
    } catch (err) {
      setProblem((err as ApiError).message ?? String(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      open onClose={onClose} size="md"
      title={`Award ${rfq.number} to ${nameOf(chosen)}?`}
      description={`A draft purchase order is raised for ${nameOf(chosen)} at their quoted prices, ${formatMoney(chosen.totals?.net, currencyOf(chosen))} including VAT. It then goes for approval as any order does, and the RFQ's quotes can no longer change.`}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Not yet</Button>
          <Button variant="primary" onClick={() => void award()} loading={busy} disabled={needsReason && !reason.trim()}>Award and raise order</Button>
        </>
      )}
    >
      <div className="space-y-3">
        {needsReason && (
          <Alert tone="warning" title="Say why">
            <ul className="list-disc pl-5">{concerns.map((c) => <li key={c}>{c}.</li>)}</ul>
          </Alert>
        )}
        <Field label="Reason" htmlFor="rfq-award-reason" required={needsReason} help={needsReason ? 'Kept on the RFQ’s Activity.' : 'Optional: the clear choice needs none.'}>
          <Textarea id="rfq-award-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Only supplier who can deliver by month end" />
        </Field>
        {problem && <Alert tone="danger" title="Not awarded">{problem}</Alert>}
      </div>
    </Modal>
  );
}
