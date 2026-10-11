import { Badge } from './Badge';
import { STATUS_LABEL, STATUS_TONE, type StockStatus } from '../lib/stockStatus';

/** URGENT / WARNING / OK / Not set, as the stock workbook's URGENCY column, with the percentage when known. */
export function StockStatusBadge({ status, percent }: { status: StockStatus | null | undefined; percent?: number | null }) {
  if (!status) return null;
  const title = status === 'NOT_SET'
    ? 'No Required Stock is set for this item'
    : percent !== null && percent !== undefined ? `${percent}% of Required Stock on hand` : undefined;
  return <Badge tone={STATUS_TONE[status]} dot title={title}>{STATUS_LABEL[status]}</Badge>;
}
