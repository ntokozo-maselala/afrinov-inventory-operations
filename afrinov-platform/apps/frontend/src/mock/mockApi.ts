// In-memory store + mock router for frontend-only mode.
//
// IMPORTANT: this module is only loaded when VITE_FRONTEND_ONLY === 'true'.
// It exposes the same surface as the real api/client.ts (`api.get/post/patch/del`)
// by being returned from `createApi()` in api/client.ts.
//
// The mock backend:
//   - holds state in module-level Maps,
//   - persists across navigations but resets on full reload,
//   - computes derived balances from posted transactions on every change,
//   - enforces ADR-002-style rules (issue can't exceed balance, transfers atomic),
//   - returns the same ApiError shape on validation failures.

import {
  SEED_LOCATIONS,
  SEED_SUPPLIERS,
  SEED_MATERIALS,
  SEED_PURCHASE_ORDERS,
  SEED_GOODS_RECEIPTS,
  SEED_TRANSACTIONS,
  SEED_PROJECTS,
  SEED_RACKS,
} from './seed';
import { buildReport, type ReportQuery as MockReportQuery } from './mockReport';
import { classifyItem, needsAttention, type StatusBands, type StockStatus } from '../lib/stockStatus';
import { computeConsumption } from './mockConsumption';
import { computeMonthEnd } from './mockMonthEnd';
import type {
  MockMaterial,
  MockLocation,
  MockSupplier,
  MockPurchaseOrder,
  MockGoodsReceipt,
  MockInventoryTransaction,
  MockStockRow,
  MockMovementRow,
  MockUser,
  MockRack,
  MockRackStatus,
  MockProject,
  AdjustmentReasonCode,
  MockRecipient,
} from './types';
import type { ApiError } from '../api/client';

interface Balance {
  materialId: string;
  locationId: string;
  quantity: number;
}

interface State {
  materials: MockMaterial[];
  locations: MockLocation[];
  suppliers: MockSupplier[];
  purchaseOrders: MockPurchaseOrder[];
  goodsReceipts: MockGoodsReceipt[];
  transactions: MockInventoryTransaction[];
  racks: MockRack[];
  projects: MockProject[];
  recipients: MockRecipient[];
}

let state: State = freshState();

function freshState(): State {
  return {
    materials: [...SEED_MATERIALS],
    locations: [...SEED_LOCATIONS],
    suppliers: [...SEED_SUPPLIERS],
    purchaseOrders: JSON.parse(JSON.stringify(SEED_PURCHASE_ORDERS)),
    goodsReceipts: JSON.parse(JSON.stringify(SEED_GOODS_RECEIPTS)),
    transactions: [...SEED_TRANSACTIONS],
    racks: JSON.parse(JSON.stringify(SEED_RACKS)),
    projects: JSON.parse(JSON.stringify(SEED_PROJECTS)),
    recipients: [
      { id: 'rcp-1', name: 'Sabelo', type: 'WORKER', active: true },
      { id: 'rcp-2', name: 'Khodani', type: 'WORKER', active: true },
      { id: 'rcp-3', name: 'Forklift', type: 'MACHINE', active: true },
      { id: 'rcp-4', name: 'Northam Platinum', type: 'SITE', active: true },
      { id: 'rcp-5', name: 'KTS', type: 'CONTRACTOR', active: true },
    ],
  };
}

// Reset (useful if we ever want a "reset mocks" button).
export function resetMockState(): void {
  state = freshState();
  mockUsers = JSON.parse(JSON.stringify(SEED_USERS));
  MOCK_AUDIT.length = 0;
}

let idCounter = 1000;
function nextId(prefix: string): string {
  return `${prefix}-${++idCounter}`;
}

function computeBalances(): Balance[] {
  const map = new Map<string, Balance>();
  for (const t of state.transactions) {
    const key = `${t.materialId}|${t.locationId}`;
    const existing = map.get(key) ?? { materialId: t.materialId, locationId: t.locationId, quantity: 0 };
    existing.quantity += Number(t.quantity);
    map.set(key, existing);
  }
  return Array.from(map.values()).filter((b) => b.quantity !== 0);
}

function err(code: string, message: string, details?: Record<string, unknown>): ApiError {
  return { code, message, details };
}

function findMaterial(id: string): MockMaterial | undefined {
  return state.materials.find((m) => m.id === id);
}
function findLocation(id: string): MockLocation | undefined {
  return state.locations.find((l) => l.id === id);
}
function findSupplier(id: string): MockSupplier | undefined {
  return state.suppliers.find((s) => s.id === id);
}

// ── API surface ─────────────────────────────────────────────────────────────

export interface MockApi {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  patch: <T>(path: string, body?: unknown) => Promise<T>;
  del: <T>(path: string) => Promise<T>;
}

export function createMockApi(): MockApi {
  const delay = (ms = 120) => new Promise((res) => setTimeout(res, ms));

  async function handle<T>(handler: () => T | Promise<T>): Promise<T> {
    await delay();
    try {
      return await handler();
    } catch (e) {
      if (e && typeof e === 'object' && 'code' in e) throw e;
      throw err('INTERNAL_ERROR', String((e as Error)?.message ?? e));
    }
  }

  return {
    get: <T>(path: string) => handle<T>(() => route('GET', path) as T),
    post: <T>(path: string, body?: unknown) => handle<T>(() => route('POST', path, body) as T),
    patch: <T>(path: string, body?: unknown) => handle<T>(() => route('PATCH', path, body) as T),
    del: <T>(path: string) => handle<T>(() => route('DELETE', path) as T),
  };
}

// Tiny path-router. Returns the response payload or throws an ApiError.
function route(method: string, path: string, body?: unknown): unknown {
  const p = path.split('?')[0] ?? '';
  const qs = parseQuery(path);

  // Auth
  if (method === 'GET' && p === '/auth/me') {
    return devUser();
  }
  if (method === 'POST' && p === '/auth/login') {
    const b = body as { email?: string; password?: string } | undefined;
    if (!b?.email || !b?.password) throw err('VALIDATION_ERROR', 'Email and password required');
    // Any non-empty password is accepted in dev mode. The
    // `authService` runs before this is hit, so this path is only
    // exercised when the real login call is invoked from outside the
    // service (rare). It still returns the dev user for consistency.
    return { token: 'mock-token', user: devUser() };
  }

  // Materials
  if (method === 'GET' && p === '/materials') {
    let list = [...state.materials].sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || a.name.localeCompare(b.name));
    const q = qs.q?.toLowerCase();
    const cat = qs.category;
    const active = qs.active;
    if (q) list = list.filter((m) => m.name.toLowerCase().includes(q) || m.sku.toLowerCase().includes(q));
    if (cat) list = list.filter((m) => m.category === cat);
    if (active !== undefined) list = list.filter((m) => m.active === (active === 'true'));
    return list;
  }
  if (method === 'GET' && p.startsWith('/materials/')) {
    const id = p.slice('/materials/'.length);
    const m = findMaterial(id);
    if (!m) throw err('NOT_FOUND', 'Material not found');
    return m;
  }
  if (method === 'POST' && p === '/materials') {
    const b = body as Partial<MockMaterial>;
    if (!b.sku || !b.name || !b.category || !b.unitOfMeasure) {
      throw err('VALIDATION_ERROR', 'Missing required fields');
    }
    if (state.materials.some((m) => m.sku === b.sku)) {
      throw err('CONFLICT', `SKU "${b.sku}" already exists`);
    }
    const created: MockMaterial = {
      id: nextId('mat'),
      sku: b.sku,
      name: b.name,
      description: b.description,
      category: b.category,
      unitOfMeasure: b.unitOfMeasure,
      requiredStock: String(b.requiredStock ?? 0),
      unitCost: b.unitCost !== undefined ? String(b.unitCost) : undefined,
      active: true,
    };
    state.materials.push(created);
    return created;
  }
  if (method === 'PATCH' && p.startsWith('/materials/')) {
    const id = p.slice('/materials/'.length);
    const m = findMaterial(id);
    if (!m) throw err('NOT_FOUND', 'Material not found');
    const b = body as Partial<MockMaterial>;
    if (b.name !== undefined) m.name = b.name;
    if (b.description !== undefined) m.description = b.description;
    if (b.unitOfMeasure !== undefined) m.unitOfMeasure = b.unitOfMeasure;
    if (b.requiredStock !== undefined) m.requiredStock = String(b.requiredStock);
    if (b.unitCost !== undefined) m.unitCost = String(b.unitCost);
    if (b.active !== undefined) m.active = b.active;
    return m;
  }

  // Locations
  if (method === 'GET' && p === '/locations') {
    const q = qs.q?.toLowerCase();
    let list = [...state.locations];
    if (qs.type) list = list.filter((l) => l.type === qs.type);
    if (qs.active === 'true') list = list.filter((l) => l.active);
    else if (qs.active === 'false') list = list.filter((l) => !l.active);
    if (q) list = list.filter((l) =>
      `${l.name} ${l.code ?? ''} ${l.address ?? ''} ${l.description ?? ''}`.toLowerCase().includes(q),
    );
    const balances = computeBalances();
    return list
      .sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || a.name.localeCompare(b.name))
      .map((l) => ({
        ...l,
        inventoryCount: balances.filter((b) => b.locationId === l.id).length,
      }));
  }
  if (method === 'GET' && p.startsWith('/locations/')) {
    const id = p.slice('/locations/'.length);
    const l = findLocation(id);
    if (!l) throw err('NOT_FOUND', 'Location not found');
    const counts = mockLocationDependencyCounts(id);
    const balances = computeBalances().filter((b) => b.locationId === id);
    return { ...l, inventoryCount: balances.length, dependencyCounts: counts };
  }
  if (method === 'POST' && p === '/locations') {
    const b = body as Partial<MockLocation> & { name?: string; type?: MockLocation['type']; code?: string };
    if (!b.name?.trim() || !b.type) throw err('VALIDATION_ERROR', 'Name and type are required');
    if (state.locations.some((l) => l.name === b.name)) {
      throw err('CONFLICT', `Location "${b.name}" already exists`);
    }
    if (b.code && state.locations.some((l) => l.code === b.code)) {
      throw err('CONFLICT', `Location code "${b.code}" is already in use.`);
    }
    const now = new Date().toISOString();
    const created: MockLocation = {
      id: nextId('loc'),
      name: b.name.trim(),
      code: b.code?.trim() || undefined,
      type: b.type,
      active: b.active ?? true,
      address: b.address,
      description: b.description,
      contactPerson: b.contactPerson,
      contactPhone: b.contactPhone,
      contactEmail: b.contactEmail,
      notes: b.notes,
      createdAt: now,
      updatedAt: now,
    };
    state.locations.push(created);
    return { ...created, inventoryCount: 0 };
  }
  if (method === 'PATCH' && /^\/locations\/[^/]+\/status$/.test(p)) {
    const id = p.slice('/locations/'.length, -'/status'.length);
    const l = findLocation(id);
    if (!l) throw err('NOT_FOUND', 'Location not found');
    const b = body as { active?: boolean };
    if (typeof b?.active !== 'boolean') throw err('VALIDATION_ERROR', 'active is required');
    l.active = b.active;
    l.updatedAt = new Date().toISOString();
    return l;
  }
  if (method === 'PATCH' && p.startsWith('/locations/')) {
    const id = p.slice('/locations/'.length);
    const l = findLocation(id);
    if (!l) throw err('NOT_FOUND', 'Location not found');
    const b = body as Partial<MockLocation>;
    if (b.name !== undefined) {
      if (!b.name.trim()) throw err('VALIDATION_ERROR', 'Name is required');
      if (state.locations.some((x) => x.id !== id && x.name === b.name)) {
        throw err('CONFLICT', `Location "${b.name}" already exists`);
      }
      l.name = b.name.trim();
    }
    if (b.code !== undefined) {
      if (b.code) {
        if (state.locations.some((x) => x.id !== id && x.code === b.code)) {
          throw err('CONFLICT', `Location code "${b.code}" is already in use.`);
        }
        l.code = b.code.trim();
      } else {
        l.code = undefined;
      }
    }
    if (b.type !== undefined) l.type = b.type;
    if (b.active !== undefined) l.active = b.active;
    if (b.address !== undefined) l.address = b.address;
    if (b.description !== undefined) l.description = b.description;
    if (b.contactPerson !== undefined) l.contactPerson = b.contactPerson;
    if (b.contactPhone !== undefined) l.contactPhone = b.contactPhone;
    if (b.contactEmail !== undefined) l.contactEmail = b.contactEmail;
    if (b.notes !== undefined) l.notes = b.notes;
    l.updatedAt = new Date().toISOString();
    return l;
  }
  if (method === 'DELETE' && p.startsWith('/locations/')) {
    const id = p.slice('/locations/'.length);
    const l = findLocation(id);
    if (!l) throw err('NOT_FOUND', 'Location not found');
    const counts = mockLocationDependencyCounts(id);
    const total = counts.racks + counts.goodsReceiptLines + counts.inventoryTransactions + counts.inventoryBalances;
    if (total > 0) {
      throw err('CONFLICT', 'This location cannot be deleted because it is referenced by other records. Deactivate the location instead.', { dependencies: counts });
    }
    state.locations = state.locations.filter((x) => x.id !== id);
    return { ok: true };
  }

  // Suppliers
  if (method === 'GET' && p === '/suppliers') {
    let list = [...state.suppliers].sort((a, b) => a.name.localeCompare(b.name));
    const q = qs.q?.toLowerCase();
    if (q) list = list.filter((s) => s.name.toLowerCase().includes(q));
    return list;
  }
  if (method === 'POST' && p === '/suppliers') {
    const b = body as Partial<MockSupplier>;
    if (!b.name) throw err('VALIDATION_ERROR', 'Name required');
    const norm = b.name.trim().toLowerCase();
    if (state.suppliers.some((s) => s.name.trim().toLowerCase() === norm)) {
      throw err('CONFLICT', `Supplier "${b.name}" already exists`);
    }
    const created: MockSupplier = {
      id: nextId('sup'),
      name: b.name.trim(),
      contactName: b.contactName,
      contactEmail: b.contactEmail,
      contactPhone: b.contactPhone,
      notes: b.notes,
      active: true,
    };
    state.suppliers.push(created);
    return created;
  }

  // Purchase Orders
  if (method === 'GET' && p === '/purchase-orders') {
    const list = [...state.purchaseOrders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list.map((po) => ({
      ...po,
      supplier: findSupplier(po.supplierId),
      lines: po.lines.map((l) => ({ ...l, material: findMaterial(l.materialId) })),
    }));
  }
  if (method === 'GET' && /^\/purchase-orders\/[^/]+\/history$/.test(p)) {
    const id = p.slice('/purchase-orders/'.length, -'/history'.length);
    const po = state.purchaseOrders.find((x) => x.id === id);
    if (!po) throw err('NOT_FOUND', 'Purchase order not found');
    return po.history ?? [];
  }
  if (method === 'GET' && p.startsWith('/purchase-orders/')) {
    const id = p.slice('/purchase-orders/'.length);
    const po = state.purchaseOrders.find((x) => x.id === id);
    if (!po) throw err('NOT_FOUND', 'Purchase order not found');
    return {
      ...po,
      supplier: findSupplier(po.supplierId),
      lines: po.lines.map((l) => ({ ...l, material: findMaterial(l.materialId) })),
    };
  }
  if (method === 'POST' && p === '/purchase-orders') {
    const b = body as { supplierId?: string; lines?: Array<{ materialId: string; orderedQty: number }>; notes?: string; expectedDeliveryDate?: string };
    if (!b.supplierId || !b.lines || b.lines.length === 0) throw err('VALIDATION_ERROR', 'Supplier and at least one line required');
    if (!findSupplier(b.supplierId)) throw err('NOT_FOUND', 'Supplier not found');
    const po: MockPurchaseOrder = {
      id: nextId('po'),
      number: `PO-2026-${String(state.purchaseOrders.length + 1).padStart(4, '0')}`,
      supplierId: b.supplierId,
      status: 'DRAFT',
      notes: b.notes,
      expectedDeliveryDate: b.expectedDeliveryDate ?? null,
      createdAt: new Date().toISOString(),
      history: [],
      lines: b.lines.map((l) => ({ id: nextId('pol'), materialId: l.materialId, orderedQty: String(l.orderedQty), receivedQty: '0' })),
    };
    state.purchaseOrders.push(po);
    return { ...po, supplier: findSupplier(po.supplierId), lines: po.lines.map((l) => ({ ...l, material: findMaterial(l.materialId) })) };
  }
  if (method === 'POST' && p.endsWith('/submit')) {
    const id = p.slice('/purchase-orders/'.length, -'/submit'.length);
    const po = state.purchaseOrders.find((x) => x.id === id);
    if (!po) throw err('NOT_FOUND', 'Purchase order not found');
    if (po.status !== 'DRAFT') throw err('INVALID_STATE', `Cannot submit from ${po.status}`);
    const before = { status: po.status };
    po.status = 'PENDING_APPROVAL';
    po.history = po.history ?? [];
    po.history.push({ id: nextId('audit'), action: 'PO_SUBMIT', actorId: 'u-admin', before, after: { status: po.status }, createdAt: new Date().toISOString() });
    return po;
  }
  if (method === 'POST' && p.endsWith('/approve')) {
    const id = p.slice('/purchase-orders/'.length, -'/approve'.length);
    const po = state.purchaseOrders.find((x) => x.id === id);
    if (!po) throw err('NOT_FOUND', 'Purchase order not found');
    if (po.status !== 'PENDING_APPROVAL') throw err('INVALID_STATE', `Cannot approve from ${po.status}`);
    const before = { status: po.status };
    po.status = 'APPROVED';
    po.approvedAt = new Date().toISOString();
    po.approvedBy = { id: 'u-admin', name: 'You (admin)', email: 'admin@afrinov.local', roles: ['ADMIN'] };
    po.history = po.history ?? [];
    po.history.push({ id: nextId('audit'), action: 'PO_APPROVE', actorId: 'u-admin', before, after: { status: po.status }, createdAt: new Date().toISOString() });
    return po;
  }
  if (method === 'POST' && p.endsWith('/receive')) {
    const id = p.slice('/purchase-orders/'.length, -'/receive'.length);
    const po = state.purchaseOrders.find((x) => x.id === id);
    if (!po) throw err('NOT_FOUND', 'Purchase order not found');
    if (po.status !== 'APPROVED' && po.status !== 'PARTIALLY_RECEIVED') throw err('INVALID_STATE', `Cannot receive from ${po.status}`);
    const b = (body as { locationId?: string; deliveryNotes?: string }) ?? {};
    if (!b.locationId) throw err('VALIDATION_ERROR', 'locationId is required');
    if (!state.locations.find((l) => l.id === b.locationId)) throw err('NOT_FOUND', 'Location not found');
    const before = { status: po.status };
    po.status = 'RECEIVED';
    po.deliveredAt = new Date().toISOString();
    po.deliveredBy = { id: 'u-admin', name: 'You (admin)', email: 'admin@afrinov.local', roles: ['ADMIN'] };
    po.deliveryNotes = b.deliveryNotes ?? null;
    for (const line of po.lines) {
      const orderedQty = Number(line.orderedQty);
      const alreadyReceived = Number(line.receivedQty);
      const toReceive = orderedQty - alreadyReceived;
      line.receivedQty = String(orderedQty);
      if (toReceive > 0) {
        state.transactions.push({
          id: nextId('tx'),
          materialId: line.materialId,
          locationId: b.locationId,
          quantity: String(toReceive),
          type: 'RECEIPT',
          reasonCode: 'PO_RECEIPT',
          referenceType: 'PurchaseOrder',
          referenceId: po.id,
          postedAt: new Date().toISOString(),
          actorId: 'u-admin',
        });
      }
    }
    po.history = po.history ?? [];
    po.history.push({ id: nextId('audit'), action: 'PO_RECEIVE', actorId: 'u-admin', before, after: { status: po.status, locationId: b.locationId }, createdAt: new Date().toISOString() });
    return po;
  }
  if (method === 'POST' && p.endsWith('/close')) {
    const id = p.slice('/purchase-orders/'.length, -'/close'.length);
    const po = state.purchaseOrders.find((x) => x.id === id);
    if (!po) throw err('NOT_FOUND', 'Purchase order not found');
    if (po.status !== 'PARTIALLY_RECEIVED' && po.status !== 'RECEIVED') throw err('INVALID_STATE', `Cannot close from ${po.status}`);
    const reason = ((body as { reason?: string }) ?? {}).reason?.trim() || null;
    const short = po.lines.some((l) => Number(l.receivedQty) < Number(l.orderedQty));
    if (short && !reason) throw err('VALIDATION_ERROR', 'A reason is required to close an order that has not been fully received');
    const before = { status: po.status };
    po.status = 'CLOSED';
    po.closedAt = new Date().toISOString();
    po.closedBy = { id: 'u-admin', name: 'You (admin)', email: 'admin@afrinov.local', roles: ['ADMIN'] };
    po.closeReason = reason;
    po.history = po.history ?? [];
    po.history.push({ id: nextId('audit'), action: 'PO_CLOSE', actorId: 'u-admin', before, after: { status: po.status, reason }, createdAt: new Date().toISOString() });
    return po;
  }
  if (method === 'POST' && p.endsWith('/cancel')) {
    const id = p.slice('/purchase-orders/'.length, -'/cancel'.length);
    const po = state.purchaseOrders.find((x) => x.id === id);
    if (!po) throw err('NOT_FOUND', 'Purchase order not found');
    if (!['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(po.status)) throw err('INVALID_STATE', `Cannot cancel from ${po.status}`);
    const b = (body as { reason?: string }) ?? {};
    if (!b.reason || !b.reason.trim()) throw err('VALIDATION_ERROR', 'Cancellation reason is required');
    const before = { status: po.status };
    po.status = 'CANCELLED';
    po.cancelledAt = new Date().toISOString();
    po.cancelledBy = { id: 'u-admin', name: 'You (admin)', email: 'admin@afrinov.local', roles: ['ADMIN'] };
    po.cancellationReason = b.reason.trim();
    po.history = po.history ?? [];
    po.history.push({ id: nextId('audit'), action: 'PO_CANCEL', actorId: 'u-admin', before, after: { status: po.status, reason: po.cancellationReason }, createdAt: new Date().toISOString() });
    return po;
  }
  if (method === 'PATCH' && /^\/purchase-orders\/[^/]+$/.test(p)) {
    const id = p.slice('/purchase-orders/'.length);
    const po = state.purchaseOrders.find((x) => x.id === id);
    if (!po) throw err('NOT_FOUND', 'Purchase order not found');
    if (!['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(po.status)) throw err('INVALID_STATE', 'This purchase order is no longer editable.');
    const b = (body as { notes?: string | null; expectedDeliveryDate?: string | null }) ?? {};
    if (b.notes !== undefined) po.notes = b.notes ?? undefined;
    if (b.expectedDeliveryDate !== undefined) po.expectedDeliveryDate = b.expectedDeliveryDate ?? null;
    po.history = po.history ?? [];
    po.history.push({ id: nextId('audit'), action: 'UPDATE', actorId: 'u-admin', before: null, after: b as Record<string, unknown>, createdAt: new Date().toISOString() });
    return po;
  }

  // Goods Receipts
  if (method === 'GET' && p === '/goods-receipts') {
    return state.goodsReceipts
      .slice()
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .map((g) => ({
        ...g,
        supplier: findSupplier(g.supplierId),
        lines: g.lines.map((l) => ({ ...l, material: findMaterial(l.materialId), location: findLocation(l.locationId) })),
      }));
  }
  if (method === 'GET' && p.startsWith('/goods-receipts/')) {
    const id = p.slice('/goods-receipts/'.length);
    const g = state.goodsReceipts.find((x) => x.id === id);
    if (!g) throw err('NOT_FOUND', 'Goods receipt not found');
    return {
      ...g,
      supplier: findSupplier(g.supplierId),
      lines: g.lines.map((l) => ({ ...l, material: findMaterial(l.materialId), location: findLocation(l.locationId) })),
    };
  }
  if (method === 'POST' && p === '/goods-receipts') {
    const b = body as {
      supplierId: string;
      purchaseOrderId?: string;
      deliveryRef?: string;
      lines: Array<{ materialId: string; locationId: string; quantity: number; purchaseOrderLineId?: string }>;
    };
    if (!b.supplierId || !b.lines?.length) throw err('VALIDATION_ERROR', 'Supplier and at least one line required');
    if (!state.suppliers.find((s) => s.id === b.supplierId)) throw err('NOT_FOUND', 'Supplier not found');
    if (b.purchaseOrderId) {
      const po = state.purchaseOrders.find((p) => p.id === b.purchaseOrderId);
      if (!po) throw err('NOT_FOUND', 'Purchase order not found');
      if (po.status !== 'APPROVED' && po.status !== 'PARTIALLY_RECEIVED') throw err('INVALID_STATE', `Cannot receive against a purchase order in status ${po.status}`);
    }
    const gr: MockGoodsReceipt = {
      id: nextId('gr'),
      number: `GR-2026-${String(state.goodsReceipts.length + 1).padStart(4, '0')}`,
      purchaseOrderId: b.purchaseOrderId,
      supplierId: b.supplierId,
      deliveryRef: b.deliveryRef,
      status: 'SUBMITTED',
      receivedAt: new Date().toISOString(),
      lines: b.lines.map((l) => ({
        id: nextId('grl'),
        materialId: l.materialId,
        locationId: l.locationId,
        quantity: String(l.quantity),
        purchaseOrderLineId: l.purchaseOrderLineId,
      })),
    };
    state.goodsReceipts.push(gr);
    return gr;
  }
  if (method === 'POST' && p.endsWith('/post')) {
    const id = p.slice('/goods-receipts/'.length, -'/post'.length);
    const gr = state.goodsReceipts.find((g) => g.id === id);
    if (!gr) throw err('NOT_FOUND', 'Goods receipt not found');
    if (gr.status === 'POSTED') throw err('INVALID_STATE', 'Already posted');
    if (gr.status === 'DRAFT') throw err('INVALID_STATE', 'Must be submitted first');
    // Post Receipt transactions and update PO receivedQty.
    for (const line of gr.lines) {
      state.transactions.push({
        id: nextId('t'),
        postedAt: new Date().toISOString(),
        type: 'RECEIPT',
        materialId: line.materialId,
        locationId: line.locationId,
        quantity: String(Number(line.quantity)),
        actorId: 'user-1',
        referenceType: 'GoodsReceipt',
        referenceId: gr.id,
      });
      if (line.purchaseOrderLineId) {
        const po = state.purchaseOrders.find((p) => p.id === gr.purchaseOrderId);
        const pol = po?.lines.find((l) => l.id === line.purchaseOrderLineId);
        if (pol) {
          const orderedQty = Number(pol.orderedQty);
          const alreadyReceived = Number(pol.receivedQty);
          const receiving = Number(line.quantity);
          const projected = alreadyReceived + receiving;
          if (projected > orderedQty) {
            throw err('VALIDATION_ERROR', `Receiving ${receiving} would exceed the ordered quantity of ${orderedQty} for this line.`);
          }
          pol.receivedQty = String(projected);
        }
      }
    }
    gr.status = 'POSTED';
    if (gr.purchaseOrderId) {
      const po = state.purchaseOrders.find((p) => p.id === gr.purchaseOrderId);
      if (po) {
        const allFully = po.lines.every((l) => Number(l.receivedQty) >= Number(l.orderedQty));
        const anyReceived = po.lines.some((l) => Number(l.receivedQty) > 0);
        if (allFully || anyReceived) po.status = allFully ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      }
    }
    return {
      ...gr,
      supplier: findSupplier(gr.supplierId),
      lines: gr.lines.map((l) => ({ ...l, material: findMaterial(l.materialId), location: findLocation(l.locationId) })),
    };
  }

  // Inventory transactions
  if (method === 'GET' && p === '/inventory-transactions') {
    const limit = qs.limit ? Number(qs.limit) : 200;
    let list = state.transactions
      .slice()
      .sort((a, b) => b.postedAt.localeCompare(a.postedAt));
    if (qs.materialId) list = list.filter((t) => t.materialId === qs.materialId);
    if (qs.type) list = list.filter((t) => t.type === qs.type);
    if (qs.projectNumber) list = list.filter((t) => t.projectNumber === qs.projectNumber);
    return list.slice(0, limit).map((t) => enrichMovement(t));
  }
  // Mirrors StockReceiptService.receive: a posted goods receipt with no
  // purchase order, all-or-nothing.
  if (method === 'POST' && p === '/stock-receipts') {
    const b = (body as { supplierId?: string; deliveryRef?: string; receivedAt?: string; lines?: Array<{ materialId: string; locationId: string; quantity: number }> }) ?? {};
    const deliveryRef = b.deliveryRef?.trim();
    if (!deliveryRef) throw err('VALIDATION_ERROR', 'Enter the delivery note or invoice number');
    const lines = b.lines ?? [];
    if (lines.length === 0) throw err('VALIDATION_ERROR', 'Add at least one item to receive');
    if (lines.some((l) => !(l.quantity > 0))) throw err('VALIDATION_ERROR', 'Received quantity must be positive');
    const supplier = b.supplierId ? findSupplier(b.supplierId) : undefined;
    if (!supplier) throw err('NOT_FOUND', 'Supplier not found');
    if (!supplier.active) throw err('VALIDATION_ERROR', 'Supplier is inactive');
    for (const l of lines) {
      if (!findMaterial(l.materialId)) throw err('NOT_FOUND', 'Material not found');
      if (!findLocation(l.locationId)) throw err('NOT_FOUND', 'Location not found');
    }
    const gr: MockGoodsReceipt = {
      id: nextId('gr'),
      number: `GR-2026-${String(state.goodsReceipts.length + 1).padStart(4, '0')}`,
      supplierId: supplier.id,
      deliveryRef,
      status: 'POSTED',
      receivedAt: b.receivedAt ? new Date(b.receivedAt).toISOString() : new Date().toISOString(),
      lines: lines.map((l) => ({ id: nextId('grl'), materialId: l.materialId, locationId: l.locationId, quantity: String(l.quantity) })),
    };
    state.goodsReceipts.push(gr);
    const postedAt = new Date().toISOString();
    const transactionIds = lines.map((l) => {
      const id = nextId('t');
      state.transactions.push({ id, postedAt, type: 'RECEIPT', materialId: l.materialId, locationId: l.locationId, quantity: String(l.quantity), actorId: 'user-1', referenceType: 'GoodsReceipt', referenceId: gr.id });
      return id;
    });
    return { goodsReceiptId: gr.id, number: gr.number, transactionIds };
  }

  if (method === 'POST' && p === '/inventory-issues') {
    return handleIssue((body as IssueBody) ?? {});
  }
  if (method === 'POST' && p === '/inventory-transfers') {
    const b = body as { materialId: string; fromLocationId: string; toLocationId: string; quantity: number };
    return handleTransfer(b);
  }
  if (method === 'POST' && p === '/stock-counts') {
    return handleStockCount(body as { locationId?: string; note?: string; lines?: Array<{ materialId: string; expectedQuantity: number; countedQuantity: number }> });
  }
  if (method === 'POST' && p === '/inventory-adjustments') {
    const b = body as { materialId: string; locationId: string; quantity: number; reasonCode: AdjustmentReasonCode; reasonNote?: string };
    return handleAdjustment(b);
  }
  const returnMatch = method === 'POST' ? /^\/inventory-transactions\/([^/]+)\/returns$/.exec(p) : null;
  if (returnMatch) {
    return handleReturn(returnMatch[1]!, (body as { quantity?: number; locationId?: string; reason?: string }) ?? {});
  }
  const reversalMatch = method === 'POST' ? /^\/inventory-transactions\/([^/]+)\/reversal$/.exec(p) : null;
  if (reversalMatch) {
    return handleReversal(reversalMatch[1]!, body as { reason?: string } | undefined);
  }

  if (method === 'POST' && p === '/stock-items') {
    return handleStockItemCreate(body as {
      sku: string; name: string; category: string; description?: string; unitOfMeasure: string;
      requiredStock?: number; unitCost?: number; initialQuantity?: number; locationId?: string; supplierId?: string;
    });
  }

  // Racks
  if (method === 'GET' && p === '/racks') {
    const q = qs.q?.toLowerCase();
    let list = [...state.racks];
    if (qs.status) list = list.filter((r) => r.status === qs.status);
    if (qs.locationId) list = list.filter((r) => r.locationId === qs.locationId);
    if (qs.projectNumber) list = list.filter((r) => r.projectNumber === qs.projectNumber);
    if (q) list = list.filter((r) => `${r.code} ${r.name} ${r.description ?? ''} ${r.location?.name ?? ''}`.toLowerCase().includes(q));
    return list.sort((a, b) => a.code.localeCompare(b.code));
  }
  if (method === 'GET' && p.startsWith('/racks/')) {
    const id = p.slice('/racks/'.length);
    return state.racks.find((r) => r.id === id) ?? null;
  }
  if (method === 'POST' && p === '/racks') {
    const b = body as { code: string; name: string; description?: string; locationId?: string; projectNumber?: string; capacity?: number; status?: MockRackStatus; notes?: string };
    if (!b.code || !b.name) throw err('VALIDATION_ERROR', 'Code and name are required');
    if (state.racks.some((r) => r.code === b.code)) throw err('CONFLICT', `Rack code "${b.code}" is already in use.`);
    const loc = b.locationId ? state.locations.find((l) => l.id === b.locationId) : null;
    if (b.locationId && !loc) throw err('NOT_FOUND', 'Location not found');
    const created: MockRack = {
      id: nextId('rack'),
      code: b.code,
      name: b.name,
      description: b.description,
      locationId: b.locationId,
      projectNumber: b.projectNumber,
      capacity: b.capacity,
      status: b.status ?? 'ACTIVE',
      notes: b.notes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      location: loc ? { id: loc.id, name: loc.name } : undefined,
    };
    state.racks.push(created);
    return created;
  }
  if (method === 'PATCH' && p.startsWith('/racks/')) {
    const id = p.slice('/racks/'.length);
    const r = state.racks.find((x) => x.id === id);
    if (!r) throw err('NOT_FOUND', 'Rack not found');
    const b = body as Partial<MockRack>;
    if (b.code !== undefined) r.code = b.code;
    if (b.name !== undefined) r.name = b.name;
    if (b.description !== undefined) r.description = b.description;
    if (b.locationId !== undefined) {
      r.locationId = b.locationId ?? undefined;
      const loc = b.locationId ? state.locations.find((l) => l.id === b.locationId) : null;
      r.location = loc ? { id: loc.id, name: loc.name } : undefined;
    }
    if (b.projectNumber !== undefined) r.projectNumber = b.projectNumber ?? undefined;
    if (b.capacity !== undefined) r.capacity = b.capacity;
    if (b.status !== undefined) r.status = b.status;
    if (b.notes !== undefined) r.notes = b.notes;
    r.updatedAt = new Date().toISOString();
    return r;
  }
  if (method === 'DELETE' && p.startsWith('/racks/')) {
    const id = p.slice('/racks/'.length);
    const r = state.racks.find((x) => x.id === id);
    if (!r) throw err('NOT_FOUND', 'Rack not found');
    r.status = 'INACTIVE';
    r.updatedAt = new Date().toISOString();
    return r;
  }

  // Recipients ("Issued To")
  if (method === 'GET' && p === '/recipients') {
    const q = qs.q?.toLowerCase();
    return state.recipients
      .filter((r) => (!qs.type || r.type === qs.type) && (qs.active === undefined || String(r.active) === qs.active) && (!q || r.name.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  }
  if (method === 'POST' && p === '/recipients') {
    const b = (body as { name?: string; type?: MockRecipient['type']; notes?: string }) ?? {};
    const name = b.name?.trim().replace(/\s+/g, ' ');
    if (!name || !b.type) throw err('VALIDATION_ERROR', 'Name and type are required');
    if (state.recipients.some((r) => r.name.toLowerCase() === name.toLowerCase())) throw err('CONFLICT', `A recipient named "${name}" already exists`);
    const created: MockRecipient = { id: nextId('rcp'), name, type: b.type, notes: b.notes?.trim() || null, active: true };
    state.recipients.push(created);
    return created;
  }
  if (method === 'PATCH' && /^\/recipients\/[^/]+$/.test(p)) {
    const r = state.recipients.find((x) => x.id === p.slice('/recipients/'.length));
    if (!r) throw err('NOT_FOUND', 'Recipient not found');
    const b = (body as Partial<MockRecipient>) ?? {};
    if (b.name !== undefined) {
      const name = b.name.trim().replace(/\s+/g, ' ');
      if (state.recipients.some((x) => x.id !== r.id && x.name.toLowerCase() === name.toLowerCase())) throw err('CONFLICT', `A recipient named "${name}" already exists`);
      r.name = name;
    }
    if (b.type !== undefined) r.type = b.type;
    if (b.notes !== undefined) r.notes = b.notes?.trim() || null;
    if (b.active !== undefined) r.active = b.active;
    return r;
  }

  // Projects
  if (method === 'GET' && p === '/projects') {
    const q = qs.q?.toLowerCase();
    let list = [...state.projects];
    if (qs.status) list = list.filter((p) => p.status === qs.status);
    if (qs.active === 'true') list = list.filter((p) => p.active);
    else if (qs.active === 'false') list = list.filter((p) => !p.active);
    if (q) list = list.filter((p) => `${p.projectNumber} ${p.name} ${p.code ?? ''} ${p.client ?? ''}`.toLowerCase().includes(q));
    return list;
  }
  if (method === 'GET' && p.startsWith('/projects/')) {
    const projectNumber = decodeURIComponent(p.slice('/projects/'.length));
    return state.projects.find((p) => p.projectNumber === projectNumber) ?? null;
  }
  if (method === 'POST' && p === '/projects') {
    const b = body as Partial<MockProject>;
    if (!b.projectNumber || !b.name) throw err('VALIDATION_ERROR', 'Project number and name are required');
    if (state.projects.some((p) => p.projectNumber === b.projectNumber)) throw err('CONFLICT', 'Project number already exists.');
    if (b.code && state.projects.some((p) => p.code === b.code)) throw err('CONFLICT', `Project code "${b.code}" is already in use.`);
    if (b.endDate && b.startDate && new Date(b.endDate) < new Date(b.startDate)) {
      throw err('VALIDATION_ERROR', 'End date cannot be earlier than start date');
    }
    const created: MockProject = {
      projectNumber: b.projectNumber,
      name: b.name,
      code: b.code,
      description: b.description,
      status: b.status ?? 'PLANNING',
      managerId: b.managerId,
      manager: b.managerId ? { id: b.managerId, name: 'Manager', email: '' } : undefined,
      client: b.client,
      startDate: b.startDate,
      endDate: b.endDate,
      notes: b.notes,
      active: b.active ?? true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.projects.push(created);
    return created;
  }
  if (method === 'PATCH' && p.startsWith('/projects/')) {
    const projectNumber = decodeURIComponent(p.slice('/projects/'.length));
    const proj = state.projects.find((p) => p.projectNumber === projectNumber);
    if (!proj) throw err('NOT_FOUND', 'Project not found');
    const b = body as Partial<MockProject>;
    if (b.code !== undefined && b.code && state.projects.some((p) => p.code === b.code && p.projectNumber !== projectNumber)) {
      throw err('CONFLICT', `Project code "${b.code}" is already in use.`);
    }
    if (b.endDate !== undefined && b.endDate && proj.startDate && new Date(b.endDate) < new Date(proj.startDate)) {
      throw err('VALIDATION_ERROR', 'End date cannot be earlier than start date');
    }
    if (b.startDate !== undefined && b.startDate && proj.endDate && new Date(proj.endDate) < new Date(b.startDate)) {
      throw err('VALIDATION_ERROR', 'End date cannot be earlier than start date');
    }
    Object.assign(proj, b);
    proj.updatedAt = new Date().toISOString();
    return proj;
  }
  if (method === 'DELETE' && p.startsWith('/projects/')) {
    const projectNumber = decodeURIComponent(p.slice('/projects/'.length));
    const proj = state.projects.find((p) => p.projectNumber === projectNumber);
    if (!proj) throw err('NOT_FOUND', 'Project not found');
    proj.active = false;
    proj.status = 'CANCELLED';
    proj.updatedAt = new Date().toISOString();
    return proj;
  }

  // Reports
  if (method === 'GET' && p === '/reports/current-stock') {
    return computeCurrentStock(qs);
  }
  if (method === 'GET' && p === '/reports/movement-history') {
    const limit = qs.limit ? Number(qs.limit) : 200;
    let list = state.transactions.slice().sort((a, b) => b.postedAt.localeCompare(a.postedAt));
    if (qs.materialId) list = list.filter((t) => t.materialId === qs.materialId);
    if (qs.type) list = list.filter((t) => t.type === qs.type);
    if (qs.projectNumber) list = list.filter((t) => t.projectNumber === qs.projectNumber);
    return list.slice(0, limit).map((t) => enrichMovement(t));
  }
  if (method === 'GET' && p === '/reports/month-end') {
    const currency = String(MOCK_SETTINGS['general.defaultCurrency']?.value ?? 'ZAR');
    return computeMonthEnd(qs.month || new Date().toISOString().slice(0, 7), {
      transactions: state.transactions, materials: state.materials, locations: state.locations, bands: mockBands(), currency,
      consumption: (from, to) => computeConsumption({ from, to }, { transactions: state.transactions, materials: state.materials, projects: state.projects, currency }),
    });
  }
  if (method === 'GET' && p === '/reports/stock-value') {
    return computeStockValue();
  }
  if (method === 'GET' && p === '/reports/consumption') {
    return computeConsumption(qs, {
      transactions: state.transactions, materials: state.materials, projects: state.projects, recipients: state.recipients,
      currency: String(MOCK_SETTINGS['general.defaultCurrency']?.value ?? 'ZAR'),
      userName: (id) => mockUsers.find((u) => u.id === id)?.name ?? 'Unknown',
    });
  }
  if (method === 'GET' && p === '/reports/stock-status') {
    const wanted = (qs.status ?? '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
    return computeStockStatus({ status: wanted as StockStatus[], category: qs.category });
  }
  if (method === 'GET' && p === '/reports/low-stock') {
    // Same shape as the backend's ReportingService.lowStock(): the URGENT and WARNING items.
    if (MOCK_SETTINGS['inventory.enableStockAlerts']?.value === false) return [];
    return computeStockStatus({ status: ['URGENT', 'WARNING'] });
  }

  if (method === 'GET' && p === '/reports/inventory') {
    return buildReport(parseMockReportQuery(qs), {
      bands: mockBands(),
      materials: state.materials,
      locations: state.locations,
      suppliers: state.suppliers,
      purchaseOrders: state.purchaseOrders,
      transactions: state.transactions,
    });
  }

  // Users
  if (method === 'GET' && p === '/users') {
    return mockUsersApi.list();
  }
  if (method === 'GET' && p === '/users/lookup') {
    return mockUsersApi.listForLookup();
  }
  if (method === 'GET' && p.startsWith('/users/') && p.split('/').length === 3) {
    const id = p.slice('/users/'.length);
    const u = mockUsersApi.list().find((x) => x.id === id);
    if (!u) throw err('NOT_FOUND', 'User not found');
    return u;
  }
  if (method === 'POST' && p === '/users') {
    const b = body as { email?: string; name?: string; password?: string; roleNames?: string[] };
    if (!b.email || !b.name || !b.password || !b.roleNames?.length) {
      throw err('VALIDATION_ERROR', 'Email, name, password, and at least one role are required');
    }
    return mockUsersApi.create(b as { email: string; name: string; password: string; roleNames: string[] });
  }
  if (method === 'PATCH' && p.startsWith('/users/') && p.split('/').length === 3) {
    const id = p.slice('/users/'.length);
    const b = body as { name?: string; active?: boolean; roleNames?: string[] };
    return mockUsersApi.update(id, b);
  }

  // ── Settings ───────────────────────────────────────────────────────────
  if (method === 'GET' && p === '/settings') {
    return Object.values(MOCK_SETTINGS);
  }
  if (method === 'GET' && p === '/settings/values') {
    // `p` is the path with the query string already stripped (see
    // `route()` above). Parse the query from the original `path`
    // argument so the comma-separated `keys` parameter is honoured.
    const q = parseQuery(path);
    const keys = (q['keys'] ?? '').split(',').map((k) => k.trim()).filter(Boolean);
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const row = MOCK_SETTINGS[k];
      if (row) out[k] = row.value;
    }
    return out;
  }
  if (method === 'GET' && p.startsWith('/settings/')) {
    const key = p.slice('/settings/'.length);
    if (key in MOCK_SETTINGS) return MOCK_SETTINGS[key];
    throw err('NOT_FOUND', 'Setting not found');
  }
  if (method === 'PUT' && p.startsWith('/settings/') && p !== '/settings/reset') {
    const key = p.slice('/settings/'.length);
    const def = MOCK_SETTINGS[key];
    if (!def) throw err('NOT_FOUND', 'Setting not found');
    const b = body as { value: unknown };
    const validated = validateMockSetting(key, b.value);
    if (validated.error) throw err('VALIDATION_ERROR', validated.error);
    const before = { value: def.value };
    def.value = validated.value;
    def.updatedAt = new Date().toISOString();
    def.updatedById = 'u-admin';
    MOCK_AUDIT.unshift({ id: nextId('audit'), action: 'SETTING_UPDATE', entityType: 'Setting', entityId: key, before, after: { value: def.value }, createdAt: new Date().toISOString(), actorId: 'u-admin' });
    return def;
  }
  if (method === 'PATCH' && p === '/settings') {
    const b = body as { updates: Record<string, unknown> };
    if (!b?.updates || typeof b.updates !== 'object') throw err('VALIDATION_ERROR', 'updates is required');
    const out: MockSetting[] = [];
    for (const [key, raw] of Object.entries(b.updates)) {
      const def = MOCK_SETTINGS[key];
      if (!def) throw err('NOT_FOUND', `Setting ${key} not found`);
      const validated = validateMockSetting(key, raw);
      if (validated.error) throw err('VALIDATION_ERROR', `${key}: ${validated.error}`);
      const before = { value: def.value };
      def.value = validated.value;
      def.updatedAt = new Date().toISOString();
      def.updatedById = 'u-admin';
      MOCK_AUDIT.unshift({ id: nextId('audit'), action: 'SETTING_BULK_UPDATE', entityType: 'Setting', entityId: key, before, after: { value: def.value }, createdAt: new Date().toISOString(), actorId: 'u-admin' });
      out.push({ ...def });
    }
    return out;
  }
  if (method === 'POST' && p === '/settings/reset') {
    for (const def of Object.values(MOCK_SETTINGS)) {
      def.value = def.defaultValue;
      def.updatedAt = new Date().toISOString();
      def.updatedById = 'u-admin';
      MOCK_AUDIT.unshift({ id: nextId('audit'), action: 'SETTING_RESET', entityType: 'Setting', entityId: def.key, before: { value: def.value }, after: { value: def.value, reset: true }, createdAt: new Date().toISOString(), actorId: 'u-admin' });
    }
    return Object.values(MOCK_SETTINGS);
  }

  // ── Audit log ─────────────────────────────────────────────────────────
  if (method === 'GET' && p.startsWith('/audit')) {
    const q = parseQuery(p);
    const entityType = q['entityType'];
    const limit = Number(q['limit'] ?? 100);
    return MOCK_AUDIT.filter((a) => !entityType || a.entityType === entityType).slice(0, limit);
  }

  throw err('NOT_FOUND', `Mock route not implemented: ${method} ${p}`);
}

// ── Mock settings catalog ────────────────────────────────────────────────
type MockSettingType = 'string' | 'number' | 'boolean' | 'enum';
interface MockSetting {
  key: string;
  value: unknown;
  defaultValue: unknown;
  type: MockSettingType;
  category: string;
  description: string;
  isEditable: boolean;
  enumOptions: string[] | null;
  updatedAt: string;
  updatedById: string | null;
}

function buildMockSettings(): Record<string, MockSetting> {
  const now = new Date().toISOString();
  const row = (key: string, value: unknown, type: MockSettingType, category: string, description: string, enumOptions: string[] | null = null): MockSetting => ({
    key, value, defaultValue: value, type, category, description, isEditable: true, enumOptions, updatedAt: now, updatedById: null,
  });
  return {
    'general.companyName': row('general.companyName', 'Afrinov', 'string', 'general', 'Company or organisation name shown across the application.'),
    'general.systemDescription': row('general.systemDescription', 'Inventory & operations management', 'string', 'general', 'Short description of the system.'),
    'general.defaultCurrency': row('general.defaultCurrency', 'ZAR', 'enum', 'general', 'Default currency for monetary values.', ['ZAR', 'USD', 'EUR', 'GBP']),
    'general.dateFormat': row('general.dateFormat', 'YYYY-MM-DD', 'enum', 'general', 'Date display format.', ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']),
    'general.timeFormat': row('general.timeFormat', '24h', 'enum', 'general', 'Time display format.', ['24h', '12h']),
    'general.defaultPageSize': row('general.defaultPageSize', 25, 'number', 'general', 'Default rows per page in tables.'),
    'general.defaultLandingPage': row('general.defaultLandingPage', 'dashboard', 'enum', 'general', 'Where to go after sign-in.', ['dashboard', 'inventory', 'low-stock', 'movements', 'purchase-orders']),

    'inventory.urgentBelowPercent': row('inventory.urgentBelowPercent', 20, 'number', 'inventory', 'An item is URGENT when its stock on hand is below this percentage of its Required Stock.'),
    'inventory.warningBelowPercent': row('inventory.warningBelowPercent', 40, 'number', 'inventory', 'An item is WARNING when its stock on hand is below this percentage of its Required Stock (and not URGENT).'),
    'inventory.defaultUnitOfMeasure': row('inventory.defaultUnitOfMeasure', 'each', 'string', 'inventory', 'Default unit of measure for new materials.'),
    'inventory.enableStockAlerts': row('inventory.enableStockAlerts', true, 'boolean', 'inventory', 'Show stock status (URGENT, WARNING, OK) and list items that need re-ordering.'),

    'purchaseOrders.requireApprovalBeforeProcessing': row('purchaseOrders.requireApprovalBeforeProcessing', true, 'boolean', 'purchase_orders', 'When on, submission routes through PENDING_APPROVAL; when off, submission auto-approves.'),
    'purchaseOrders.allowCancellation': row('purchaseOrders.allowCancellation', true, 'boolean', 'purchase_orders', 'Allow cancelling purchase orders before delivery.'),
    'purchaseOrders.allowEditAfterApproval': row('purchaseOrders.allowEditAfterApproval', true, 'boolean', 'purchase_orders', 'Allow editing a purchase order once it has been approved.'),

    'notifications.enableInAppNotifications': row('notifications.enableInAppNotifications', true, 'boolean', 'notifications', 'Show operational alerts inside the application.'),
    'notifications.enableLowStockNotifications': row('notifications.enableLowStockNotifications', true, 'boolean', 'notifications', 'Generate alerts when materials fall below their reorder threshold.'),
    'notifications.enablePurchaseOrderNotifications': row('notifications.enablePurchaseOrderNotifications', true, 'boolean', 'notifications', 'Alert when purchase orders need approval or reach a new state.'),

    'appearance.theme': row('appearance.theme', 'system', 'enum', 'appearance', 'Default visual theme.', ['system', 'light', 'dark']),
    'appearance.density': row('appearance.density', 'comfortable', 'enum', 'appearance', 'Default table density.', ['comfortable', 'compact']),

    'security.sessionTimeoutMinutes': row('security.sessionTimeoutMinutes', 60, 'number', 'security', 'Inactivity time before a session is signed out.'),
  };
}

const MOCK_SETTINGS: Record<string, MockSetting> = buildMockSettings();
const MOCK_AUDIT: Array<{ id: string; action: string; entityType: string; entityId: string; before: unknown; after: unknown; createdAt: string; actorId: string | null }> = [];

function validateMockSetting(key: string, raw: unknown): { value?: unknown; error?: string } {
  const def = MOCK_SETTINGS[key];
  if (!def) return { error: 'Unknown setting' };
  switch (def.type) {
    case 'string': {
      if (typeof raw !== 'string') return { error: 'Must be text' };
      const v = raw.trim();
      if (key === 'general.companyName' && v.length < 1) return { error: 'Company name is required' };
      if (v.length > 500) return { error: 'Must be at most 500 characters' };
      return { value: v };
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return { error: 'Must be a number' };
      if (!Number.isInteger(n)) return { error: 'Must be a whole number' };
      return { value: n };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw };
      if (raw === 'true') return { value: true };
      if (raw === 'false') return { value: false };
      return { error: 'Must be true or false' };
    }
    case 'enum': {
      if (typeof raw !== 'string' || !raw) return { error: 'Selection is required' };
      if (!def.enumOptions?.includes(raw)) return { error: 'Selected value is not supported' };
      return { value: raw };
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseQuery(path: string): Record<string, string> {
  const i = path.indexOf('?');
  if (i < 0) return {};
  const out: Record<string, string> = {};
  for (const part of path.slice(i + 1).split('&')) {
    const [k, v] = part.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  }
  return out;
}

function toArr(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseMockReportQuery(qs: Record<string, string>): MockReportQuery {
  const range = (qs['range'] ?? 'ALL') as MockReportQuery['range'];
  const stockStatus = (qs['stockStatus'] ?? 'ALL') as MockReportQuery['stockStatus'];
  const itemStatus = (qs['itemStatus'] ?? 'ACTIVE') as MockReportQuery['itemStatus'];
  const movementType = qs['movementType'] as MockReportQuery['movementType'] | undefined;
  return {
    range,
    from: qs['from'] || undefined,
    to: qs['to'] || undefined,
    category: toArr(qs['category']),
    locationId: toArr(qs['locationId']),
    supplierId: toArr(qs['supplierId']),
    materialId: toArr(qs['materialId']),
    stockStatus,
    itemStatus,
    search: qs['search'] || undefined,
    movementType,
    page: qs['page'] ? Math.max(1, Number(qs['page'])) : 1,
    pageSize: qs['pageSize'] ? Math.min(1000, Math.max(1, Number(qs['pageSize']))) : 200,
  };
}

function devUser(): MockUser {
  return {
    id: 'user-1',
    email: 'admin@afrinov.local',
    name: 'System Administrator (dev)',
    roles: ['ADMIN', 'STORE_CONTROLLER', 'PROCUREMENT', 'APPROVER', 'TECHNICIAN', 'VIEWER'],
  };
}

function handleStockItemCreate(b: {
  sku: string; name: string; category: string; description?: string; unitOfMeasure: string;
  requiredStock?: number; unitCost?: number; initialQuantity?: number; locationId?: string; supplierId?: string;
}): { material: MockMaterial; initialTransactionId: string | null } {
  if (!b.sku || !b.name || !b.category || !b.unitOfMeasure) {
    throw err('VALIDATION_ERROR', 'SKU, name, category and unit of measure are required');
  }
  if (state.materials.some((m) => m.sku === b.sku)) {
    throw err('CONFLICT', `An item with this SKU already exists.`);
  }
  const qty = b.initialQuantity ?? 0;
  if (qty < 0) throw err('VALIDATION_ERROR', 'Initial quantity cannot be negative');
  if (qty > 0 && !b.locationId) throw err('VALIDATION_ERROR', 'A location is required when an initial quantity is supplied');
  const loc = b.locationId ? findLocation(b.locationId) : null;
  if (b.locationId && !loc) throw err('NOT_FOUND', 'Location not found');
  if (loc && !loc.active) throw err('VALIDATION_ERROR', 'Location is inactive');

  const created: MockMaterial = {
    id: nextId('mat'),
    sku: b.sku,
    name: b.name,
    description: b.description,
    category: b.category as MockMaterial['category'],
    unitOfMeasure: b.unitOfMeasure,
    requiredStock: String(b.requiredStock ?? 0),
    unitCost: b.unitCost !== undefined ? String(b.unitCost) : undefined,
    active: true,
  };
  state.materials.push(created);

  let initialTransactionId: string | null = null;
  if (qty > 0 && b.locationId) {
    const txId = nextId('t');
    state.transactions.push({
      id: txId,
      postedAt: new Date().toISOString(),
      type: 'RECEIPT',
      materialId: created.id,
      locationId: b.locationId,
      quantity: String(qty),
      actorId: 'user-1',
      referenceType: 'InitialStock',
      referenceId: created.id,
    });
    initialTransactionId = txId;
  }

  return { material: created, initialTransactionId };
}

// Mirrors InventoryService.issue: one recipient (required), an optional
// project, several lines; all-or-nothing, with repeated items checked as one total.
interface IssueBody {
  recipientId?: string;
  projectNumber?: string;
  lines?: Array<{ materialId: string; locationId: string; quantity: number }>;
}
function handleIssue(b: IssueBody): { transactionIds: string[] } {
  if (!b.recipientId) throw err('VALIDATION_ERROR', 'Choose who the stock is issued to');
  const lines = b.lines ?? [];
  if (lines.length === 0) throw err('VALIDATION_ERROR', 'Add at least one item to issue');
  if (lines.some((l) => !l.materialId || !l.locationId || !(l.quantity > 0))) throw err('VALIDATION_ERROR', 'Invalid issue payload');
  const recipient = state.recipients.find((x) => x.id === b.recipientId);
  if (!recipient) throw err('NOT_FOUND', 'Recipient not found');
  if (!recipient.active) throw err('VALIDATION_ERROR', 'Recipient is inactive');
  if (b.projectNumber) {
    const project = state.projects.find((x) => x.projectNumber === b.projectNumber);
    if (!project) throw err('NOT_FOUND', 'Project not found');
    if (project.active === false) throw err('VALIDATION_ERROR', 'Project is inactive');
  }
  const totals = new Map<string, { materialId: string; locationId: string; quantity: number }>();
  for (const l of lines) {
    const key = `${l.materialId}|${l.locationId}`;
    const t = totals.get(key);
    if (t) t.quantity += l.quantity;
    else totals.set(key, { ...l });
  }
  for (const t of totals.values()) {
    const material = findMaterial(t.materialId);
    if (!material) throw err('NOT_FOUND', 'Material not found');
    if (!findLocation(t.locationId)) throw err('NOT_FOUND', 'Location not found');
    const balance = getBalance(t.materialId, t.locationId);
    if (balance < t.quantity) {
      throw err('INSUFFICIENT_BALANCE', `Cannot issue ${t.quantity} × ${material.sku}: only ${balance} available.`, {
        requested: t.quantity,
        available: balance,
      });
    }
  }
  const postedAt = new Date().toISOString();
  return {
    transactionIds: lines.map((l) => {
      const id = nextId('t');
      state.transactions.push({
        id,
        postedAt,
        type: 'ISSUE',
        materialId: l.materialId,
        locationId: l.locationId,
        quantity: String(-l.quantity),
        actorId: 'user-1',
        recipientId: b.recipientId,
        projectNumber: b.projectNumber,
        referenceType: b.projectNumber ? 'Project' : undefined,
        referenceId: b.projectNumber,
      });
      return id;
    }),
  };
}

function handleTransfer(b: { materialId: string; fromLocationId: string; toLocationId: string; quantity: number }): { outTransactionId: string; inTransactionId: string } {
  if (!b.materialId || !b.fromLocationId || !b.toLocationId || !(b.quantity > 0)) {
    throw err('VALIDATION_ERROR', 'Invalid transfer payload');
  }
  if (b.fromLocationId === b.toLocationId) throw err('VALIDATION_ERROR', 'Source and destination must differ');
  if (!findMaterial(b.materialId)) throw err('NOT_FOUND', 'Material not found');
  const balance = getBalance(b.materialId, b.fromLocationId);
  if (balance < b.quantity) {
    throw err('INSUFFICIENT_BALANCE', `Cannot transfer ${b.quantity} units: only ${balance} available.`);
  }
  const outId = nextId('t');
  const inId = nextId('t');
  const postedAt = new Date().toISOString();
  state.transactions.push({
    id: outId, postedAt, type: 'TRANSFER_OUT', materialId: b.materialId, locationId: b.fromLocationId, quantity: String(-b.quantity), actorId: 'user-1', pairedWithId: inId,
  });
  state.transactions.push({
    id: inId, postedAt, type: 'TRANSFER_IN', materialId: b.materialId, locationId: b.toLocationId, quantity: String(b.quantity), actorId: 'user-1', pairedWithId: outId,
  });
  return { outTransactionId: outId, inTransactionId: inId };
}

// Mirrors InventoryService.reverse: an opposite entry of the same type,
// linked to the original; both legs of a transfer reversed together.
// Mirrors InventoryService.returnToStock.
function returnedAgainst(issueId: string): number {
  return state.transactions
    .filter((t) => t.type === 'RETURN' && t.referenceType === 'Return' && t.referenceId === issueId)
    .reduce((a, t) => a + Number(t.quantity), 0);
}
function handleReturn(id: string, b: { quantity?: number; locationId?: string; reason?: string }) {
  if (!(Number(b.quantity) > 0)) throw err('VALIDATION_ERROR', 'Return quantity must be positive');
  const issue = state.transactions.find((t) => t.id === id);
  if (!issue) throw err('NOT_FOUND', 'InventoryTransaction not found');
  if (issue.type !== 'ISSUE' || issue.reversesId) throw err('INVALID_STATE', 'Only an issue can have stock returned against it.');
  if (state.transactions.some((t) => t.reversesId === issue.id)) throw err('INVALID_STATE', 'This issue has been reversed, so there is nothing to return.');
  const issued = -Number(issue.quantity);
  const already = returnedAgainst(issue.id);
  const qty = Number(b.quantity);
  if (qty > issued - already) {
    throw err('VALIDATION_ERROR', `Cannot return ${qty}: only ${issued - already} of the ${issued} issued is still out.`);
  }
  const locationId = b.locationId ?? issue.locationId;
  if (!findLocation(locationId)) throw err('NOT_FOUND', 'Location not found');
  const transactionId = nextId('t');
  state.transactions.push({
    id: transactionId, postedAt: new Date().toISOString(), type: 'RETURN', materialId: issue.materialId, locationId,
    quantity: String(qty), actorId: 'user-1', recipientId: issue.recipientId, projectNumber: issue.projectNumber,
    reasonNote: b.reason?.trim() || undefined, referenceType: 'Return', referenceId: issue.id,
  });
  return { transactionId, returnedQuantity: String(already + qty), returnableQuantity: String(issued - already - qty) };
}

function handleReversal(id: string, b: { reason?: string } | undefined): { reversalIds: string[] } {
  const reason = b?.reason?.trim() ?? '';
  if (reason.length < 3) throw err('VALIDATION_ERROR', 'A reason is required to reverse a movement');
  const original = state.transactions.find((t) => t.id === id);
  if (!original) throw err('NOT_FOUND', 'InventoryTransaction not found');
  if (original.reversesId) throw err('INVALID_STATE', 'A reversal cannot itself be reversed. Record the movement again instead.');
  if (original.type === 'ISSUE' && returnedAgainst(original.id) > 0) {
    throw err('INVALID_STATE', 'Part of this issue has been returned. Reverse the returns first.');
  }
  if (original.referenceType === 'GoodsReceipt' && state.goodsReceipts.find((g) => g.id === original.referenceId)?.purchaseOrderId) {
    throw err('INVALID_STATE', 'Stock received against a purchase order cannot be reversed here.');
  }
  const partner = original.pairedWithId ? state.transactions.find((t) => t.id === original.pairedWithId) : undefined;
  const legs = partner ? (partner.type === 'TRANSFER_OUT' ? [partner, original] : [original, partner]) : [original];
  if (legs.some((leg) => state.transactions.some((t) => t.reversesId === leg.id))) {
    throw err('CONFLICT', 'This movement has already been reversed.');
  }
  for (const leg of legs) {
    const qty = Number(leg.quantity);
    const balance = getBalance(leg.materialId, leg.locationId);
    if (qty > 0 && balance < qty) {
      throw err('INSUFFICIENT_BALANCE', `Cannot reverse: only ${balance} of the ${qty} units are still in stock.`);
    }
  }
  const postedAt = new Date().toISOString();
  const reversals = legs.map((leg) => ({
    ...leg,
    id: nextId('t'),
    postedAt,
    quantity: String(-Number(leg.quantity)),
    actorId: 'user-1',
    reasonNote: reason,
    reversesId: leg.id,
    pairedWithId: undefined as string | undefined,
  }));
  if (reversals.length === 2) {
    reversals[0]!.pairedWithId = reversals[1]!.id;
    reversals[1]!.pairedWithId = reversals[0]!.id;
  }
  state.transactions.push(...reversals);
  MOCK_AUDIT.unshift({ id: nextId('audit'), action: 'REVERSE', entityType: 'InventoryTransaction', entityId: original.id, before: null, after: { reversalIds: reversals.map((r) => r.id), reason }, createdAt: postedAt, actorId: 'u-admin' });
  return { reversalIds: reversals.map((r) => r.id) };
}

function handleAdjustment(b: { materialId: string; locationId: string; quantity: number; reasonCode: AdjustmentReasonCode; reasonNote?: string }): { transactionId: string } {
  if (!b.materialId || !b.locationId || !b.reasonCode) throw err('VALIDATION_ERROR', 'Invalid adjustment payload');
  if (b.quantity === 0) throw err('VALIDATION_ERROR', 'Quantity must be non-zero');
  const balance = getBalance(b.materialId, b.locationId);
  if (b.quantity < 0 && balance < -b.quantity) {
    throw err('INSUFFICIENT_BALANCE', `Cannot adjust ${b.quantity} units: only ${balance} available.`);
  }
  const id = nextId('t');
  state.transactions.push({
    id,
    postedAt: new Date().toISOString(),
    type: 'ADJUSTMENT',
    materialId: b.materialId,
    locationId: b.locationId,
    quantity: String(b.quantity),
    actorId: 'user-1',
    reasonCode: b.reasonCode,
    reasonNote: b.reasonNote,
  });
  return { transactionId: id };
}

// Mirrors StockCountService.post: all or nothing, refused when stock moved since it was shown.
function handleStockCount(b: { locationId?: string; note?: string; lines?: Array<{ materialId: string; expectedQuantity: number; countedQuantity: number }> }) {
  const lines = b.lines ?? [];
  if (!b.locationId || lines.length === 0) throw err('VALIDATION_ERROR', 'Invalid stock count payload');
  if (lines.some((l) => !(l.countedQuantity >= 0) || !(l.expectedQuantity >= 0))) throw err('VALIDATION_ERROR', 'Invalid stock count payload');
  if (new Set(lines.map((l) => l.materialId)).size !== lines.length) throw err('VALIDATION_ERROR', 'Each item can appear only once in a count');
  const location = findLocation(b.locationId);
  if (!location) throw err('NOT_FOUND', 'Location not found');
  if (lines.some((l) => !findMaterial(l.materialId))) throw err('NOT_FOUND', 'Material not found');
  const moved = lines
    .map((l) => ({ sku: findMaterial(l.materialId)!.sku, expected: l.expectedQuantity, current: getBalance(l.materialId, b.locationId!) }))
    .filter((m) => Math.abs(m.expected - m.current) > 0.00005);
  if (moved.length > 0) {
    throw err('CONFLICT', `Stock at ${location.name} changed while you were counting (${moved.slice(0, 3).map((m) => `${m.sku}: ${m.expected} → ${m.current}`).join(', ')}). Reload the system quantities, check those items, and post again.`);
  }
  const countId = nextId('count');
  const note = b.note?.trim();
  const results = lines.map((l) => {
    const variance = l.countedQuantity - getBalance(l.materialId, b.locationId!);
    if (Math.abs(variance) < 0.00005) return { materialId: l.materialId, variance: '0', transactionId: null as string | null };
    const id = nextId('t');
    state.transactions.push({
      id, postedAt: new Date().toISOString(), type: 'ADJUSTMENT', materialId: l.materialId, locationId: b.locationId!,
      quantity: String(variance), actorId: 'user-1', reasonCode: 'COUNT_VARIANCE',
      reasonNote: note ? `Stock count: ${note}` : 'Stock count', referenceType: 'StockCount', referenceId: countId,
    });
    return { materialId: l.materialId, variance: String(variance), transactionId: id as string | null };
  });
  return { countId, counted: lines.length, adjusted: results.filter((r) => r.transactionId).length, lines: results };
}

function getBalance(materialId: string, locationId: string): number {
  return state.transactions
    .filter((t) => t.materialId === materialId && t.locationId === locationId)
    .reduce((acc, t) => acc + Number(t.quantity), 0);
}

function mockLocationDependencyCounts(locationId: string): { racks: number; goodsReceiptLines: number; inventoryTransactions: number; inventoryBalances: number } {
  const balances = computeBalances();
  return {
    racks: state.racks.filter((r) => r.locationId === locationId).length,
    goodsReceiptLines: state.goodsReceipts.reduce((acc, g) => acc + g.lines.filter((l) => l.locationId === locationId).length, 0),
    inventoryTransactions: state.transactions.filter((t) => t.locationId === locationId).length,
    inventoryBalances: balances.filter((b) => b.locationId === locationId).length,
  };
}

// ── Mock users store (admin) ───────────────────────────────────────────
interface MockAdminUser {
  id: string;
  email: string;
  name: string;
  active: boolean;
  createdAt: string;
  roles: Array<{ role: { name: 'ADMIN' | 'STORE_CONTROLLER' | 'PROCUREMENT' | 'APPROVER' | 'TECHNICIAN' | 'VIEWER' } }>;
}
const SEED_USERS: MockAdminUser[] = [
  { id: 'user-1', email: 'admin@afrinov.local', name: 'System Administrator (dev)', active: true, createdAt: new Date('2026-01-01').toISOString(), roles: [{ role: { name: 'ADMIN' } }] },
  { id: 'user-2', email: 'store@afrinov.local', name: 'Store Controller', active: true, createdAt: new Date('2026-01-15').toISOString(), roles: [{ role: { name: 'STORE_CONTROLLER' } }] },
  { id: 'user-3', email: 'procurement@afrinov.local', name: 'Procurement Lead', active: true, createdAt: new Date('2026-02-01').toISOString(), roles: [{ role: { name: 'PROCUREMENT' } }] },
  { id: 'user-4', email: 'viewer@afrinov.local', name: 'Read-only Viewer', active: false, createdAt: new Date('2026-03-01').toISOString(), roles: [{ role: { name: 'VIEWER' } }] },
];
let mockUsers: MockAdminUser[] = JSON.parse(JSON.stringify(SEED_USERS));

function recordAudit(action: string, entityId: string, before: unknown, after: unknown): void {
  MOCK_AUDIT.unshift({
    id: nextId('audit'),
    action,
    entityType: 'User',
    entityId,
    before,
    after,
    createdAt: new Date().toISOString(),
    actorId: 'u-admin',
  });
}

const mockUsersApi = {
  list(): MockAdminUser[] { return mockUsers; },
  listForLookup(): Array<{ id: string; name: string }> {
    return mockUsers.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name }));
  },
  create(b: { email: string; name: string; password: string; roleNames: string[] }): MockAdminUser {
    if (mockUsers.some((u) => u.email.toLowerCase() === b.email.toLowerCase())) {
      throw err('CONFLICT', 'Email already in use');
    }
    const created: MockAdminUser = {
      id: nextId('user'),
      email: b.email.toLowerCase(),
      name: b.name,
      active: true,
      createdAt: new Date().toISOString(),
      roles: b.roleNames.map((r) => ({ role: { name: r as MockAdminUser['roles'][number]['role']['name'] } })),
    };
    mockUsers.push(created);
    recordAudit('CREATE', created.id, null, { email: created.email, name: created.name, roles: b.roleNames });
    return created;
  },
  update(id: string, b: { name?: string; active?: boolean; roleNames?: string[] }): MockAdminUser {
    const u = mockUsers.find((x) => x.id === id);
    if (!u) throw err('NOT_FOUND', 'User not found');
    const before = { name: u.name, active: u.active, roles: u.roles.map((r) => r.role.name) };
    if (b.name !== undefined) u.name = b.name;
    if (b.active !== undefined) u.active = b.active;
    if (b.roleNames !== undefined) {
      u.roles = b.roleNames.map((r) => ({ role: { name: r as MockAdminUser['roles'][number]['role']['name'] } }));
    }
    const after = { name: u.name, active: u.active, roles: u.roles.map((r) => r.role.name) };
    recordAudit('UPDATE', u.id, before, after);
    return u;
  },
};

function mockBands(): StatusBands {
  return {
    urgentBelowPercent: Number(MOCK_SETTINGS['inventory.urgentBelowPercent']?.value ?? 20),
    warningBelowPercent: Number(MOCK_SETTINGS['inventory.warningBelowPercent']?.value ?? 40),
  };
}

// The supplier of the latest posted goods receipt with this item, as the backend reports it.
function lastSupplierOf(materialId: string): { name: string; receivedAt: string } | null {
  const latest = state.goodsReceipts
    .filter((g) => g.status === 'POSTED' && g.lines.some((l) => l.materialId === materialId))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  if (!latest) return null;
  const name = state.suppliers.find((s) => s.id === latest.supplierId)?.name;
  return name ? { name, receivedAt: new Date(latest.receivedAt).toISOString() } : null;
}

// Mirrors ReportingService.stockStatus.
function computeStockStatus(filter: { status?: StockStatus[]; category?: string }) {
  const balances = computeBalances();
  const bands = mockBands();
  const order: Record<StockStatus, number> = { URGENT: 0, WARNING: 1, OK: 2, NOT_SET: 3 };
  return state.materials
    .filter((m) => m.active && (!filter.category || m.category === filter.category))
    .map((m) => {
      const mine = balances.filter((b) => b.materialId === m.id);
      const onHand = mine.reduce((a, b) => a + b.quantity, 0);
      const item = classifyItem(onHand, Number(m.requiredStock), bands);
      return {
        materialId: m.id, sku: m.sku, name: m.name, category: m.category, unitOfMeasure: m.unitOfMeasure,
        requiredStock: String(Number(m.requiredStock)), onHand: String(onHand),
        percentOfRequired: item.percentOfRequired, status: item.status, reorderQuantity: String(item.reorderQuantity),
        unitCost: m.unitCost === undefined || m.unitCost === null ? null : String(m.unitCost),
        locations: mine
          .map((b) => ({ locationId: b.locationId, locationName: findLocation(b.locationId)?.name ?? '—', quantity: String(b.quantity) }))
          .sort((a, b) => a.locationName.localeCompare(b.locationName)),
        lastSupplier: lastSupplierOf(m.id),
      };
    })
    .filter((r) => !filter.status || filter.status.length === 0 || filter.status.includes(r.status))
    .sort((a, b) => order[a.status] - order[b.status] || (a.percentOfRequired ?? Infinity) - (b.percentOfRequired ?? Infinity) || a.name.localeCompare(b.name));
}

// Mirrors ReportingService.stockValue: on hand x unit price per category, and items by status.
function computeStockValue() {
  const order = ['CONSUMABLES', 'FASTENERS_SLUGS_INSULATION', 'TOOLING_PPE_ELECTRICAL', 'PROJECT_MATERIAL', 'TOOLS'];
  const cats = new Map<string, { items: number; itemsInStock: number; value: number; unpriced: number }>();
  const status = { URGENT: 0, WARNING: 0, OK: 0, NOT_SET: 0, outOfStock: 0 };
  for (const r of computeStockStatus({})) {
    const onHand = Number(r.onHand);
    const c = cats.get(r.category) ?? { items: 0, itemsInStock: 0, value: 0, unpriced: 0 };
    c.items++;
    if (onHand > 0) {
      c.itemsInStock++;
      if (r.unitCost === null) c.unpriced++;
      else c.value += onHand * Number(r.unitCost);
    } else {
      status.outOfStock++;
    }
    cats.set(r.category, c);
    status[r.status]++;
  }
  const total = [...cats.values()].reduce(
    (a, c) => ({ items: a.items + c.items, itemsInStock: a.itemsInStock + c.itemsInStock, value: a.value + c.value, unpriced: a.unpriced + c.unpriced }),
    { items: 0, itemsInStock: 0, value: 0, unpriced: 0 },
  );
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    currency: String(MOCK_SETTINGS['general.defaultCurrency']?.value ?? 'ZAR'),
    categories: [...cats]
      .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
      .map(([category, c]) => ({ category, ...c, value: round2(c.value), share: total.value > 0 ? Math.round((c.value / total.value) * 1000) / 1000 : 0 })),
    total: { ...total, value: round2(total.value) },
    status,
  };
}

function computeCurrentStock(qs: Record<string, string>): MockStockRow[] {
  const balances = computeBalances();
  const bands = mockBands();
  const alertsOn = MOCK_SETTINGS['inventory.enableStockAlerts']?.value !== false;
  const totals = new Map<string, number>();
  for (const b of balances) totals.set(b.materialId, (totals.get(b.materialId) ?? 0) + b.quantity);
  const matMap = new Map(state.materials.map((m) => [m.id, m]));
  const locMap = new Map(state.locations.map((l) => [l.id, l]));
  const rows: MockStockRow[] = [];
  for (const b of balances) {
    const m = matMap.get(b.materialId);
    const l = locMap.get(b.locationId);
    if (!m || !l) continue;
    if (qs.materialId && b.materialId !== qs.materialId) continue;
    if (qs.locationId && b.locationId !== qs.locationId) continue;
    if (qs.category && m.category !== qs.category) continue;
    const required = Number(m.requiredStock);
    rows.push({
      materialId: m.id,
      materialSku: m.sku,
      materialName: m.name,
      category: m.category,
      unitOfMeasure: m.unitOfMeasure,
      requiredStock: String(required),
      locationId: l.id,
      locationName: l.name,
      locationType: l.type,
      quantity: String(b.quantity),
      ...(() => {
        const item = classifyItem(totals.get(m.id) ?? 0, required, bands);
        return { belowThreshold: alertsOn && needsAttention(item.status), stockStatus: alertsOn ? item.status : null, percentOfRequired: item.percentOfRequired };
      })(),
    });
  }
  return rows.sort((a, b) => a.materialSku.localeCompare(b.materialSku) || a.locationName.localeCompare(b.locationName));
}

function enrichMovement(t: MockInventoryTransaction): MockMovementRow {
  const m = findMaterial(t.materialId);
  const l = findLocation(t.locationId);
  const actor = mockUsers.find((u) => u.id === t.actorId);
  return {
    id: t.id,
    postedAt: t.postedAt,
    type: t.type,
    materialId: t.materialId,
    materialSku: m?.sku ?? t.materialId,
    materialName: m?.name ?? 'Unknown',
    locationId: t.locationId,
    locationName: l?.name ?? t.locationId,
    quantity: t.quantity,
    actorId: t.actorId,
    actorName: actor?.name ?? 'Unknown',
    recipientId: t.recipientId,
    recipientName: state.recipients.find((r) => r.id === t.recipientId)?.name ?? null,
    recipientType: state.recipients.find((r) => r.id === t.recipientId)?.type ?? null,
    returnedQuantity: t.type === 'ISSUE' ? String(returnedAgainst(t.id)) : null,
    ...(() => {
      const gr = t.referenceType === 'GoodsReceipt' ? state.goodsReceipts.find((g) => g.id === t.referenceId) : undefined;
      return { receiptNumber: gr?.number ?? null, supplierName: gr ? findSupplier(gr.supplierId)?.name ?? null : null, deliveryRef: gr?.deliveryRef ?? null };
    })(),
    reasonCode: t.reasonCode,
    reasonNote: t.reasonNote,
    projectNumber: t.projectNumber,
    referenceType: t.referenceType,
    referenceId: t.referenceId,
    reversesId: t.reversesId,
    reversedById: state.transactions.find((r) => r.reversesId === t.id)?.id,
  };
}