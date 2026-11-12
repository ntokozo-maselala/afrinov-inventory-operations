// Procurement's requests for quotation, as their list and detail pages take them.
// Kept as an area so another kind could share the pages again.
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
