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
  if (method === 'POST' && p === '/auth/signup') {
    const b = body as { name?: string; email?: string; password?: string } | undefined;
    if (!b?.name || !b?.email || !b?.password) throw err('VALIDATION_ERROR', 'Name, email, and password are required');
    if (b.password.length < 8) throw err('VALIDATION_ERROR', 'Password must be at least 8 characters');
    return {
      token: 'mock-token',
      user: { ...devUser(), id: `signup-${Date.now()}`, email: b.email.toLowerCase(), name: b.name },
    };
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
    if (po.status !== 'PENDING_APPROVAL' && po.status !== 'SUBMITTED') throw err('INVALID_STATE', `Cannot approve from ${po.status}`);
    const before = { status: po.status };
    po.status = 'APPROVED';
    po.approvedAt = new Date().toISOString();
    po.approvedBy = { id: 'u-admin', name: 'You (admin)', email: 'admin@afrinov.local', roles: ['ADMIN'] };
    po.history = po.history ?? [];
    po.history.push({ id: nextId('audit'), action: 'PO_APPROVE', actorId: 'u-admin', before, after: { status: po.status }, createdAt: new Date().toISOString() });
    return po;
  }
  if (method === 'POST' && p.endsWith('/ship')) {
    const id = p.slice('/purchase-orders/'.length, -'/ship'.length);
    const po = state.purchaseOrders.find((x) => x.id === id);
    if (!po) throw err('NOT_FOUND', 'Purchase order not found');
    if (po.status !== 'APPROVED') throw err('INVALID_STATE', `Cannot ship from ${po.status}`);
    const b = (body as { trackingNumber?: string; carrier?: string; shipmentNotes?: string }) ?? {};
    const before = { status: po.status };
    po.status = 'SHIPPED';
    po.shippedAt = new Date().toISOString();
    po.shippedBy = { id: 'u-admin', name: 'You (admin)', email: 'admin@afrinov.local', roles: ['ADMIN'] };
    po.trackingNumber = b.trackingNumber ?? null;
    po.carrier = b.carrier ?? null;
    po.shipmentNotes = b.shipmentNotes ?? null;
    po.history = po.history ?? [];
    po.history.push({ id: nextId('audit'), action: 'PO_SHIP', actorId: 'u-admin', before, after: { status: po.status, trackingNumber: po.trackingNumber, carrier: po.carrier }, createdAt: new Date().toISOString() });
    return po;
  }
  if (method === 'POST' && p.endsWith('/deliver')) {
    const id = p.slice('/purchase-orders/'.length, -'/deliver'.length);
    const po = state.purchaseOrders.find((x) => x.id === id);
    if (!po) throw err('NOT_FOUND', 'Purchase order not found');
    if (po.status !== 'SHIPPED') throw err('INVALID_STATE', `Cannot deliver from ${po.status}`);
    const b = (body as { locationId?: string; deliveryNotes?: string }) ?? {};
    if (!b.locationId) throw err('VALIDATION_ERROR', 'locationId is required');
    if (!state.locations.find((l) => l.id === b.locationId)) throw err('NOT_FOUND', 'Location not found');
    const before = { status: po.status };
    po.status = 'DELIVERED';
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
    po.history.push({ id: nextId('audit'), action: 'PO_DELIVER', actorId: 'u-admin', before, after: { status: po.status, locationId: b.locationId }, createdAt: new Date().toISOString() });
    return po;
  }
  if (method === 'POST' && p.endsWith('/cancel')) {
    const id = p.slice('/purchase-orders/'.length, -'/cancel'.length);
    const po = state.purchaseOrders.find((x) => x.id === id);
    if (!po) throw err('NOT_FOUND', 'Purchase order not found');
    if (!['DRAFT', 'PENDING_APPROVAL', 'SUBMITTED', 'APPROVED'].includes(po.status)) throw err('INVALID_STATE', `Cannot cancel from ${po.status}`);
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
    if (po.status === 'DELIVERED' || po.status === 'CANCELLED') throw err('INVALID_STATE', 'This purchase order is no longer editable.');
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
    if (b.purchaseOrderId && !state.purchaseOrders.find((p) => p.id === b.purchaseOrderId)) throw err('NOT_FOUND', 'Purchase order not found');
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
        po.status = allFully ? 'FULLY_RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : 'APPROVED';
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
  if (method === 'POST' && p === '/inventory-issues') {
    const b = body as { materialId: string; locationId: string; quantity: number; projectNumber?: string };
    return handleIssue(b);
  }
  if (method === 'POST' && p === '/inventory-transfers') {
    const b = body as { materialId: string; fromLocationId: string; toLocationId: string; quantity: number };
    return handleTransfer(b);
  }
  if (method === 'POST' && p === '/inventory-adjustments') {
    const b = body as { materialId: string; locationId: string; quantity: number; reasonCode: AdjustmentReasonCode; reasonNote?: string };
    return handleAdjustment(b);
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
  if (method === 'GET' && p === '/reports/low-stock') {
    // Returned in the same shape as the backend `ReportingService.lowStock()`
    // (see apps/backend/src/modules/reporting/reporting.service.ts) so the
    // Low Stock page can consume the same TypeScript interface in both
    // frontend-only mode and live mode.
    return computeCurrentStock({})
      .filter((r) => r.belowThreshold)
      .map((r) => ({
        materialId: r.materialId,
        sku: r.materialSku,
        name: r.materialName,
        unitOfMeasure: r.unitOfMeasure,
        locationId: r.locationId,
        locationName: r.locationName,
        quantity: r.quantity,
        requiredStock: r.requiredStock,
      }));
  }
  if (method === 'GET' && p === '/reports/inventory') {
    return buildReport(parseMockReportQuery(qs), {
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

    'inventory.lowStockMultiplier': row('inventory.lowStockMultiplier', 1, 'number', 'inventory', 'Multiplier applied to per-material reorder thresholds.'),
    'inventory.defaultUnitOfMeasure': row('inventory.defaultUnitOfMeasure', 'each', 'string', 'inventory', 'Default unit of measure for new materials.'),
    'inventory.enableStockAlerts': row('inventory.enableStockAlerts', true, 'boolean', 'inventory', 'Highlight materials at or below their reorder threshold.'),

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

function handleIssue(b: { materialId: string; locationId: string; quantity: number; projectNumber?: string }): { transactionId: string } {
  if (!b.materialId || !b.locationId || !(b.quantity > 0)) throw err('VALIDATION_ERROR', 'Invalid issue payload');
  if (!findMaterial(b.materialId)) throw err('NOT_FOUND', 'Material not found');
  if (!findLocation(b.locationId)) throw err('NOT_FOUND', 'Location not found');
  const balance = getBalance(b.materialId, b.locationId);
  if (balance < b.quantity) {
    throw err('INSUFFICIENT_BALANCE', `Cannot issue ${b.quantity} units: only ${balance} available.`, {
      requested: b.quantity,
      available: balance,
    });
  }
  const id = nextId('t');
  state.transactions.push({
    id,
    postedAt: new Date().toISOString(),
    type: 'ISSUE',
    materialId: b.materialId,
    locationId: b.locationId,
    quantity: String(-b.quantity),
    actorId: 'user-1',
    projectNumber: b.projectNumber,
    referenceType: b.projectNumber ? 'Project' : undefined,
    referenceId: b.projectNumber,
  });
  return { transactionId: id };
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
function handleReversal(id: string, b: { reason?: string } | undefined): { reversalIds: string[] } {
  const reason = b?.reason?.trim() ?? '';
  if (reason.length < 3) throw err('VALIDATION_ERROR', 'A reason is required to reverse a movement');
  const original = state.transactions.find((t) => t.id === id);
  if (!original) throw err('NOT_FOUND', 'InventoryTransaction not found');
  if (original.reversesId) throw err('INVALID_STATE', 'A reversal cannot itself be reversed. Record the movement again instead.');
  if (original.referenceType === 'GoodsReceipt') throw err('INVALID_STATE', 'Stock received against a goods receipt cannot be reversed here.');
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

function computeCurrentStock(qs: Record<string, string>): MockStockRow[] {
  const balances = computeBalances();
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
      belowThreshold: b.quantity <= required,
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
    reasonCode: t.reasonCode,
    reasonNote: t.reasonNote,
    projectNumber: t.projectNumber,
    referenceType: t.referenceType,
    referenceId: t.referenceId,
    reversesId: t.reversesId,
    reversedById: state.transactions.find((r) => r.reversesId === t.id)?.id,
  };
}