// Seed mock data for frontend-only mode. Realistic examples reflecting the
// Afrinov domain (fasteners, consumables, tooling, project material). All
// values are in-memory and reset on full page reload.
import type {
  MockMaterial,
  MockLocation,
  MockSupplier,
  MockPurchaseOrder,
  MockGoodsReceipt,
  MockInventoryTransaction,
  MockRack,
  MockProject,
} from './types';

export const SEED_LOCATIONS: MockLocation[] = [
  { id: 'loc-1', name: 'Main Storeroom', code: 'WH-MAIN', type: 'STOREROOM', active: true, address: '12 Industrial Rd, Jet Park' },
  { id: 'loc-2', name: 'Boiler Shop', code: 'WS-BOILER', type: 'SHOP_FLOOR_AREA', active: true, address: 'Workshop A', contactPerson: 'Workshop Foreman', contactPhone: '+27 11 555 0210' },
  { id: 'loc-3', name: 'D-1', code: 'RACK-D1', type: 'RACK', active: true, description: 'Project rack for AFRI-1325' },
  { id: 'loc-4', name: 'F-7', code: 'RACK-F7', type: 'RACK', active: true },
  { id: 'loc-5', name: 'Off-site Container', code: 'OFF-CTN', type: 'OFF_SITE', active: false, notes: 'Decommissioned Q1 2026' },
];

export const SEED_SUPPLIERS: MockSupplier[] = [
  { id: 'sup-1', name: 'Hydroscand', contactName: 'Jan Smit', contactEmail: 'orders@hydroscand.co.za', contactPhone: '+27 11 555 0101', active: true },
  { id: 'sup-2', name: 'Bearings International', contactName: 'T. Naidoo', contactEmail: 'sales@bearings.co.za', contactPhone: '+27 11 555 0145', active: true },
  { id: 'sup-3', name: 'Engineering Fasteners (Pty) Ltd', contactEmail: 'sales@engfast.co.za', contactPhone: '+27 11 555 0177', active: true },
  { id: 'sup-4', name: 'Local Steel Supplies', contactName: 'Mike P.', contactPhone: '+27 11 555 0190', active: true },
];

export const SEED_MATERIALS: MockMaterial[] = [
  { id: 'mat-1', sku: 'M16X40-88-HEX', name: 'M16 x 40 8.8 BLACK HEX SET SCREW', category: 'FASTENERS_SLUGS_INSULATION', unitOfMeasure: 'each', requiredStock: '50', unitCost: '4.50', active: true },
  { id: 'mat-2', sku: 'M12-NUT-88', name: 'M12 8.8 HEX NUT', category: 'FASTENERS_SLUGS_INSULATION', unitOfMeasure: 'each', requiredStock: '100', unitCost: '1.20', active: true },
  { id: 'mat-3', sku: 'WASH-M16-FLAT', name: 'M16 FLAT WASHER', category: 'FASTENERS_SLUGS_INSULATION', unitOfMeasure: 'each', requiredStock: '200', unitCost: '0.85', active: true },
  { id: 'mat-4', sku: 'WELD-ROD-3.2', name: 'Welding Rod 3.2mm E6013', category: 'CONSUMABLES', unitOfMeasure: 'kg', requiredStock: '20', unitCost: '78.00', active: true },
  { id: 'mat-5', sku: 'GRIND-DISC-125', name: 'Grinding Disc 125 x 6mm', category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: '30', unitCost: '32.00', active: true },
  { id: 'mat-6', sku: 'CUT-DISC-115', name: 'Cut-off Disc 115 x 3mm', category: 'CONSUMABLES', unitOfMeasure: 'each', requiredStock: '30', unitCost: '18.00', active: true },
  { id: 'mat-7', sku: 'GLOVES-WELD-L', name: 'Welding Gloves — Size L', category: 'TOOLING_PPE_ELECTRICAL', unitOfMeasure: 'pair', requiredStock: '5', unitCost: '95.00', active: true },
  { id: 'mat-8', sku: 'GLASSES-CLR', name: 'Safety Glasses — Clear', category: 'TOOLING_PPE_ELECTRICAL', unitOfMeasure: 'each', requiredStock: '10', unitCost: '38.00', active: true },
  { id: 'mat-9', sku: 'PROJ-AFRI-1325-PLATE', name: '10mm Plate — Project AFRI-1325', category: 'PROJECT_MATERIAL', unitOfMeasure: 'm', requiredStock: '0', unitCost: '420.00', active: true },
  { id: 'mat-10', sku: 'PROJ-AFRI-1325-ANGLE', name: '50 x 50 x 5 Angle — Project AFRI-1325', category: 'PROJECT_MATERIAL', unitOfMeasure: 'm', requiredStock: '0', unitCost: '95.00', active: true },
  { id: 'mat-11', sku: 'TOOL-IMPACT-1/2', name: '1/2" Impact Wrench (Tool)', category: 'TOOLS', unitOfMeasure: 'each', requiredStock: '1', unitCost: '4500.00', active: true },
  { id: 'mat-12', sku: 'TOOL-TORQUE-1/2', name: '1/2" Torque Wrench (Tool)', category: 'TOOLS', unitOfMeasure: 'each', requiredStock: '1', unitCost: '3200.00', active: true },
];

export const SEED_PURCHASE_ORDERS: MockPurchaseOrder[] = [
  {
    id: 'po-1',
    number: 'PO-2026-0001',
    supplierId: 'sup-1',
    status: 'APPROVED',
    notes: 'Standing monthly fasteners order',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
    lines: [
      { id: 'pol-1', materialId: 'mat-1', orderedQty: '200', receivedQty: '0' },
      { id: 'pol-2', materialId: 'mat-3', orderedQty: '500', receivedQty: '0' },
    ],
  },
  {
    id: 'po-2',
    number: 'PO-2026-0002',
    supplierId: 'sup-2',
    status: 'PARTIALLY_RECEIVED',
    notes: 'Bearings for Boiler Shop rebuild',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    lines: [
      { id: 'pol-3', materialId: 'mat-4', orderedQty: '50', receivedQty: '25' },
    ],
  },
];

export const SEED_GOODS_RECEIPTS: MockGoodsReceipt[] = [
  {
    id: 'gr-1',
    number: 'GR-2026-0001',
    purchaseOrderId: 'po-2',
    supplierId: 'sup-2',
    deliveryRef: 'Tax Invoice - E127076',
    status: 'POSTED',
    receivedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    lines: [
      { id: 'grl-1', materialId: 'mat-4', locationId: 'loc-2', quantity: '25', purchaseOrderLineId: 'pol-3' },
    ],
  },
];

// Opening transactions: reflects what the seed represents so balances make
// sense. The mock services will recompute balances from these on init.
const NOW = Date.now();
const day = (n: number) => new Date(NOW - n * 1000 * 60 * 60 * 24).toISOString();

export const SEED_TRANSACTIONS: MockInventoryTransaction[] = [
  // Opening receipts
  { id: 't-1', postedAt: day(30), type: 'RECEIPT', materialId: 'mat-1', locationId: 'loc-1', quantity: '120', actorId: 'user-1' },
  { id: 't-2', postedAt: day(30), type: 'RECEIPT', materialId: 'mat-2', locationId: 'loc-1', quantity: '300', actorId: 'user-1' },
  { id: 't-3', postedAt: day(30), type: 'RECEIPT', materialId: 'mat-3', locationId: 'loc-1', quantity: '600', actorId: 'user-1' },
  { id: 't-4', postedAt: day(28), type: 'RECEIPT', materialId: 'mat-4', locationId: 'loc-1', quantity: '60', actorId: 'user-1' },
  { id: 't-5', postedAt: day(28), type: 'RECEIPT', materialId: 'mat-5', locationId: 'loc-1', quantity: '80', actorId: 'user-1' },
  { id: 't-6', postedAt: day(28), type: 'RECEIPT', materialId: 'mat-6', locationId: 'loc-1', quantity: '100', actorId: 'user-1' },
  { id: 't-7', postedAt: day(20), type: 'RECEIPT', materialId: 'mat-7', locationId: 'loc-1', quantity: '12', actorId: 'user-1' },
  { id: 't-8', postedAt: day(20), type: 'RECEIPT', materialId: 'mat-8', locationId: 'loc-1', quantity: '25', actorId: 'user-1' },

  // Issues (consumption)
  { id: 't-9', postedAt: day(7), type: 'ISSUE', materialId: 'mat-1', locationId: 'loc-1', quantity: '-70', actorId: 'user-2', projectNumber: 'AFRI-1325' },
  { id: 't-10', postedAt: day(6), type: 'ISSUE', materialId: 'mat-2', locationId: 'loc-1', quantity: '-150', actorId: 'user-2', projectNumber: 'AFRI-1325' },
  { id: 't-11', postedAt: day(6), type: 'ISSUE', materialId: 'mat-3', locationId: 'loc-1', quantity: '-300', actorId: 'user-2', projectNumber: 'AFRI-1325' },
  { id: 't-12', postedAt: day(5), type: 'ISSUE', materialId: 'mat-4', locationId: 'loc-2', quantity: '-15', actorId: 'user-2' },
  { id: 't-13', postedAt: day(5), type: 'ISSUE', materialId: 'mat-5', locationId: 'loc-2', quantity: '-30', actorId: 'user-2' },
  { id: 't-14', postedAt: day(5), type: 'ISSUE', materialId: 'mat-5', locationId: 'loc-2', quantity: '-10', actorId: 'user-2' },
  { id: 't-15', postedAt: day(3), type: 'ISSUE', materialId: 'mat-7', locationId: 'loc-2', quantity: '-4', actorId: 'user-2' },
  { id: 't-16', postedAt: day(3), type: 'ISSUE', materialId: 'mat-8', locationId: 'loc-2', quantity: '-5', actorId: 'user-2' },

  // Transfer
  { id: 't-17', postedAt: day(4), type: 'TRANSFER_OUT', materialId: 'mat-1', locationId: 'loc-1', quantity: '-20', actorId: 'user-1' },
  { id: 't-18', postedAt: day(4), type: 'TRANSFER_IN',  materialId: 'mat-1', locationId: 'loc-3', quantity: '20',  actorId: 'user-1' },

  // Adjustment — variance
  { id: 't-19', postedAt: day(2), type: 'ADJUSTMENT', materialId: 'mat-6', locationId: 'loc-1', quantity: '-5', actorId: 'user-1', reasonCode: 'COUNT_VARIANCE' },

  // Goods receipt (links to GR-1)
  { id: 't-20', postedAt: day(2), type: 'RECEIPT', materialId: 'mat-4', locationId: 'loc-2', quantity: '25', actorId: 'user-1', referenceType: 'GoodsReceipt', referenceId: 'gr-1' },
];

export const SEED_PROJECTS: MockProject[] = [
  {
    projectNumber: 'AFRI-1325',
    name: 'Hydroscand line build Q4',
    code: 'HY-Q4',
    description: 'New hydraulic line for client workshop.',
    status: 'ACTIVE',
    managerId: 'user-1',
    manager: { id: 'user-1', name: 'System Administrator (dev)', email: 'admin@afrinov.local' },
    client: 'Hydroscand',
    startDate: new Date('2026-07-01').toISOString(),
    endDate: new Date('2026-12-15').toISOString(),
    notes: 'Phase 2 in progress.',
    active: true,
    createdAt: new Date('2026-07-01').toISOString(),
    updatedAt: new Date('2026-08-30').toISOString(),
  },
  {
    projectNumber: 'AFRI-1402',
    name: 'Boiler refurb – Site A',
    code: 'BR-A',
    status: 'PLANNING',
    client: 'Internal',
    active: true,
    createdAt: new Date('2026-08-15').toISOString(),
    updatedAt: new Date('2026-08-15').toISOString(),
  },
];

export const SEED_RACKS: MockRack[] = [
  {
    id: 'rack-1',
    code: 'D-1',
    name: 'Aisle D – Shelf 1',
    description: 'Heavy consumables, lower shelves.',
    locationId: 'loc-1',
    projectNumber: 'AFRI-1325',
    capacity: 100,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-10').toISOString(),
    updatedAt: new Date('2026-08-01').toISOString(),
    location: { id: 'loc-1', name: 'Main Storeroom' },
  },
  {
    id: 'rack-2',
    code: 'F-7',
    name: 'Aisle F – Shelf 7',
    locationId: 'loc-1',
    capacity: 80,
    status: 'ACTIVE',
    createdAt: new Date('2026-02-04').toISOString(),
    updatedAt: new Date('2026-07-12').toISOString(),
    location: { id: 'loc-1', name: 'Main Storeroom' },
  },
];