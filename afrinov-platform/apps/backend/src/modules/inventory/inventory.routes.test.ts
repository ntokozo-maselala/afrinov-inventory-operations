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

const { mockedIssue, mockedTransfer, mockedAdjust, mockedQueryHistory, mockedReverse, mockedReturn } = vi.hoisted(() => ({
  mockedIssue: vi.fn(),
  mockedTransfer: vi.fn(),
  mockedAdjust: vi.fn(),
  mockedQueryHistory: vi.fn(),
  mockedReverse: vi.fn(),
  mockedReturn: vi.fn(),
}));

const { mockedReceive } = vi.hoisted(() => ({ mockedReceive: vi.fn() }));
vi.mock('./stock-receipt.service.js', () => ({ StockReceiptService: { receive: mockedReceive } }));

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
    reverse: mockedReverse,
    returnToStock: mockedReturn,
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
];

describe('inventory routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildServer({ skipConfigValidation: true });
    mockedIssue.mockResolvedValue({ transactionIds: ['tx-1'] });
    mockedTransfer.mockResolvedValue({ outTransactionId: 'tx-out-1', inTransactionId: 'tx-in-1' });
    mockedAdjust.mockResolvedValue({ transactionId: 'tx-1' });
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
      expect(mockedIssue).toHaveBeenCalledWith({ ...payload, actorId: 'user-admin' });
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
      expect(mockedReturn).toHaveBeenCalledWith({ issueTransactionId: 'tx-1', quantity: 3, locationId: OTHER_UUID, reason: 'Job done', actorId: 'user-admin' });
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
      expect(mockedReceive).toHaveBeenCalledWith({ ...receipt, receivedAt: '2026-10-01', actorId: 'user-store' });
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
      expect(res.json()).toEqual({ transactionId: 'tx-1' });
      expect(mockedAdjust).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'user-admin' }),
      );
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
      expect(mockedReverse).toHaveBeenCalledExactlyOnceWith({ transactionId: 'tx-1', reason, actorId: 'user-admin' });
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
      });
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
