// Mutation-flow tests for the frontend-only mock API layer.
//
// These tests exercise the mock backend's write paths (POST/PATCH/DELETE)
// to verify that the mock enforces the same ADR-002 invariants the real
// backend does:
//   - balances are derived from posted transactions (never stored directly),
//   - issues cannot drive a balance below zero (when prevention is on),
//   - transfers are atomic and paired,
//   - SKUs are unique,
//   - PO state-machine transitions reject invalid source states,
//   - goods-receipt posting rejects receiving more than the ordered quantity.
//
// The mock is reset between tests via `resetMockState()`.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Counter receipts, as with procurement off; receiving against orders needs no switch in the mock.
vi.mock('../config/features', () => ({ PROCUREMENT_ENABLED: false }));
import { createMockApi, resetMockState } from './mockApi';
import { isApiError } from '../api/client';
import type { ApiError } from '../api/client';
import type { MockPurchaseOrder, MockSupplier } from './types';

const api = createMockApi();

/** Issue one line to a recipient ('rcp-1' is Sabelo, active in the seed). */
async function issue(materialId: string, locationId: string, quantity: number, recipientId = 'rcp-1'): Promise<string> {
  const { transactionIds } = await api.post<{ transactionIds: string[] }>('/inventory-issues', {
    recipientId, lines: [{ materialId, locationId, quantity }],
  });
  return transactionIds[0]!;
}

describe('mock API mutation flows', () => {
  beforeEach(() => {
    resetMockState();
  });

  it('initializes existing demo orders with supplier details that survive later supplier edits', async () => {
    const po = await api.get<MockPurchaseOrder>('/purchase-orders/po-1');
    const supplier = await api.get<MockSupplier>(`/suppliers/${po.supplierId}`);
    const expected = {
      supplierContactName: supplier.contactName ?? null, supplierContactPhone: supplier.contactPhone ?? null,
      supplierContactEmail: supplier.contactEmail ?? null, supplierAddress: supplier.address ?? null,
    };
    expect(po).toMatchObject(expected);
    await api.patch(`/suppliers/${po.supplierId}`, { contactName: 'New contact', contactPhone: null, contactEmail: 'new@example.com', address: 'New branch' });
    expect(await api.get(`/purchase-orders/${po.id}`)).toMatchObject(expected);
  });

  describe('suppliers (vendor fields, edit, deactivate)', () => {
    it('adds a supplier with a vendor code, tidied, and ZAR by default', async () => {
      const s = await api.post<{ id: string; vendorCode: string; currency: string; paymentTerms: string }>('/suppliers', { name: 'Fast Flame', vendorCode: ' v003', paymentTerms: 'cod' });
      expect(s).toMatchObject({ vendorCode: 'V003', currency: 'ZAR', paymentTerms: 'C.O.D' });
      expect(await api.get(`/suppliers/${s.id}`)).toMatchObject({ name: 'Fast Flame' });
    });

    it('refuses a vendor code another supplier has', async () => {
      const e = await api.post('/suppliers', { name: 'Someone else', vendorCode: 'V007' }).catch((x: unknown) => x);
      expect(isApiError(e) && (e as ApiError).code).toBe('CONFLICT');
    });

    it('edits only the fields sent, and clears one with null', async () => {
      const after = await api.patch<Record<string, unknown>>('/suppliers/sup-1', { paymentTerms: 'C.O.D', address: null });
      expect(after).toMatchObject({ name: 'Hydroscand', vendorCode: 'V007', paymentTerms: 'C.O.D' });
      expect(after.address).toBeUndefined();
    });

    it('takes no new purchase orders for an inactive supplier', async () => {
      await api.patch('/suppliers/sup-1', { active: false });
      const e = await api.post('/purchase-orders', { supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1 }] }).catch((x: unknown) => x);
      expect(isApiError(e) && (e as ApiError).code).toBe('VALIDATION_ERROR');
    });
  });

  describe('purchase order prices and VAT', () => {
    type Priced = { id: string; currency: string; vatRate: string; lines: Array<{ id: string; net: string | null }>; totals: { net: string; unpricedLines: number } };

    it('keeps prices and works out the totals at the VAT setting for rand suppliers', async () => {
      const po = await api.post<{ id: string }>('/purchase-orders', { supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 3, unitPrice: 12.5 }, { materialId: 'mat-2', orderedQty: 1 }] });
      const read = await api.get<Priced>(`/purchase-orders/${po.id}`);
      expect(read).toMatchObject({ currency: 'ZAR', vatRate: '15', totals: { net: '43.13', unpricedLines: 1 } });
    });

    it('starts a foreign-currency order at 0%', async () => {
      await api.patch('/suppliers/sup-2', { currency: 'EUR' });
      const po = await api.post<{ id: string }>('/purchase-orders', { supplierId: 'sup-2', lines: [{ materialId: 'mat-1', orderedQty: 1, unitPrice: 100 }] });
      expect(await api.get<Priced>(`/purchase-orders/${po.id}`)).toMatchObject({ currency: 'EUR', vatRate: '0', totals: { net: '100.00' } });
    });

    it('edits a line price and the VAT rate', async () => {
      const po = await api.post<{ id: string }>('/purchase-orders', { supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 4 }] });
      const lineId = (await api.get<Priced>(`/purchase-orders/${po.id}`)).lines[0]!.id;
      await api.patch(`/purchase-orders/${po.id}`, { vatRate: 0, linePrices: [{ lineId, unitPrice: 2.5 }] });
      expect((await api.get<Priced>(`/purchase-orders/${po.id}`)).totals).toMatchObject({ net: '10.00', unpricedLines: 0 });
    });
  });

  describe('goods receipts against an order (workflow Phase 1)', () => {
    it('refuses lines that do not name their order line, and credits the order when they do', async () => {
      const po = await api.get<{ id: string; supplierId: string; lines: Array<{ id: string; materialId: string }> }>('/purchase-orders/po-1');
      const line = po.lines[0]!;
      const bad = await api.post('/goods-receipts', { purchaseOrderId: po.id, supplierId: po.supplierId, lines: [{ materialId: line.materialId, locationId: 'loc-1', quantity: 1 }] }).catch((x: unknown) => x);
      expect(isApiError(bad) && (bad as ApiError).code).toBe('VALIDATION_ERROR');
      const gr = await api.post<{ id: string }>('/goods-receipts', { purchaseOrderId: po.id, supplierId: po.supplierId, lines: [{ materialId: line.materialId, locationId: 'loc-1', quantity: 1, purchaseOrderLineId: line.id }] });
      await api.post(`/goods-receipts/${gr.id}/post`, {});
      const after = await api.get<{ status: string; lines: Array<{ id: string; receivedQty: string }> }>('/purchase-orders/po-1');
      expect(after.status).toBe('PARTIALLY_RECEIVED');
      expect(after.lines.find((l) => l.id === line.id)!.receivedQty).toBe('1');
    });
  });

  describe('purchase order numbers and revisions', () => {
    it('numbers new orders AFRI-NNNN, from the setting, past the demo PO-2026 orders', async () => {
      const a = await api.post<{ number: string }>('/purchase-orders', { supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1 }] });
      const b = await api.post<{ number: string }>('/purchase-orders', { supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1 }] });
      expect([a.number, b.number]).toEqual(['AFRI-0001', 'AFRI-0002']);
    });

    it('raises the revision when an approved order changes, not for a draft or an unchanged save', async () => {
      const po = await api.post<{ id: string }>('/purchase-orders', { supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1, unitPrice: 2 }] });
      await api.patch(`/purchase-orders/${po.id}`, { shippingTerms: 'FOB' });
      expect((await api.get<{ revision: number }>(`/purchase-orders/${po.id}`)).revision).toBe(0);
      await api.post(`/purchase-orders/${po.id}/submit`, {});
      await api.post(`/purchase-orders/${po.id}/approve`, {});
      await api.patch(`/purchase-orders/${po.id}`, { shippingTerms: 'FOB' });
      expect((await api.get<{ revision: number }>(`/purchase-orders/${po.id}`)).revision).toBe(0);
      await api.patch(`/purchase-orders/${po.id}`, { shippingTerms: 'Ex works' });
      expect((await api.get<{ revision: number }>(`/purchase-orders/${po.id}`)).revision).toBe(1);
    });
  });

  describe('purchase order approval by value', () => {
    async function submitted(lines: Array<{ materialId: string; orderedQty: number; unitPrice?: number }>) {
      const po = await api.post<{ id: string }>('/purchase-orders', { supplierId: 'sup-1', vatRate: 15, lines });
      await api.post(`/purchase-orders/${po.id}/submit`, {});
      return po.id;
    }

    it('refuses to approve while a line has no price', async () => {
      const id = await submitted([{ materialId: 'mat-1', orderedQty: 1 }]);
      expect((await api.get<{ canApprove: boolean; unpricedLines: number }>(`/purchase-orders/${id}/approval`))).toMatchObject({ canApprove: false, unpricedLines: 1 });
      const e = await api.post(`/purchase-orders/${id}/approve`, {}).catch((x: unknown) => x);
      expect(isApiError(e) && (e as ApiError).code).toBe('VALIDATION_ERROR');
    });

    it('refuses an order over the signed-in user\'s limit', async () => {
      await api.patch('/users/user-1', { approvalLimit: 100 });
      const id = await submitted([{ materialId: 'mat-1', orderedQty: 1, unitPrice: 100 }]); // R115 with VAT
      expect(await api.get<{ canApprove: boolean }>(`/purchase-orders/${id}/approval`)).toMatchObject({ canApprove: false });
      const e = await api.post(`/purchase-orders/${id}/approve`, {}).catch((x: unknown) => x);
      expect(isApiError(e) && (e as ApiError).code).toBe('FORBIDDEN');
      await api.patch('/users/user-1', { approvalLimit: null });
    });
  });

  describe('purchase order details', () => {
    type Detailed = Record<string, unknown> & { lines: Array<{ id: string; deliveryDate?: string | null }> };

    it('fills the delivery block from Settings and the terms from the supplier', async () => {
      await api.patch('/suppliers/sup-1', { paymentTerms: '30 DAYS NETT' });
      const po = await api.post<{ id: string }>('/purchase-orders', { supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1 }] });
      expect(await api.get<Detailed>(`/purchase-orders/${po.id}`)).toMatchObject({
        paymentTerms: '30 DAYS NETT', deliveryMethod: 'DELIVERY', deliveryTo: 'Afrinov (PTY) Ltd', deliveryCountry: 'South Africa',
      });
    });

    it('refuses an unknown project, and edits details and a line date', async () => {
      const bad = await api.post('/purchase-orders', { supplierId: 'sup-1', projectNumber: 'NOPE', lines: [{ materialId: 'mat-1', orderedQty: 1 }] }).catch((x: unknown) => x);
      expect(isApiError(bad) && (bad as ApiError).code).toBe('VALIDATION_ERROR');
      const po = await api.post<{ id: string }>('/purchase-orders', { supplierId: 'sup-1', shippingTerms: 'FOB', lines: [{ materialId: 'mat-1', orderedQty: 1 }] });
      const lineId = (await api.get<Detailed>(`/purchase-orders/${po.id}`)).lines[0]!.id;
      await api.patch(`/purchase-orders/${po.id}`, { shippingTerms: null, penaltiesApply: true, lineDeliveryDates: [{ lineId, deliveryDate: '2026-12-01' }] });
      const read = await api.get<Detailed>(`/purchase-orders/${po.id}`);
      expect(read).toMatchObject({ shippingTerms: null, penaltiesApply: true });
      expect(read.lines[0]!.deliveryDate).toBe('2026-12-01');
    });
  });

  describe('purchase order supplier details', () => {
    const supplier = { contactName: 'Nicole', contactPhone: '011 452 8413', contactEmail: 'nicole@example.com', address: '23 Grader Road, Spartan' };
    const copied = { supplierContactName: 'Nicole', supplierContactPhone: '011 452 8413', supplierContactEmail: 'nicole@example.com', supplierAddress: '23 Grader Road, Spartan' };
    const cleared = { supplierContactName: null, supplierContactPhone: null, supplierContactEmail: null, supplierAddress: null };

    async function createOrder(details: Partial<MockPurchaseOrder> = {}) {
      return api.post<MockPurchaseOrder>('/purchase-orders', {
        supplierId: 'sup-1', lines: [{ materialId: 'mat-1', orderedQty: 1 }], ...details,
      });
    }

    beforeEach(async () => { await api.patch('/suppliers/sup-1', supplier); });

    it('keeps a snapshot on a new order when the supplier is subsequently changed', async () => {
      const po = await createOrder();
      expect(po).toMatchObject(copied);
      await api.patch('/suppliers/sup-1', { contactName: 'Sean', contactPhone: null, contactEmail: 'sean@example.com', address: 'Branch 2' });
      await api.patch(`/purchase-orders/${po.id}`, { notes: 'Unrelated order edit' });
      expect(await api.get(`/purchase-orders/${po.id}`)).toMatchObject(copied);
      expect(await createOrder()).toMatchObject({ supplierContactName: 'Sean', supplierContactPhone: null, supplierContactEmail: 'sean@example.com', supplierAddress: 'Branch 2' });
    });

    it('combines order overrides, cleared fields and supplier defaults independently', async () => {
      expect(await createOrder({ supplierContactName: '  Sean  ', supplierContactPhone: null, supplierAddress: '  Branch 2\nRoodekop  ' }))
        .toMatchObject({ ...copied, supplierContactName: 'Sean', supplierContactPhone: null, supplierAddress: 'Branch 2\nRoodekop' });
      expect(await api.get<MockSupplier>('/suppliers/sup-1')).toMatchObject(supplier);
    });

    it.each([null, '', ' \t\n '])('keeps explicit clears on creation and edit (%j)', async (value) => {
      const blankDetails = { supplierContactName: value, supplierContactPhone: value, supplierContactEmail: value, supplierAddress: value };
      expect(await createOrder(blankDetails)).toMatchObject(cleared);
      const po = await createOrder();
      await api.patch(`/purchase-orders/${po.id}`, blankDetails);
      await api.patch(`/purchase-orders/${po.id}`, { notes: 'Do not repopulate' });
      expect(await api.get(`/purchase-orders/${po.id}`)).toMatchObject(cleared);
      expect(await api.get<MockSupplier>('/suppliers/sup-1')).toMatchObject(supplier);
    });

    it('stores absent supplier details as nulls', async () => {
      await api.patch('/suppliers/sup-1', { contactName: null, contactPhone: null, contactEmail: null, address: null });
      expect(await createOrder()).toMatchObject(cleared);
    });
  });

  describe('POST /materials (create)', () => {
    it('creates a material and returns it', async () => {
      const result = await api.post<{ id: string; sku: string; name: string; active: boolean }>('/materials', {
        sku: 'TEST-001',
        name: 'Test Bolt',
        category: 'FASTENERS_SLUGS_INSULATION',
        unitOfMeasure: 'each',
      });
      expect(result.sku).toBe('TEST-001');
      expect(result.name).toBe('Test Bolt');
      expect(result.active).toBe(true);
      expect(result.id).toBeTruthy();
    });

    it('rejects a duplicate SKU with CONFLICT', async () => {
      await api.post('/materials', {
        sku: 'DUP-SKU',
        name: 'First',
        category: 'FASTENERS_SLUGS_INSULATION',
        unitOfMeasure: 'each',
      });
      let caught: ApiError | undefined;
      try {
        await api.post('/materials', {
          sku: 'DUP-SKU',
          name: 'Second',
          category: 'FASTENERS_SLUGS_INSULATION',
          unitOfMeasure: 'each',
        });
      } catch (e) {
        if (isApiError(e)) caught = e;
      }
      expect(caught).toBeDefined();
      expect(caught!.code).toBe('CONFLICT');
      expect(caught!.message).toMatch(/SKU.*already exists/i);
    });

    it('rejects missing required fields with VALIDATION_ERROR', async () => {
      let caught: ApiError | undefined;
      try {
        await api.post('/materials', { name: 'No SKU', unitOfMeasure: 'each' });
      } catch (e) {
        if (isApiError(e)) caught = e;
      }
      expect(caught).toBeDefined();
      expect(caught!.code).toBe('VALIDATION_ERROR');
    });
  });

  // ── Inventory mutations (ADR-002) ───────────────────────────────────────
  describe('inventory issue / transfer / adjust', () => {
    // The seed data gives mat-1 at loc-1: 120 received - 70 issued - 20 transferred = 30.
    it('issues only up to the available balance', async () => {
      const before = await api.get<Array<{ materialId: string; locationId: string; quantity: string }>>(
        '/reports/current-stock?materialId=mat-1',
      );
      const loc1 = before.find((r) => r.locationId === 'loc-1');
      expect(loc1).toBeTruthy();
      const qtyBefore = Number(loc1!.quantity);
      expect(qtyBefore).toBe(30);

      await issue('mat-1', 'loc-1', 10);
      const after = await api.get<Array<{ materialId: string; locationId: string; quantity: string }>>(
        '/reports/current-stock?materialId=mat-1',
      );
      const loc1After = after.find((r) => r.locationId === 'loc-1');
      expect(Number(loc1After!.quantity)).toBe(20);
    });

    it('rejects an issue that would exceed the balance with INSUFFICIENT_BALANCE', async () => {
      // mat-1 at loc-1 has 30 after seed. Asking for 100 should fail.
      let caught: ApiError | undefined;
      try {
        await issue('mat-1', 'loc-1', 100);
      } catch (e) {
        if (isApiError(e)) caught = e;
      }
      expect(caught).toBeDefined();
      expect(caught!.code).toBe('INSUFFICIENT_BALANCE');
      // Balance must be unchanged after a rejected issue.
      const stock = await api.get<Array<{ materialId: string; locationId: string; quantity: string }>>(
        '/reports/current-stock?materialId=mat-1',
      );
      expect(Number(stock.find((s) => s.locationId === 'loc-1')!.quantity)).toBe(30);
    });

    it('transfer moves stock atomically between two locations', async () => {
      // mat-1 at loc-1 (30) → loc-3 (20). After: loc-1=25, loc-3=25.
      await api.post('/inventory-transfers', {
        materialId: 'mat-1',
        fromLocationId: 'loc-1',
        toLocationId: 'loc-3',
        quantity: 5,
      });
      const stock = await api.get<Array<{ materialId: string; locationId: string; quantity: string }>>(
        '/reports/current-stock?materialId=mat-1',
      );
      const loc1 = stock.find((s) => s.locationId === 'loc-1');
      const loc3 = stock.find((s) => s.locationId === 'loc-3');
      expect(Number(loc1!.quantity)).toBe(25);
      expect(Number(loc3!.quantity)).toBe(25);
    });

    it('transfer to the same location is rejected', async () => {
      let caught: ApiError | undefined;
      try {
        await api.post('/inventory-transfers', {
          materialId: 'mat-1',
          fromLocationId: 'loc-1',
          toLocationId: 'loc-1',
          quantity: 5,
        });
      } catch (e) {
        if (isApiError(e)) caught = e;
      }
      expect(caught).toBeDefined();
      expect(caught!.code).toBe('VALIDATION_ERROR');
    });

    it('adjustment with zero quantity is rejected', async () => {
      let caught: ApiError | undefined;
      try {
        await api.post('/inventory-adjustments', {
          materialId: 'mat-1',
          locationId: 'loc-1',
          quantity: 0,
          reasonCode: 'COUNT_VARIANCE',
        });
      } catch (e) {
        if (isApiError(e)) caught = e;
      }
      expect(caught).toBeDefined();
      expect(caught!.code).toBe('VALIDATION_ERROR');
    });

    it('negative adjustment reduces balance correctly', async () => {
      await api.post('/inventory-adjustments', {
        materialId: 'mat-1',
        locationId: 'loc-1',
        quantity: -5,
        reasonCode: 'DAMAGE',
      });
      const stock = await api.get<Array<{ materialId: string; locationId: string; quantity: string }>>(
        '/reports/current-stock?materialId=mat-1',
      );
      expect(Number(stock.find((s) => s.locationId === 'loc-1')!.quantity)).toBe(25);
    });

    it('rejects a negative adjustment larger than the balance with INSUFFICIENT_BALANCE', async () => {
      let caught: ApiError | undefined;
      try {
        await api.post('/inventory-adjustments', { materialId: 'mat-1', locationId: 'loc-1', quantity: -31, reasonCode: 'LOSS' });
      } catch (e) {
        if (isApiError(e)) caught = e;
      }
      expect(caught?.code).toBe('INSUFFICIENT_BALANCE');
    });
  });

  // ── ADR-002: balances derived from transactions ─────────────────────────
  describe('ADR-002 — balances are derived, not stored', () => {
    it('a posted receipt increases the current-stock balance', async () => {
      const beforeRows = await api.get<Array<{ materialId: string; locationId: string; quantity: string }>>(
        '/reports/current-stock?materialId=mat-8',
      );
      // mat-8 at loc-1: seed receipt 25 - issue 5 = 20
      const before = Number(beforeRows.find((r) => r.locationId === 'loc-1')?.quantity ?? 0);

      await issue('mat-8', 'loc-1', 10);
      const afterRows = await api.get<Array<{ materialId: string; locationId: string; quantity: string }>>(
        '/reports/current-stock?materialId=mat-8',
      );
      const after = Number(afterRows.find((r) => r.locationId === 'loc-1')?.quantity ?? 0);

      expect(after).toBe(before - 10);
    });

    it('inventory-transactions are enriched with material/location names', async () => {
      const txns = await api.get<Array<{ id: string; materialSku: string; locationName: string; type: string }>>(
        '/inventory-transactions?materialId=mat-1',
      );
      expect(txns.length).toBeGreaterThan(0);
      for (const t of txns) {
        expect(t.materialSku).toBeTruthy();
        expect(t.locationName).toBeTruthy();
      }
    });
  });

  // ── Purchase order state machine ────────────────────────────────────────
  describe('purchase order state machine', () => {
    function makeDraftPO() {
      return api.post<{ id: string }>('/purchase-orders', {
        supplierId: 'sup-1',
        // Priced: an order with unpriced lines can't be approved.
        lines: [{ materialId: 'mat-1', orderedQty: 5, unitPrice: 4.5 }],
      });
    }

    it('submit moves a DRAFT PO to PENDING_APPROVAL', async () => {
      const draft = await makeDraftPO();
      const result = await api.post<{ status: string }>(`/purchase-orders/${draft.id}/submit`, {});
      expect(result.status).toBe('PENDING_APPROVAL');
    });

    async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
      try {
        await p;
        return undefined;
      } catch (e) {
        return isApiError(e) ? e.code : 'UNKNOWN';
      }
    }

    async function approvedPO() {
      const draft = await makeDraftPO();
      await api.post(`/purchase-orders/${draft.id}/submit`, {});
      await api.post(`/purchase-orders/${draft.id}/approve`, {});
      return draft;
    }

    it('has no shipping stage', async () => {
      const draft = await makeDraftPO();
      expect(await codeOf(api.post(`/purchase-orders/${draft.id}/ship`, { trackingNumber: 'TRK-1' }))).not.toBeUndefined();
    });

    it('rejects receiving a PO that is not approved yet', async () => {
      const draft = await makeDraftPO();
      await api.post(`/purchase-orders/${draft.id}/submit`, {});
      expect(await codeOf(api.post(`/purchase-orders/${draft.id}/receive`, { locationId: 'loc-1' }))).toBe('INVALID_STATE');
    });

    it('receives everything outstanding, then closes', async () => {
      const po = await approvedPO();
      const received = await api.post<{ status: string }>(`/purchase-orders/${po.id}/receive`, { locationId: 'loc-1' });
      expect(received.status).toBe('RECEIVED');
      expect(await codeOf(api.post(`/purchase-orders/${po.id}/cancel`, { reason: 'Too late' }))).toBe('INVALID_STATE');
      const closed = await api.post<{ status: string }>(`/purchase-orders/${po.id}/close`, {});
      expect(closed.status).toBe('CLOSED');
    });

    it('refuses goods receipts against a PO that is not approved', async () => {
      const draft = await makeDraftPO();
      const code = await codeOf(api.post('/goods-receipts', {
        purchaseOrderId: draft.id,
        supplierId: 'sup-1',
        lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 1 }],
      }));
      expect(code).toBe('INVALID_STATE');
    });

    it('cancelling a DRAFT PO requires a reason', async () => {
      const draft = await makeDraftPO();
      let caught: ApiError | undefined;
      try {
        await api.post<{ status: string }>(`/purchase-orders/${draft.id}/cancel`, {});
      } catch (e) {
        if (isApiError(e)) caught = e;
      }
      expect(caught).toBeDefined();
      expect(caught!.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('reversing a movement', () => {
    it.each(['outTransactionId', 'inTransactionId'] as const)('leaves both balances and history untouched if %s cannot be reversed', async (selectedLeg) => {
      const transfer = await api.post<{ outTransactionId: string; inTransactionId: string }>('/inventory-transfers', {
        materialId: 'mat-1', fromLocationId: 'loc-1', toLocationId: 'loc-3', quantity: 5,
      });
      await issue('mat-1', 'loc-3', 21);
      const before = await api.get('/inventory-transactions?materialId=mat-1');
      await expect(api.post(`/inventory-transactions/${transfer[selectedLeg]}/reversal`, { reason: 'Wrong rack' }))
        .rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
      expect(await stockAt('loc-1')).toBe(25);
      expect(await stockAt('loc-3')).toBe(4);
      expect(await api.get('/inventory-transactions?materialId=mat-1')).toEqual(before);
    });

    it('refuses to reverse a reversal without changing the restored stock', async () => {
      const transactionId = await issue('mat-1', 'loc-1', 5);
      const { reversalIds } = await api.post<{ reversalIds: string[] }>(`/inventory-transactions/${transactionId}/reversal`, { reason: 'Wrong item' });
      const before = await api.get('/inventory-transactions?materialId=mat-1');
      await expect(api.post(`/inventory-transactions/${reversalIds[0]}/reversal`, { reason: 'Undo reversal' }))
        .rejects.toMatchObject({ code: 'INVALID_STATE' });
      expect(await stockAt('loc-1')).toBe(30);
      expect(await api.get('/inventory-transactions?materialId=mat-1')).toEqual(before);
    });

    it('restores a negative adjustment with its reason code and a trimmed reversal note', async () => {
      const { transactionId } = await api.post<{ transactionId: string }>('/inventory-adjustments', {
        materialId: 'mat-1', locationId: 'loc-1', quantity: -5, reasonCode: 'LOSS', reasonNote: 'Missing stock',
      });
      const { reversalIds } = await api.post<{ reversalIds: string[] }>(`/inventory-transactions/${transactionId}/reversal`, { reason: '  Stock found  ' });
      const history = await api.get<Array<{ id: string }>>('/inventory-transactions?materialId=mat-1');
      expect(history.find((row) => row.id === transactionId)).toMatchObject({
        quantity: '-5', reasonCode: 'LOSS', reasonNote: 'Missing stock', reversedById: reversalIds[0],
      });
      expect(history.find((row) => row.id === reversalIds[0])).toMatchObject({
        type: 'ADJUSTMENT', quantity: '5', reasonCode: 'LOSS', reasonNote: 'Stock found', reversesId: transactionId,
      });
      expect(await stockAt('loc-1')).toBe(30);
    });

    async function stockAt(locationId: string): Promise<number> {
      const stock = await api.get<Array<{ locationId: string; quantity: string }>>('/reports/current-stock?materialId=mat-1');
      return Number(stock.find((s) => s.locationId === locationId)?.quantity ?? 0);
    }

    async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
      try {
        await p;
        return undefined;
      } catch (e) {
        return isApiError(e) ? e.code : 'UNKNOWN';
      }
    }

    it('reverses both legs of a transfer and marks the pair in the history', async () => {
      const { inTransactionId } = await api.post<{ inTransactionId: string }>('/inventory-transfers', {
        materialId: 'mat-1', fromLocationId: 'loc-1', toLocationId: 'loc-3', quantity: 5,
      });

      const { reversalIds } = await api.post<{ reversalIds: string[] }>(
        `/inventory-transactions/${inTransactionId}/reversal`, { reason: 'Wrong store' },
      );

      expect(reversalIds).toHaveLength(2);
      expect(await stockAt('loc-1')).toBe(30);
      expect(await stockAt('loc-3')).toBe(20);
      const history = await api.get<Array<{ id: string; reversesId?: string; reversedById?: string }>>(
        '/inventory-transactions?materialId=mat-1',
      );
      expect(history.find((t) => t.id === inTransactionId)!.reversedById).toBeTruthy();
      expect(history.filter((t) => t.reversesId)).toHaveLength(2);
    });

    it('refuses a second reversal, a blank reason and an unknown id', async () => {
      const { transactionId } = await api.post<{ transactionId: string }>('/inventory-adjustments', {
        materialId: 'mat-1', locationId: 'loc-1', quantity: 2, reasonCode: 'COUNT_VARIANCE',
      });
      expect(await codeOf(api.post(`/inventory-transactions/${transactionId}/reversal`, { reason: ' ' }))).toBe('VALIDATION_ERROR');
      await api.post(`/inventory-transactions/${transactionId}/reversal`, { reason: 'Counted twice' });
      expect(await codeOf(api.post(`/inventory-transactions/${transactionId}/reversal`, { reason: 'Again' }))).toBe('CONFLICT');
      expect(await codeOf(api.post('/inventory-transactions/missing/reversal', { reason: 'Typo' }))).toBe('NOT_FOUND');
    });

    it('no longer accepts edits to a posted transaction', async () => {
      const { transactionId } = await api.post<{ transactionId: string }>('/inventory-adjustments', {
        materialId: 'mat-1', locationId: 'loc-1', quantity: 2, reasonCode: 'COUNT_VARIANCE',
      });
      expect(await codeOf(api.patch(`/inventory-transactions/${transactionId}`, { actorId: 'user-2' }))).not.toBeUndefined();
    });
  });

  describe('recipients ("Issued To")', () => {
    async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
      try {
        await p;
        return undefined;
      } catch (e) {
        return isApiError(e) ? e.code : 'UNKNOWN';
      }
    }

    it('adds a recipient and refuses a duplicate name, ignoring case', async () => {
      const created = await api.post<{ id: string; name: string; active: boolean }>('/recipients', { name: ' Bukho ', type: 'WORKER' });
      expect(created).toMatchObject({ name: 'Bukho', active: true });
      expect(await codeOf(api.post('/recipients', { name: 'BUKHO', type: 'CONTRACTOR' }))).toBe('CONFLICT');
    });

    it('records the recipient on an issue and refuses an inactive one', async () => {
      const transactionId = await issue('mat-1', 'loc-1', 1, 'rcp-1');
      const history = await api.get<Array<{ id: string; recipientName?: string | null }>>('/inventory-transactions?materialId=mat-1');
      expect(history.find((t) => t.id === transactionId)?.recipientName).toBe('Sabelo');

      await api.patch('/recipients/rcp-1', { active: false });
      expect(await codeOf(issue('mat-1', 'loc-1', 1, 'rcp-1'))).toBe('VALIDATION_ERROR');
    });
  });

  describe('issuing several items at once', () => {
    it('books every line, and nothing when one line is short', async () => {
      const ids = await api.post<{ transactionIds: string[] }>('/inventory-issues', {
        recipientId: 'rcp-3', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 1 }, { materialId: 'mat-2', locationId: 'loc-1', quantity: 1 }],
      });
      expect(ids.transactionIds).toHaveLength(2);

      const before = (await api.get<unknown[]>('/inventory-transactions')).length;
      await expect(api.post('/inventory-issues', {
        recipientId: 'rcp-3', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 1 }, { materialId: 'mat-1', locationId: 'loc-1', quantity: 10000 }],
      })).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
      expect((await api.get<unknown[]>('/inventory-transactions')).length).toBe(before);
    });

    it('requires a recipient and refuses an unknown project', async () => {
      await expect(api.post('/inventory-issues', { lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 1 }] }))
        .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(api.post('/inventory-issues', { recipientId: 'rcp-1', projectNumber: 'NOPE', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 1 }] }))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('returning stock from an issue', () => {
    async function onHand(): Promise<number> {
      const stock = await api.get<Array<{ locationId: string; quantity: string }>>('/reports/current-stock?materialId=mat-1');
      return Number(stock.find((s) => s.locationId === 'loc-1')?.quantity ?? 0);
    }

    it('puts stock back, shows it on the issue, and refuses more than is still out', async () => {
      const start = await onHand();
      const issueId = await issue('mat-1', 'loc-1', 6);
      const res = await api.post<{ returnedQuantity: string; returnableQuantity: string }>(`/inventory-transactions/${issueId}/returns`, { quantity: 4, reason: 'Spare' });
      expect(res).toMatchObject({ returnedQuantity: '4', returnableQuantity: '2' });
      expect(await onHand()).toBe(start - 2);
      const history = await api.get<Array<{ id: string; type: string; returnedQuantity?: string | null; recipientName?: string | null }>>('/inventory-transactions?materialId=mat-1');
      expect(history.find((t) => t.id === issueId)?.returnedQuantity).toBe('4');
      expect(history.find((t) => t.type === 'RETURN')?.recipientName).toBe('Sabelo');
      await expect(api.post(`/inventory-transactions/${issueId}/returns`, { quantity: 3 }))
        .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringMatching(/only 2 of the 6 issued/) });
    });

    it('reverses the issue only after its returns are reversed', async () => {
      const start = await onHand();
      const issueId = await issue('mat-1', 'loc-1', 5);
      const { transactionId } = await api.post<{ transactionId: string }>(`/inventory-transactions/${issueId}/returns`, { quantity: 2 });
      await expect(api.post(`/inventory-transactions/${issueId}/reversal`, { reason: 'Wrong job' }))
        .rejects.toMatchObject({ code: 'INVALID_STATE' });
      await api.post(`/inventory-transactions/${transactionId}/reversal`, { reason: 'Booked by mistake' });
      await api.post(`/inventory-transactions/${issueId}/reversal`, { reason: 'Wrong job' });
      expect(await onHand()).toBe(start);
      await expect(api.post(`/inventory-transactions/${issueId}/returns`, { quantity: 1 }))
        .rejects.toMatchObject({ code: 'INVALID_STATE' });
    });

    it('lists what a recipient still has out, and returns several lines all-or-nothing', async () => {
      const start = await onHand();
      const a = await issue('mat-1', 'loc-1', 6);
      const b = await issue('mat-1', 'loc-1', 3);
      type Row = { issueTransactionId: string; outstanding: string };
      const out = async () => (await api.get<Row[]>('/inventory-returns/returnable?recipientId=rcp-1'))
        .filter((r) => r.issueTransactionId === a || r.issueTransactionId === b)
        .map((r) => [r.issueTransactionId, r.outstanding]);
      expect(await out()).toEqual([[b, '3'], [a, '6']]);

      await expect(api.post('/inventory-returns', { lines: [{ issueTransactionId: a, quantity: 2 }, { issueTransactionId: b, quantity: 4 }] }))
        .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(await onHand()).toBe(start - 9);

      const res = await api.post<{ transactionIds: string[] }>('/inventory-returns', { lines: [{ issueTransactionId: a, quantity: 2 }, { issueTransactionId: b, quantity: 3 }], reason: 'Job done' });
      expect(res.transactionIds).toHaveLength(2);
      expect(await onHand()).toBe(start - 4);
      expect(await out()).toEqual([[a, '4']]);
      await expect(api.get('/inventory-returns/returnable')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('lists returns in the Returned stock report, each naming the issue it came back from', async () => {
      const a = await issue('mat-1', 'loc-1', 6);
      await api.post('/inventory-returns', { lines: [{ issueTransactionId: a, quantity: 2 }] });
      const rows = await api.get<Array<{ type: string; quantity: string; returnOf: { id: string; locationName: string } | null }>>('/inventory-transactions?report=returned&recipientId=rcp-1');
      expect(rows.every((r) => r.type === 'RETURN')).toBe(true);
      const mine = rows.find((r) => r.returnOf?.id === a);
      expect(mine).toMatchObject({ quantity: '2', returnOf: { id: a } });
    });
  });

  describe('counting stock at a location', () => {
    async function onHand(materialId: string): Promise<number> {
      const stock = await api.get<Array<{ locationId: string; quantity: string }>>(`/reports/current-stock?materialId=${materialId}`);
      return Number(stock.find((s) => s.locationId === 'loc-1')?.quantity ?? 0);
    }

    it('posts each difference as a count-variance adjustment and nothing for a match', async () => {
      const disc = await onHand('mat-1');
      const other = await onHand('mat-2');
      const res = await api.post<{ counted: number; adjusted: number }>('/stock-counts', {
        locationId: 'loc-1', note: 'Go-live',
        lines: [
          { materialId: 'mat-1', expectedQuantity: disc, countedQuantity: disc - 2 },
          { materialId: 'mat-2', expectedQuantity: other, countedQuantity: other },
        ],
      });
      expect(res).toMatchObject({ counted: 2, adjusted: 1 });
      expect(await onHand('mat-1')).toBe(disc - 2);
      const history = await api.get<Array<{ type: string; reasonCode?: string; reasonNote?: string; quantity: string }>>('/inventory-transactions?materialId=mat-1');
      expect(history.find((t) => t.reasonCode === 'COUNT_VARIANCE')).toMatchObject({ type: 'ADJUSTMENT', quantity: '-2', reasonNote: 'Stock count: Go-live' });
    });

    it('refuses the count when stock moved since it was shown', async () => {
      const disc = await onHand('mat-1');
      await expect(api.post('/stock-counts', { locationId: 'loc-1', lines: [{ materialId: 'mat-1', expectedQuantity: disc + 1, countedQuantity: 0 }] }))
        .rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await onHand('mat-1')).toBe(disc);
    });
  });

  describe('receiving stock at the counter', () => {
    it('names the supplier on the stock status as the last supplier of the item', async () => {
      await api.post('/stock-receipts', { supplierId: 'sup-1', deliveryRef: 'INV-LAST', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 1 }] });
      const rows = await api.get<Array<{ materialId: string; lastSupplier: { name: string } | null }>>('/reports/stock-status');
      const supplier = (await api.get<Array<{ id: string; name: string }>>('/suppliers')).find((x) => x.id === 'sup-1')!;
      expect(rows.find((r) => r.materialId === 'mat-1')?.lastSupplier?.name).toBe(supplier.name);
    });

    it('books every line, shows the supplier on the movement, and can be reversed', async () => {
      const before = await api.get<Array<{ locationId: string; quantity: string }>>('/reports/current-stock?materialId=mat-1');
      const onHand = Number(before.find((s) => s.locationId === 'loc-1')?.quantity ?? 0);
      const receipt = await api.post<{ number: string; transactionIds: string[] }>('/stock-receipts', {
        supplierId: 'sup-1', deliveryRef: 'INV-77', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 12 }],
      });
      const after = await api.get<Array<{ locationId: string; quantity: string }>>('/reports/current-stock?materialId=mat-1');
      expect(Number(after.find((s) => s.locationId === 'loc-1')!.quantity)).toBe(onHand + 12);

      const history = await api.get<Array<{ id: string; deliveryRef?: string | null; supplierName?: string | null; receiptNumber?: string | null }>>('/inventory-transactions?materialId=mat-1');
      expect(history.find((t) => t.id === receipt.transactionIds[0])).toMatchObject({ deliveryRef: 'INV-77', receiptNumber: receipt.number });

      await api.post(`/inventory-transactions/${receipt.transactionIds[0]}/reversal`, { reason: 'Booked twice' });
      const reversed = await api.get<Array<{ locationId: string; quantity: string }>>('/reports/current-stock?materialId=mat-1');
      expect(Number(reversed.find((s) => s.locationId === 'loc-1')!.quantity)).toBe(onHand);
    });

    it('requires the invoice number and a known supplier', async () => {
      await expect(api.post('/stock-receipts', { supplierId: 'sup-1', deliveryRef: ' ', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 1 }] }))
        .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(api.post('/stock-receipts', { supplierId: 'nope', deliveryRef: 'X', lines: [{ materialId: 'mat-1', locationId: 'loc-1', quantity: 1 }] }))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('tools', () => {
    interface Tool { materialId: string; inStore: string; onLoan: string; owned: string; loans: Array<{ loanId: string; out: string; recipientName: string }> }
    const wrench = async () => (await api.get<Tool[]>('/tools')).find((t) => t.materialId === 'mat-12')!;
    const status = async () => (await api.get<Array<{ materialId: string; onHand: string; onLoan: string; status: string }>>('/reports/stock-status')).find((r) => r.materialId === 'mat-12')!;

    beforeEach(async () => {
      // Three torque wrenches (Required Stock 1) into the Main Storeroom.
      await api.post('/stock-receipts', { supplierId: 'sup-1', deliveryRef: 'T-1', lines: [{ materialId: 'mat-12', locationId: 'loc-1', quantity: 3 }] });
    });

    it('lends a tool off the shelf, still owned, and takes it back', async () => {
      await api.post('/tools/check-out', { recipientId: 'rcp-1', lines: [{ materialId: 'mat-12', locationId: 'loc-1', quantity: 2 }] });
      let t = await wrench();
      expect([t.inStore, t.onLoan, t.owned, t.loans[0]?.recipientName]).toEqual(['1', '2', '3', 'Sabelo']);
      expect(await status()).toMatchObject({ onHand: '1', onLoan: '2', status: 'OK' });
      await api.post('/tools/check-in', { lines: [{ loanId: t.loans[0]!.loanId, quantity: 2, condition: 'DAMAGED', note: 'Ratchet slips' }] });
      t = await wrench();
      expect([t.inStore, t.onLoan, t.loans]).toEqual(['3', '0', []]);
    });

    it('writes off a tool lost on loan, and refuses more back than is out', async () => {
      await api.post('/tools/check-out', { recipientId: 'rcp-1', lines: [{ materialId: 'mat-12', locationId: 'loc-1', quantity: 1 }] });
      const loanId = (await wrench()).loans[0]!.loanId;
      await expect(api.post('/tools/check-in', { lines: [{ loanId, quantity: 2, condition: 'GOOD' }] })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR', message: expect.stringContaining('only 1 still checked out'),
      });
      await expect(api.post('/tools/check-in', { lines: [{ loanId, quantity: 1, condition: 'LOST' }] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await api.post('/tools/check-in', { lines: [{ loanId, quantity: 1, condition: 'LOST', note: 'Left on site' }] });
      expect((await wrench()).owned).toBe('2');
      const writeOffs = await api.get<Array<{ reasonNote?: string }>>('/inventory-transactions?report=writeoffs');
      expect(writeOffs.some((movement) => movement.reasonNote === 'Lost while checked out to Sabelo: Left on site')).toBe(true);
    });

    it('refuses more than is in store, issuing a tool, and reversing a loan', async () => {
      await expect(api.post('/tools/check-out', { recipientId: 'rcp-1', lines: [{ materialId: 'mat-12', locationId: 'loc-1', quantity: 4 }] }))
        .rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
      await expect(issue('mat-12', 'loc-1', 1)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      const { loanIds } = await api.post<{ loanIds: string[] }>('/tools/check-out', { recipientId: 'rcp-1', lines: [{ materialId: 'mat-12', locationId: 'loc-1', quantity: 1 }] });
      await expect(api.post(`/inventory-transactions/${loanIds[0]}/reversal`, { reason: 'Wrong person' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    });
  });
});

describe('mock API: a location inside another', () => {
  beforeEach(() => resetMockState());

  it('changes nothing when an edit is refused, as the server', async () => {
    const store = await api.post<{ id: string }>('/locations', { name: 'Test room', type: 'STOREROOM' });
    await api.post('/locations', { name: 'Test rack', type: 'RACK', parentId: store.id });
    // Renaming the room while deactivating it is refused (its rack is active): the name stays.
    await expect(api.patch(`/locations/${store.id}`, { name: 'Renamed room', active: false })).rejects.toMatchObject({ code: 'CONFLICT' });
    const after = await api.get<{ name: string; active: boolean }>(`/locations/${store.id}`);
    expect(after).toMatchObject({ name: 'Test room', active: true });
  });

  it('keeps a rack inactive while its room is, and says to move locations out before deleting a room', async () => {
    const store = await api.post<{ id: string }>('/locations', { name: 'Test room', type: 'STOREROOM' });
    const rack = await api.post<{ id: string }>('/locations', { name: 'Test rack', type: 'RACK', parentId: store.id });
    await expect(api.del(`/locations/${store.id}`)).rejects.toMatchObject({ message: 'Test room has 1 location inside it. Move them out of it before deleting it.' });
    await api.patch(`/locations/${rack.id}/status`, { active: false });
    await api.patch(`/locations/${store.id}/status`, { active: false });
    await expect(api.patch(`/locations/${rack.id}/status`, { active: true })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
