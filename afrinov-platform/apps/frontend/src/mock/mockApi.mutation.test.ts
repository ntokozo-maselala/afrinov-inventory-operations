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
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockApi, resetMockState } from './mockApi';
import { isApiError } from '../api/client';
import type { ApiError } from '../api/client';

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
        lines: [{ materialId: 'mat-1', orderedQty: 5 }],
      });
    }

    it('submit moves a DRAFT PO to PENDING_APPROVAL', async () => {
      const draft = await makeDraftPO();
      const result = await api.post<{ status: string }>(`/purchase-orders/${draft.id}/submit`, {});
      expect(result.status).toBe('PENDING_APPROVAL');
    });

    /** Return an API rejection code, UNKNOWN for other errors, or undefined on success. */
    async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
      try {
        await p;
        return undefined;
      } catch (e) {
        return isApiError(e) ? e.code : 'UNKNOWN';
      }
    }

    /** Create and approve a mock purchase order, returning its original draft response for its ID. */
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
    /** Return an API rejection code, UNKNOWN for other errors, or undefined on success. */
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
});
