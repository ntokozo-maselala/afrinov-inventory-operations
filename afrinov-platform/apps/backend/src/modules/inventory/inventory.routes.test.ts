// HTTP-level tests for the inventory-transaction routes.
//
// Covers the routing layer (zod validation, RBAC gates, 201 dispatch):
//   - 401 unauthenticated (no / malformed token)
//   - 403 authenticated but missing the required permission
//   - 400 zod validation failure (invalid UUID, non-positive quantity)
//   - 201 success with the InventoryService result forwarded
//   - GET /inventory-transactions returns the service result when authenticated
//
// The DB is mocked: `db.js` provides userRole.findMany for requirePermission,
// and `inventory.service.js` is fully mocked so no real DB is needed.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildServer } from '../../server.js';
import type { FastifyInstance } from 'fastify';

const userPermissions = new Map<string, string[]>();

const { mockedIssue, mockedTransfer, mockedAdjust, mockedQueryHistory, mockedReverse, mockedReturn, mockedReturnMany, mockedReturnable } = vi.hoisted(() => ({
  mockedReturnMany: vi.fn(),
  mockedReturnable: vi.fn(),
  mockedIssue: vi.fn(),
  mockedTransfer: vi.fn(),
  mockedAdjust: vi.fn(),
  mockedQueryHistory: vi.fn(),
  mockedReverse: vi.fn(),
  mockedReturn: vi.fn(),
}));

const { mockedReceive, mockedReceiptList, mockedCountList } = vi.hoisted(() => ({ mockedReceive: vi.fn(), mockedReceiptList: vi.fn(), mockedCountList: vi.fn() }));
const { mockedSummary, mockedActors, mockedCount, mockedSlips, mockedByResponsible } = vi.hoisted(() => ({
  mockedSummary: vi.fn(), mockedActors: vi.fn(), mockedCount: vi.fn(), mockedSlips: vi.fn(), mockedByResponsible: vi.fn(),
}));
vi.mock('./stock-receipt.service.js', () => ({ StockReceiptService: { receive: mockedReceive, list: mockedReceiptList } }));
vi.mock('./stock-count.service.js', () => ({ StockCountService: { list: mockedCountList } }));
// An adjustment goes through the write-off limit, which posts it or holds it for approval.
vi.mock('./write-off-approval.service.js', () => ({ WriteOffApprovalService: { adjustOrRequest: mockedAdjust } }));

vi.mock('../../shared/db.js', () => ({
  get prisma() {
    return {
      user: {
        findUnique: async () => ({ active: true }),
      },
      userRole: {
        findMany: async ({ where }: { where: { userId: string } }) => {
          const codes = userPermissions.get(where.userId) ?? [];
          return [{ role: { permissions: codes.map((c) => ({ permission: { code: c } })) } }];
        },
      },
    };
  },
}));

vi.mock('./inventory.service.js', () => ({
  InventoryService: {
    issue: mockedIssue,
    transfer: mockedTransfer,
    adjust: mockedAdjust,
    queryHistory: mockedQueryHistory,
    historySummary: mockedSummary,
    historyActors: mockedActors,
    historyCount: mockedCount,
    writeoffsByResponsible: mockedByResponsible,
    issueSlips: mockedSlips,
    reverse: mockedReverse,
    returnToStock: mockedReturn,
    returnMany: mockedReturnMany,
    returnable: mockedReturnable,
  },
}));

const VALID_UUID = '00000000-0000-0000-0000-000000000001';
const OTHER_UUID = '00000000-0000-0000-0000-000000000002';
const RECIPIENT_UUID = '00000000-0000-0000-0000-000000000003';

const ALL_INVENTORY_PERMS = [
  'issue:inventory',
  'transfer:inventory',
  'adjust:inventory',
  'reverse:inventory_transaction',
  // The ledger is a report (system audit F6).
  'view:reports',
];

describe('inventory routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // Counter receipts are taken only while procurement is off.
    app = await buildServer({ skipConfigValidation: true, procurementEnabled: false });
    mockedIssue.mockResolvedValue({ transactionIds: ['tx-1'] });
    mockedTransfer.mockResolvedValue({ outTransactionId: 'tx-out-1', inTransactionId: 'tx-in-1' });
    mockedAdjust.mockResolvedValue({ status: 'POSTED', transactionId: 'tx-1' });
    mockedQueryHistory.mockResolvedValue([]);
    mockedReverse.mockResolvedValue({ reversalIds: ['tx-rev-1'] });
  });

  afterEach(async () => {
    await app.close();
    userPermissions.clear();
    vi.clearAllMocks();
  });

    function sign(userId: string, roles: string[] = ['ADMIN']) {
      return app.jwt.sign({ sub: userId, email: `${userId}@afrinov.local`, name: 'Test', roles });
    }

  function authed(userId = 'user-admin', perms: string[] = ALL_INVENTORY_PERMS) {
    userPermissions.set(userId, perms);
    return { authorization: `Bearer ${sign(userId)}` };
  }

  // System audit F6: the ledger needs view:reports, and who lost what more.
  describe('reading the ledger', () => {
    it('needs view:reports, and adjust or approve rights for write-offs by person', async () => {
      const reader = authed('user-reader', ['view:reports']);
      expect((await app.inject({ method: 'GET', url: '/api/v1/inventory-transactions', headers: authed('user-none', []) })).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: '/api/v1/inventory-transactions/writeoffs-by-responsible', headers: reader })).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: '/api/v1/inventory-transactions/writeoffs-by-responsible', headers: authed('user-approver', ['view:reports', 'approve:write_off']) })).statusCode).not.toBe(403);
    });
  });

  describe('POST /api/v1/inventory-issues', () => {
    it('returns 401 when no Authorization header is supplied', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/inventory-issues' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    });

    it('returns 401 for a malformed token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory-issues',
        headers: { authorization: 'Bearer not-a-jwt' },
      });
      expect(res.statusCode).toBe(401);
    });

    function issueBody(overrides: Record<string, unknown> = {}, line: Record<string, unknown> = {}) {
      return {
        recipientId: RECIPIENT_UUID,
        lines: [{ materialId: VALID_UUID, locationId: OTHER_UUID, quantity: 1, ...line }],
        ...overrides,
      };
    }

    it('returns 403 when the user lacks the issue:inventory permission', async () => {
      const headers = authed('user-tech', ['view:reports']);
      const res = await app.inject({ method: 'POST', url: '/api/v1/inventory-issues', headers, payload: issueBody() });
      expect(res.statusCode).toBe(403);
    });

    it.each([
      ['the recipient is missing', issueBody({ recipientId: undefined })],
      ['there are no lines', issueBody({ lines: [] })],
      ['a line has an invalid UUID', issueBody({}, { materialId: 'not-a-uuid' })],
      ['a quantity is not positive', issueBody({}, { quantity: -5 })],
      ['a quantity is missing', issueBody({}, { quantity: undefined })],
      ['there are more than 50 lines', issueBody({ lines: Array.from({ length: 51 }, () => ({ materialId: VALID_UUID, locationId: OTHER_UUID, quantity: 1 })) })],
    ])('returns 400 when %s', async (_case, payload) => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/inventory-issues', headers: authed(), payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
      expect(mockedIssue).not.toHaveBeenCalled();
    });

    it('returns 201 and forwards every line with the recipient, project and caller', async () => {
      const payload = {
        recipientId: RECIPIENT_UUID,
        projectNumber: 'AFRI-1325',
        lines: [
          { materialId: VALID_UUID, locationId: OTHER_UUID, quantity: 3 },
          { materialId: OTHER_UUID, locationId: VALID_UUID, quantity: 1.5 },
        ],
      };
      const res = await app.inject({ method: 'POST', url: '/api/v1/inventory-issues', headers: authed(), payload });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ transactionIds: ['tx-1'] });
      expect(mockedIssue).toHaveBeenCalledWith({ ...payload, actorId: 'user-admin' }, undefined);
    });
  });

  describe('POST /api/v1/inventory-transactions/:id/returns', () => {
    it('returns 403 without the issue:inventory permission', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/inventory-transactions/tx-1/returns', headers: authed('user-viewer', ['view:reports']), payload: { quantity: 1 } });
      expect(res.statusCode).toBe(403);
    });

    it.each([
      ['the quantity is missing', {}],
      ['the quantity is not positive', { quantity: 0 }],
      ['the location is not a UUID', { quantity: 1, locationId: 'A-1' }],
    ])('returns 400 when %s', async (_case, payload) => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/inventory-transactions/tx-1/returns', headers: authed(), payload });
      expect(res.statusCode).toBe(400);
      expect(mockedReturn).not.toHaveBeenCalled();
    });

    it('returns 201 and passes the issue, quantity, location and reason through', async () => {
      mockedReturn.mockResolvedValue({ transactionId: 'tx-r1', returnedQuantity: '3', returnableQuantity: '7' });
      const res = await app.inject({
        method: 'POST', url: '/api/v1/inventory-transactions/tx-1/returns', headers: authed(),
        payload: { quantity: 3, locationId: OTHER_UUID, reason: ' Job done ' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ transactionId: 'tx-r1', returnedQuantity: '3', returnableQuantity: '7' });
      expect(mockedReturn).toHaveBeenCalledWith({ issueTransactionId: 'tx-1', quantity: 3, locationId: OTHER_UUID, reason: 'Job done', actorId: 'user-admin' }, undefined);
    });
  });

  describe('POST /api/v1/inventory-returns', () => {
    const body = { lines: [{ issueTransactionId: 'tx-1', quantity: 3 }, { issueTransactionId: 'tx-2', quantity: 1, locationId: OTHER_UUID }], reason: ' Job done ' };

    it('returns 403 without the issue:inventory permission', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/inventory-returns', headers: authed('user-viewer', ['view:reports']), payload: body });
      expect(res.statusCode).toBe(403);
      expect(mockedReturnMany).not.toHaveBeenCalled();
    });

    it.each([
      ['there are no lines', { lines: [] }],
      ['a quantity is not positive', { lines: [{ issueTransactionId: 'tx-1', quantity: 0 }] }],
      ['a line has no issue', { lines: [{ quantity: 1 }] }],
      ['a location is not a UUID', { lines: [{ issueTransactionId: 'tx-1', quantity: 1, locationId: 'A-1' }] }],
    ])('returns 400 when %s', async (_case, payload) => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/inventory-returns', headers: authed(), payload });
      expect(res.statusCode).toBe(400);
      expect(mockedReturnMany).not.toHaveBeenCalled();
    });

    it('returns 201 and passes every line, the note and the actor through', async () => {
      mockedReturnMany.mockResolvedValue({ transactionIds: ['tx-r1', 'tx-r2'] });
      const res = await app.inject({ method: 'POST', url: '/api/v1/inventory-returns', headers: authed(), payload: body });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ transactionIds: ['tx-r1', 'tx-r2'] });
      expect(mockedReturnMany).toHaveBeenCalledWith({ ...body, reason: 'Job done', actorId: 'user-admin' }, undefined);
    });
  });

  describe('GET /api/v1/inventory-returns/returnable', () => {
    it('needs view:reports', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/inventory-returns/returnable?recipientId=${RECIPIENT_UUID}`, headers: authed('user-x', ['issue:inventory']) });
      expect(res.statusCode).toBe(403);
    });

    it('returns 400 without a recipient', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/inventory-returns/returnable', headers: authed('user-v', ['view:reports']) });
      expect(res.statusCode).toBe(400);
      expect(mockedReturnable).not.toHaveBeenCalled();
    });

    it('passes the recipient and period through', async () => {
      mockedReturnable.mockResolvedValue([]);
      const res = await app.inject({ method: 'GET', url: `/api/v1/inventory-returns/returnable?recipientId=${RECIPIENT_UUID}&from=2026-09-16&to=2026-10-16`, headers: authed('user-v', ['view:reports']) });
      expect(res.statusCode).toBe(200);
      expect(mockedReturnable).toHaveBeenCalledWith({ recipientId: RECIPIENT_UUID, from: '2026-09-16', to: '2026-10-16' });
    });
  });

  describe('POST /api/v1/stock-receipts', () => {
    const receipt = {
      supplierId: VALID_UUID,
      deliveryRef: 'INV-2041',
      lines: [{ materialId: VALID_UUID, locationId: OTHER_UUID, quantity: 20 }],
    };

    it('returns 403 without the receive:inventory permission', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/stock-receipts', headers: authed('user-tech', ['issue:inventory']), payload: receipt });
      expect(res.statusCode).toBe(403);
    });

    it.each([
      ['the supplier is missing', { ...receipt, supplierId: undefined }],
      ['the delivery/invoice number is blank', { ...receipt, deliveryRef: '  ' }],
      ['there are no lines', { ...receipt, lines: [] }],
      ['a quantity is not positive', { ...receipt, lines: [{ materialId: VALID_UUID, locationId: OTHER_UUID, quantity: 0 }] }],
    ])('returns 400 when %s', async (_case, payload) => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/stock-receipts', headers: authed('user-store', ['receive:inventory']), payload });
      expect(res.statusCode).toBe(400);
      expect(mockedReceive).not.toHaveBeenCalled();
    });

    it('accepts a supplier id that is not a UUID, like the demo suppliers from the seed', async () => {
      mockedReceive.mockResolvedValue({ goodsReceiptId: 'gr-1', number: 'GR-2026-0001', transactionIds: ['t-1'] });
      const res = await app.inject({ method: 'POST', url: '/api/v1/stock-receipts', headers: authed('user-store', ['receive:inventory']), payload: { ...receipt, supplierId: 'seed-sup-hydroscand' } });
      expect(res.statusCode).toBe(201);
    });

    it('returns 201 and records the caller as the receiver', async () => {
      mockedReceive.mockResolvedValue({ goodsReceiptId: 'gr-1', number: 'GR-2026-0001', transactionIds: ['t-1'] });
      const res = await app.inject({ method: 'POST', url: '/api/v1/stock-receipts', headers: authed('user-store', ['receive:inventory']), payload: { ...receipt, receivedAt: '2026-10-01' } });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ goodsReceiptId: 'gr-1', number: 'GR-2026-0001', transactionIds: ['t-1'] });
      expect(mockedReceive).toHaveBeenCalledWith({ ...receipt, receivedAt: '2026-10-01', actorId: 'user-store' }, undefined);
    });

    it('refuses a receipt with no order while procurement is on', async () => {
      const withOrders = await buildServer({ skipConfigValidation: true, procurementEnabled: true });
      try {
        const res = await withOrders.inject({ method: 'POST', url: '/api/v1/stock-receipts', headers: authed('user-store', ['receive:inventory']), payload: receipt });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.message).toMatch(/booked against an approved Stores order/);
        expect(mockedReceive).not.toHaveBeenCalled();
      } finally {
        await withOrders.close();
      }
    });
  });

  describe('POST /api/v1/inventory-transfers', () => {
    it('returns 403 when the user lacks the transfer permission', async () => {
      const headers = authed('user-store', ['issue:inventory']);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory-transfers',
        headers,
        payload: { materialId: VALID_UUID, fromLocationId: VALID_UUID, toLocationId: OTHER_UUID, quantity: 1 },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 400 when quantity is not positive', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory-transfers',
        headers: authed(),
        payload: { materialId: VALID_UUID, fromLocationId: VALID_UUID, toLocationId: OTHER_UUID, quantity: 0 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 201 and forwards both transaction ids on valid input', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory-transfers',
        headers: authed(),
        payload: { materialId: VALID_UUID, fromLocationId: VALID_UUID, toLocationId: OTHER_UUID, quantity: 2 },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ outTransactionId: 'tx-out-1', inTransactionId: 'tx-in-1' });
      expect(mockedTransfer).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'user-admin' }),
        undefined,
      );
    });
  });

  describe('POST /api/v1/inventory-adjustments', () => {
    it('returns 400 when reasonCode is not a valid enum value', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory-adjustments',
        headers: authed(),
        payload: { materialId: VALID_UUID, locationId: OTHER_UUID, quantity: 5, reasonCode: 'BOGUS' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when quantity is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory-adjustments',
        headers: authed(),
        payload: { materialId: VALID_UUID, locationId: OTHER_UUID, reasonCode: 'DAMAGE' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 201 and forwards the service result on valid input', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory-adjustments',
        headers: authed(),
        payload: { materialId: VALID_UUID, locationId: OTHER_UUID, quantity: 5, reasonCode: 'COUNT_VARIANCE' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ status: 'POSTED', transactionId: 'tx-1' });
      expect(mockedAdjust).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'user-admin' }),
        undefined,
      );
    });

    it('forwards who was responsible, or null for nobody known', async () => {
      for (const recipientId of [RECIPIENT_UUID, null]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/inventory-adjustments',
          headers: authed(),
          payload: { materialId: VALID_UUID, locationId: OTHER_UUID, quantity: -1, reasonCode: 'DAMAGE', reasonNote: 'Dropped', recipientId },
        });
        expect(res.statusCode).toBe(201);
        expect(mockedAdjust).toHaveBeenLastCalledWith(expect.objectContaining({ recipientId }), undefined);
      }
    });

    // Worth more than the write-off limit: held for someone else's approval, nothing posted yet.
    it('returns 202 when the adjustment waits for approval', async () => {
      mockedAdjust.mockResolvedValueOnce({ status: 'PENDING_APPROVAL', requestId: 'req-1', value: '2500.00', limit: '1000.00' });
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory-adjustments',
        headers: authed(),
        payload: { materialId: VALID_UUID, locationId: OTHER_UUID, quantity: -10, reasonCode: 'LOSS', reasonNote: 'Missing from the shelf' },
      });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ status: 'PENDING_APPROVAL', requestId: 'req-1', value: '2500.00', limit: '1000.00' });
    });

    it('returns 400 when recipientId is not an id', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory-adjustments',
        headers: authed(),
        payload: { materialId: VALID_UUID, locationId: OTHER_UUID, quantity: -1, reasonCode: 'LOSS', recipientId: 'Sabelo' },
      });
      expect(res.statusCode).toBe(400);
      expect(mockedAdjust).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/inventory-transactions/writeoffs-by-responsible', () => {
    it('returns 401 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/inventory-transactions/writeoffs-by-responsible' });
      expect(res.statusCode).toBe(401);
    });

    it('returns the totals for the filters', async () => {
      const totals = { currency: 'ZAR', totals: [{ recipientId: RECIPIENT_UUID, recipientName: 'Sabelo', recipientType: 'WORKER', count: 2, value: '64.00' }] };
      mockedByResponsible.mockResolvedValue(totals);
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/inventory-transactions/writeoffs-by-responsible?from=2026-10-01&to=2026-10-31&locationId=${VALID_UUID}`,
        headers: authed(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(totals);
      expect(mockedByResponsible).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-10-01', to: '2026-10-31', locationId: VALID_UUID }));
    });
  });

  describe('GET /api/v1/inventory-transactions', () => {
    it('returns 401 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/inventory-transactions' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 200 and the service result when authenticated', async () => {
      const fakeData = [{ id: 'tx-1', materialSku: 'M16X40', quantity: '5', type: 'ISSUE' }];
      mockedQueryHistory.mockResolvedValue(fakeData);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/inventory-transactions',
        headers: authed(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(fakeData);
    });

    it('forwards query parameters to the service', async () => {
      await app.inject({
        method: 'GET',
        url: '/api/v1/inventory-transactions?materialId=abc&type=ISSUE&limit=50',
        headers: authed(),
      });
      expect(mockedQueryHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          materialId: 'abc',
          type: 'ISSUE',
          limit: 50,
        }),
      );
    });
  });

  describe('GET /api/v1/inventory-transactions filters, totals and download', () => {
    it('forwards the date range, location, user, search and paging cursor', async () => {
      mockedQueryHistory.mockResolvedValue([]);
      await app.inject({
        method: 'GET',
        url: `/api/v1/inventory-transactions?from=2026-10-01&to=2026-10-31&locationId=${VALID_UUID}&actorId=user-1&q=disc&before=c1&limit=100`,
        headers: authed(),
      });
      expect(mockedQueryHistory).toHaveBeenCalledWith(expect.objectContaining({
        from: '2026-10-01', to: '2026-10-31', locationId: VALID_UUID, actorId: 'user-1', q: 'disc', before: 'c1', limit: 100,
      }));
    });

    it('returns the totals for the same filters, without paging', async () => {
      mockedSummary.mockResolvedValue({ total: 3, byType: { ISSUE: 2, RECEIPT: 1 } });
      const res = await app.inject({ method: 'GET', url: '/api/v1/inventory-transactions/summary?from=2026-10-01&type=ISSUE&before=c1', headers: authed() });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ total: 3, byType: { ISSUE: 2, RECEIPT: 1 } });
      expect(mockedSummary).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-10-01', type: 'ISSUE' }));
      expect(mockedSummary.mock.calls[0]![0]).not.toHaveProperty('before');
    });

    it('lists who has posted movements', async () => {
      mockedActors.mockResolvedValue([{ id: 'u-1', name: 'Vusi' }]);
      const res = await app.inject({ method: 'GET', url: '/api/v1/inventory-transactions/actors', headers: authed() });
      expect(res.json()).toEqual([{ id: 'u-1', name: 'Vusi' }]);
    });

    it('downloads the filtered movements as an Excel file', async () => {
      mockedCount.mockResolvedValue(1);
      mockedQueryHistory.mockResolvedValue([{
        id: 'tx-1', cursor: 'c', postedAt: '2026-10-05T08:00:00.000Z', type: 'ISSUE', materialId: 'm', materialSku: 'DISC-115', materialName: 'Cutting disc',
        unitOfMeasure: 'each', locationId: 'l', locationName: 'Boiler Shop', quantity: '-3', actorId: 'u', actorName: 'Vusi', recipientName: 'Sabelo',
        projectNumber: null, reasonCode: null, reasonNote: null, referenceType: null, reversesId: null, reversedById: null, receiptNumber: null,
      }]);
      const res = await app.inject({ method: 'GET', url: '/api/v1/inventory-transactions/export?from=2026-10-01&to=2026-10-31', headers: authed() });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('afrinov-movements-2026-10-01-to-2026-10-31.xlsx');
      expect(res.rawPayload.subarray(0, 2).toString()).toBe('PK');
    });

    it('refuses a download wider than the row limit, with a message to narrow it', async () => {
      mockedCount.mockResolvedValue(10_001);
      const res = await app.inject({ method: 'GET', url: '/api/v1/inventory-transactions/export', headers: authed() });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toMatch(/shorter date range/);
      expect(mockedQueryHistory).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/stock-receipts and /api/v1/stock-counts (Movements reports)', () => {
    it('need the view:reports permission', async () => {
      for (const url of ['/api/v1/stock-receipts', '/api/v1/stock-counts', '/api/v1/inventory-issues']) {
        expect((await app.inject({ method: 'GET', url, headers: authed('user-none', []) })).statusCode, url).toBe(403);
      }
      expect(mockedReceiptList).not.toHaveBeenCalled();
      expect(mockedCountList).not.toHaveBeenCalled();
      expect(mockedSlips).not.toHaveBeenCalled();
    });

    it('passes the day, filters and paging to the issue slips', async () => {
      mockedSlips.mockResolvedValue([]);
      await app.inject({ method: 'GET', url: '/api/v1/inventory-issues?from=2026-09-25&locationId=l-1&actorId=u-1&materialId=m-1&q=sabelo&before=c&limit=20', headers: authed('user-v', ['view:reports']) });
      expect(mockedSlips).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-09-25', locationId: 'l-1', actorId: 'u-1', materialId: 'm-1', q: 'sabelo', before: 'c', limit: 20 }));
    });

    it('pass the day, filters and paging to the services', async () => {
      mockedReceiptList.mockResolvedValue([]);
      mockedCountList.mockResolvedValue([]);
      await app.inject({ method: 'GET', url: '/api/v1/stock-receipts?from=2026-09-25&supplierId=s-1&locationId=l-1&q=inv&before=c&limit=10', headers: authed('user-v', ['view:reports']) });
      expect(mockedReceiptList).toHaveBeenCalledWith({ from: '2026-09-25', to: undefined, supplierId: 's-1', locationId: 'l-1', q: 'inv', before: 'c', limit: 10 });
      await app.inject({ method: 'GET', url: '/api/v1/stock-counts?from=2026-09-25&to=2026-09-30&locationId=l-1&actorId=u-1', headers: authed('user-v', ['view:reports']) });
      expect(mockedCountList).toHaveBeenCalledWith({ from: '2026-09-25', to: '2026-09-30', locationId: 'l-1', actorId: 'u-1', before: undefined, limit: undefined });
    });

    it('passes a report kind to the movement history, ignoring an unknown one', async () => {
      mockedQueryHistory.mockResolvedValue([]);
      await app.inject({ method: 'GET', url: '/api/v1/inventory-transactions?report=writeoffs', headers: authed() });
      expect(mockedQueryHistory).toHaveBeenLastCalledWith(expect.objectContaining({ report: 'writeoffs' }));
      await app.inject({ method: 'GET', url: '/api/v1/inventory-transactions?report=everything', headers: authed() });
      expect(mockedQueryHistory).toHaveBeenLastCalledWith(expect.objectContaining({ report: undefined }));
    });
  });

  describe('POST /api/v1/inventory-transactions/:id/reversal', () => {
    it.each([null, 42, true, 'ab', '  ab  ', 'x'.repeat(501)])('rejects invalid reason %j before calling the service', async (reason) => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/inventory-transactions/tx-1/reversal',
        headers: authed(), payload: { reason },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
      expect(mockedReverse).not.toHaveBeenCalled();
    });

    it.each([3, 500])('accepts a trimmed reason of %i characters and ignores a spoofed actor', async (length) => {
      const reason = 'x'.repeat(length);
      const res = await app.inject({
        method: 'POST', url: '/api/v1/inventory-transactions/tx-1/reversal', headers: authed(),
        payload: { reason: `  ${reason}  `, actorId: 'someone-else' },
      });
      expect(res.statusCode).toBe(201);
      expect(mockedReverse).toHaveBeenCalledExactlyOnceWith({ transactionId: 'tx-1', reason, actorId: 'user-admin' }, undefined);
    });

    it('does not accept the retired update permission as authorization to reverse', async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/inventory-transactions/tx-1/reversal',
        headers: authed('legacy-user', ['update:inventory_transaction']), payload: { reason: 'Wrong item' },
      });
      expect(res.statusCode).toBe(403);
      expect(mockedReverse).not.toHaveBeenCalled();
    });

    it.each(['INVALID_STATE', 'INSUFFICIENT_BALANCE'] as const)('preserves %s errors from the service', async (code) => {
      const { Errors } = await import('../../shared/errors.js');
      const error = code === 'INVALID_STATE'
        ? Errors.invalidState('Goods receipt stock cannot be reversed')
        : Errors.insufficientBalance('Stock was already used', { available: '0' });
      mockedReverse.mockRejectedValueOnce(error);
      const res = await app.inject({
        method: 'POST', url: '/api/v1/inventory-transactions/tx-1/reversal',
        headers: authed(), payload: { reason: 'Wrong item' },
      });
      expect(res.statusCode).toBe(error.statusCode);
      expect(res.json().error).toMatchObject({ code, message: error.message });
      if (error.details) expect(res.json().error.details).toEqual(error.details);
    });

    it('returns 401 without auth', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/inventory-transactions/tx-1/reversal' });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when the user lacks the reverse permission', async () => {
      const headers = authed('user-viewer', ['view:reports']);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory-transactions/tx-1/reversal',
        headers,
        payload: { reason: 'Wrong item' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 400 when the reason is missing or blank', async () => {
      for (const payload of [{}, { reason: '  ' }]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/inventory-transactions/tx-1/reversal',
          headers: authed(),
          payload,
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('VALIDATION_ERROR');
      }
      expect(mockedReverse).not.toHaveBeenCalled();
    });

    it('returns 404 when the service throws a not-found error', async () => {
      const { Errors } = await import('../../shared/errors.js');
      mockedReverse.mockRejectedValueOnce(Errors.notFound('InventoryTransaction'));
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory-transactions/tx-1/reversal',
        headers: authed(),
        payload: { reason: 'Wrong item' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('returns 409 when the movement was already reversed', async () => {
      const { Errors } = await import('../../shared/errors.js');
      mockedReverse.mockRejectedValueOnce(Errors.conflict('This movement has already been reversed.'));
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory-transactions/tx-1/reversal',
        headers: authed(),
        payload: { reason: 'Wrong item' },
      });
      expect(res.statusCode).toBe(409);
    });

    it('returns 201 with the reversal ids, recording the caller as the actor', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory-transactions/tx-1/reversal',
        headers: authed(),
        payload: { reason: '  Wrong item  ' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ reversalIds: ['tx-rev-1'] });
      expect(mockedReverse).toHaveBeenCalledWith({
        transactionId: 'tx-1',
        reason: 'Wrong item',
        actorId: 'user-admin',
      }, undefined);
    });
  });

  it('no longer accepts edits to a posted transaction', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/inventory-transactions/tx-1',
      headers: authed(),
      payload: { actorId: OTHER_UUID },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('the stock count body', () => {
  const line = (expectedQuantity: number, countedQuantity: number) => ({
    locationId: '11111111-1111-4111-8111-111111111111',
    lines: [{ materialId: '22222222-2222-4222-8222-222222222222', expectedQuantity, countedQuantity }],
  });

  // A balance below zero comes from a booking mistake; the count screen flags it, and
  // counting it is how it is put right, so what the system shows may be negative.
  it('takes a system quantity below zero, but never a counted one', async () => {
    const { stockCountSchema } = await import('./inventory.routes.js');
    expect(stockCountSchema.safeParse(line(-4, 0)).success).toBe(true);
    expect(stockCountSchema.safeParse(line(4, -1)).success).toBe(false);
  });

  it('refuses a figure finer than the 4 decimal places it is stored to', async () => {
    const { stockCountSchema } = await import('./inventory.routes.js');
    expect(stockCountSchema.safeParse(line(5, 5.0001)).success).toBe(true);
    expect(stockCountSchema.safeParse(line(5, 5.00006)).success).toBe(false);
    expect(stockCountSchema.safeParse(line(5.00006, 5)).success).toBe(false);
  });
});

// The quantity columns are Decimal(18, 4): a finer quantity would be stored
// rounded, so 0.00001 would post a zero movement, and a huge one would not fit.
describe('quantities on stock movements', () => {
  const ids = { a: '11111111-1111-4111-8111-111111111111', b: '22222222-2222-4222-8222-222222222222', c: '33333333-3333-4333-8333-333333333333' };

  it('are refused past 4 decimal places or beyond the column, on every movement', async () => {
    const { issueSchema, transferSchema, adjustmentSchema, stockReceiptSchema } = await import('./inventory.routes.js');
    const { toolCheckOutSchema, toolCheckInSchema } = await import('./tool.routes.js');
    const bodies = {
      issue: (quantity: number) => issueSchema.safeParse({ recipientId: ids.a, lines: [{ materialId: ids.b, locationId: ids.c, quantity }] }),
      transfer: (quantity: number) => transferSchema.safeParse({ materialId: ids.a, fromLocationId: ids.b, toLocationId: ids.c, quantity }),
      adjustment: (quantity: number) => adjustmentSchema.safeParse({ materialId: ids.a, locationId: ids.b, quantity, reasonCode: 'LOSS' }),
      receipt: (quantity: number) => stockReceiptSchema.safeParse({ supplierId: 's', deliveryRef: 'DN 1', lines: [{ materialId: ids.a, locationId: ids.b, quantity }] }),
      checkOut: (quantity: number) => toolCheckOutSchema.safeParse({ recipientId: ids.a, lines: [{ materialId: ids.b, locationId: ids.c, quantity }] }),
      checkIn: (quantity: number) => toolCheckInSchema.safeParse({ lines: [{ loanId: ids.a, quantity, condition: 'GOOD' }] }),
    };
    for (const [name, parse] of Object.entries(bodies)) {
      expect(parse(1.2345).success, `${name} 1.2345`).toBe(true);
      expect(parse(0.00001).success, `${name} 0.00001`).toBe(false);
      expect(parse(1e15).success, `${name} 1e15`).toBe(false);
    }
    // An adjustment takes stock away as a negative quantity, kept to the same places.
    expect(bodies.adjustment(-2.5).success).toBe(true);
    expect(bodies.adjustment(-0.00004).success).toBe(false);
  });
});
