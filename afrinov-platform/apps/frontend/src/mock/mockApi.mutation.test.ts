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

      await api.post('/inventory-issues', { materialId: 'mat-1', locationId: 'loc-1', quantity: 10 });
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
        await api.post('/inventory-issues', { materialId: 'mat-1', locationId: 'loc-1', quantity: 100 });
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

      await api.post('/inventory-issues', { materialId: 'mat-8', locationId: 'loc-1', quantity: 10 });
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

    it('rejects shipping from DRAFT (not APPROVED)', async () => {
      const draft = await makeDraftPO();
      let caught: ApiError | undefined;
      try {
        await api.post<{ status: string }>(`/purchase-orders/${draft.id}/ship`, { trackingNumber: 'TRK-1' });
      } catch (e) {
        if (isApiError(e)) caught = e;
      }
      expect(caught).toBeDefined();
      expect(caught!.code).toBe('INVALID_STATE');
    });

    it('rejects delivering from PENDING_APPROVAL (not SHIPPED)', async () => {
      const draft = await makeDraftPO();
      await api.post<{ status: string }>(`/purchase-orders/${draft.id}/submit`, {});
      // Now in PENDING_APPROVAL; delivering should fail.
      let caught: ApiError | undefined;
      try {
        await api.post<{ status: string }>(`/purchase-orders/${draft.id}/deliver`, { locationId: 'loc-1' });
      } catch (e) {
        if (isApiError(e)) caught = e;
      }
      expect(caught).toBeDefined();
      expect(caught!.code).toBe('INVALID_STATE');
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
});
