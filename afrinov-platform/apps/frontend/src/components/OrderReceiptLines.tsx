// What arrived against a purchase order: one row per order line still
// outstanding, filled in with what is owed, each with where it goes, for
// Receive delivery on the order's page. Each line is sent with the order line
// it credits; typing lines by hand used to book the stock without crediting
// the order.
import { Button } from './Button';
import { Select, Input } from './Field';
import { formatNumber } from '../lib/format';
import { locationLabel } from '../lib/locations';

export interface OrderForReceipt {
  id: string; number: string; supplierId: string;
  lines: Array<{ id: string; materialId: string; orderedQty: string; receivedQty: string; material: { sku: string; name: string; unitOfMeasure: string } }>;
}

export interface ReceiptLineDraft {
  materialId: string; locationId: string; quantity: string;
  /** Set when the line comes from a purchase order: the order line it credits. */
  purchaseOrderLineId?: string;
  /** For order lines: what the order still expects, shown beside the quantity. */
  outstanding?: number; label?: string; unit?: string;
}

interface LocationOpt { id: string; name: string; parent?: { name: string } | null }

/** The order's lines with something still outstanding, each filled in with that amount. */
export function receiptLinesFromOrder(order: OrderForReceipt): ReceiptLineDraft[] {
  return order.lines
    .map((l) => ({ l, outstanding: Number(l.orderedQty) - Number(l.receivedQty) }))
    .filter(({ outstanding }) => outstanding > 0)
    .map(({ l, outstanding }) => ({
      materialId: l.materialId, locationId: '', quantity: String(outstanding), purchaseOrderLineId: l.id,
      outstanding, label: `${l.material.sku} — ${l.material.name}`, unit: l.material.unitOfMeasure,
    }));
}

/** The lines that arrived (lines left at 0 did not), or why they can't be received. */
export function checkReceiptLines(lines: ReceiptLineDraft[], fromOrder: boolean): { lines: ReceiptLineDraft[] } | { problem: string } {
  const arrived = lines.filter((l) => l.materialId && Number(l.quantity) > 0);
  if (arrived.length === 0) return { problem: fromOrder ? 'Enter what arrived on at least one line.' : 'Add at least one complete line.' };
  if (arrived.some((l) => !l.locationId)) return { problem: 'Choose where each line is going.' };
  const over = arrived.find((l) => l.outstanding !== undefined && Number(l.quantity) > l.outstanding);
  if (over) return { problem: `${over.label}: only ${formatNumber(over.outstanding!)} ${over.unit ?? ''} is still outstanding.` };
  return { lines: arrived };
}

/** The receipt lines as the server takes them. */
export function receiptLinesBody(lines: ReceiptLineDraft[]) {
  return lines.map((l) => ({
    materialId: l.materialId, locationId: l.locationId, quantity: Number(l.quantity),
    ...(l.purchaseOrderLineId ? { purchaseOrderLineId: l.purchaseOrderLineId } : {}),
  }));
}

/** The "Receive every line into…" picker for the heading above the rows. */
export function EveryLineInto({ locations, onChoose }: { locations: LocationOpt[]; onChoose: (locationId: string) => void }) {
  return (
    <Select value="" onChange={(e) => onChoose(e.target.value)} aria-label="Receive every line into" className="sm:w-56">
      <option value="">Receive every line into…</option>
      {locations.map((loc) => <option key={loc.id} value={loc.id}>{locationLabel(loc)}</option>)}
    </Select>
  );
}

/** One row for an order line: the item and what is outstanding, where it goes, how many came. */
export function OrderReceiptRow({ line, index, locations, onChange }: {
  line: ReceiptLineDraft; index: number; locations: LocationOpt[]; onChange: (patch: Partial<ReceiptLineDraft>) => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-2 items-start">
      <div className="col-span-12 sm:col-span-5 text-sm pt-1.5">
        {line.label}
        <div className="text-meta">{formatNumber(line.outstanding!)} {line.unit} outstanding</div>
      </div>
      <div className="col-span-7 sm:col-span-3">
        <Select value={line.locationId} onChange={(e) => onChange({ locationId: e.target.value })} aria-label={`Line ${index + 1} location`}>
          <option value="">Location…</option>
          {locations.map((loc) => <option key={loc.id} value={loc.id}>{locationLabel(loc)}</option>)}
        </Select>
      </div>
      <div className="col-span-5 sm:col-span-2">
        <Input type="number" min="0" max={line.outstanding} step="0.0001" placeholder="Qty" value={line.quantity} onChange={(e) => onChange({ quantity: e.target.value })} aria-label={`Line ${index + 1} quantity`} />
      </div>
      <div className="col-span-12 sm:col-span-2">
        <Button size="sm" variant="ghost" type="button" onClick={() => onChange({ quantity: '0' })} className="w-full">None came</Button>
      </div>
    </div>
  );
}
