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

const { mockedIssue, mockedTransfer, mockedAdjust, mockedQueryHistory, mockedReverse } = vi.hoisted(() => ({
  mockedIssue: vi.fn(),
  mockedTransfer: vi.fn(),
  mockedAdjust: vi.fn(),
  mockedQueryHistory: vi.fn(),
  mockedReverse: vi.fn(),
}));

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
  },
}));

const VALID_UUID = '00000000-0000-0000-0000-000000000001';
const OTHER_UUID = '00000000-0000-0000-0000-000000000002';

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
    mockedIssue.mockResolvedValue({ transactionId: 'tx-1' });
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

    it('returns 403 when the user lacks the issue:inventory permission', async () => {
      const headers = authed('user-tech', ['view:reports']);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory-issues',
        headers,
        payload: { materialId: VALID_UUID, locationId: OTHER_UUID, quantity: 1 },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 400 when the payload has an invalid UUID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory-issues',
        headers: authed(),
        payload: { materialId: 'not-a-uuid', locationId: OTHER_UUID, quantity: 1 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when quantity is not positive', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory-issues',
        headers: authed(),
        payload: { materialId: VALID_UUID, locationId: OTHER_UUID, quantity: -5 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when quantity is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory-issues',
        headers: authed(),
        payload: { materialId: VALID_UUID, locationId: OTHER_UUID },
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 201 and forwards the service result on valid input', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/inventory-issues',
        headers: authed(),
        payload: { materialId: VALID_UUID, locationId: OTHER_UUID, quantity: 3, projectNumber: 'AFRI-1325' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ transactionId: 'tx-1' });
      expect(mockedIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          materialId: VALID_UUID,
          locationId: OTHER_UUID,
          quantity: 3,
          actorId: 'user-admin',
          projectNumber: 'AFRI-1325',
        }),
      );
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
