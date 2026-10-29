// Idempotency for retry-safe mutations (TD-019, API principle 3).
//
// A mutating endpoint is safe to retry when a repeat with the same key does not
// post the movement a second time. The client mints an `Idempotency-Key` (a
// UUID) once per logical submission and reuses it across retries of that same
// submission.
//
// Flow:
//   1. Look the key up by (actor, endpoint, key).
//   2. Found, same body  -> replay the stored status and body, run nothing.
//      Found, other body -> 409: the key was reused for a different request.
//   3. Not found -> run the operation, then store its response. The unique
//      index on (actor, endpoint, key) makes the store the concurrency control:
//      if a simultaneous retry inserted first, this insert loses and the winner
//      is replayed instead of double-posting.
//
// The operation runs *inside* the same transaction that records the key, so a
// failure rolls back both the movement and the key: a genuine retry after a
// failed attempt is not mistaken for a duplicate.
import { createHash } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { Errors } from './errors.js';

/** The header a client sends to make a mutation retry-safe. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** Endpoint scope: one key is unique per route, not shared across the API. */
export type IdempotencyEndpoint =
  | 'POST /inventory-issues'
  | 'POST /inventory-transfers'
  | 'POST /inventory-adjustments'
  | 'POST /stock-counts'
  | 'POST /stock-receipts'
  | 'POST /inventory-returns'
  | 'POST /inventory-transactions/:id/returns'
  | 'POST /inventory-transactions/:id/reversal';

/**
 * Stable hash of the request, so a reused key with a different payload is
 * caught. `scope` carries the concrete path (with ids), which the endpoint
 * template deliberately omits: without it a key reused for two different
 * records under the same route would replay the first record's response.
 */
function hashRequest(scope: string, body: unknown): string {
  return createHash('sha256').update(`${scope}\n${JSON.stringify(body ?? null)}`).digest('hex');
}

/** Read the idempotency key from a request header, or null when absent. */
export function idempotencyKeyFrom(headers: Record<string, unknown>): string | null {
  const raw = headers[IDEMPOTENCY_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const key = value.trim();
  // Bound the length so a hostile client cannot bloat the index; a UUID or any
  // short opaque token fits comfortably.
  if (!key || key.length > 200) return null;
  return key;
}

/** What the callback returns: the status to send and the JSON body. */
export interface IdempotentResult {
  statusCode: number;
  body: unknown;
}

/** The outcome of an idempotent call: the response, and whether it was a replay. */
export interface IdempotentOutcome extends IdempotentResult {
  replayed: boolean;
}

/**
 * Run `operation` exactly once for a given (actor, endpoint, key).
 *
 * `operation` receives the transaction client and must do all of its writes —
 * including any balance recompute — through it, so the movement and the stored
 * key commit or roll back together.
 */
export async function withIdempotency(
  args: { actorId: string; endpoint: IdempotencyEndpoint; key: string; scope: string; requestBody: unknown },
  operation: (tx: Prisma.TransactionClient) => Promise<IdempotentResult>,
): Promise<IdempotentOutcome> {
  const { actorId, endpoint, key, scope, requestBody } = args;
  const requestHash = hashRequest(scope, requestBody);

  const existing = await prisma.idempotencyKey.findUnique({
    where: { actorId_endpoint_key: { actorId, endpoint, key } },
    select: { requestHash: true, statusCode: true, response: true },
  });
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw Errors.conflict(
        'This request reused an idempotency key with different details. Start the operation again.',
      );
    }
    return { replayed: true, statusCode: existing.statusCode, body: existing.response };
  }

  try {
    const fresh = await prisma.$transaction(async (tx) => {
      const result = await operation(tx);
      await tx.idempotencyKey.create({
        data: {
          actorId,
          endpoint,
          key,
          requestHash,
          statusCode: result.statusCode,
          response: (result.body ?? null) as Prisma.InputJsonValue,
        },
      });
      return result;
    });
    return { replayed: false, ...fresh };
  } catch (err) {
    // A concurrent retry inserted the same key first: this transaction rolled
    // back (so nothing was posted twice) and the winner's response is replayed.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await prisma.idempotencyKey.findUnique({
        where: { actorId_endpoint_key: { actorId, endpoint, key } },
        select: { requestHash: true, statusCode: true, response: true },
      });
      if (winner && winner.requestHash === requestHash) {
        return { replayed: true, statusCode: winner.statusCode, body: winner.response };
      }
    }
    throw err;
  }
}

/**
 * Apply an idempotency outcome to a reply. A replayed response carries the
 * `Idempotency-Replayed: true` header so a caller can tell a fresh result from
 * a replay without inspecting the body.
 */
export function sendIdempotent(reply: FastifyReply, result: IdempotentResult, replayed: boolean): FastifyReply {
  if (replayed) reply.header('Idempotency-Replayed', 'true');
  return reply.code(result.statusCode).send(result.body);
}
