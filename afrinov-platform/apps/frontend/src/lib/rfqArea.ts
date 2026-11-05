// The two kinds of request for quotation, which share their list and detail
// pages: Procurement's, awarded as a purchase order, and Sales', kept to compare.
// Each has its own server routes and permission, as buyers don't see what Sales
// was quoted.
import type { Permission } from '../hooks/usePermissions';

export interface RfqArea {
  /** Its routes on the server. */
  api: string;
  /** Its pages in the app. */
  path: string;
  managePermission: Permission;
  /** A sent one can be awarded, raising a purchase order. */
  canAward: boolean;
  title: string;
  listTitle: string;
  listDescription: string;
  raiseLabel: string;
  emptyTitle: string;
  emptyDescription: string;
}

export const PROCUREMENT_RFQS: RfqArea = {
  api: '/rfqs',
  path: '/rfqs',
  managePermission: 'procurement:manage',
  canAward: true,
  title: 'Request for quotation',
  listTitle: 'Requests for quotation',
  listDescription: 'Ask suppliers to price what you need, as on the RFQ sheet, before raising the order.',
  raiseLabel: 'New RFQ',
  emptyTitle: 'No requests for quotation yet',
  emptyDescription: 'Raise an RFQ to ask suppliers for prices before ordering.',
};

export const SALES_RFQS: RfqArea = {
  api: '/sales-rfqs',
  path: '/sales-rfqs',
  managePermission: 'sales:manage',
  canAward: false,
  title: 'Sales RFQ',
  listTitle: 'Sales RFQs',
  listDescription: 'Ask suppliers to price a job while costing it, as on the RFQ sheet. Only Sales and senior managers see these prices.',
  raiseLabel: 'New Sales RFQ',
  emptyTitle: 'No Sales RFQs yet',
  emptyDescription: 'Raise one to ask suppliers for prices while costing a job.',
};
