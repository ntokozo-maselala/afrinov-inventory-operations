// Sales RFQs share Procurement's list and detail pages; only what differs is in SALES_RFQS.
import { SALES_RFQS } from '../lib/rfqArea';
import { RfqPage } from './RfqDetail';
import { RfqList } from './Rfqs';

export function SalesRfqs() {
  return <RfqList area={SALES_RFQS} />;
}

export function SalesRfqDetail() {
  return <RfqPage area={SALES_RFQS} />;
}
