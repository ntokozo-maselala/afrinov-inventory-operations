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
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { ApiError, Errors } from './errors.js';

/** The header a client sends to make a mutation retry-safe. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** How long a stored key is kept. A retry after a lost response happens within
 * minutes; a day is far longer than any real retry and bounds the table. */
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Endpoint scope: one key is unique per route, not shared across the API. */
export type IdempotencyEndpoint =
  | 'POST /inventory-issues'
  | 'POST /inventory-transfers'
  | 'POST /inventory-adjustments'
  | 'POST /stock-counts'
  | 'POST /stock-receipts'
  | 'POST /goods-receipts'
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

/** Read the idempotency key from a request header. */
export type IdempotencyKeyRead =
  | { present: false }
  | { present: true; valid: false }
  | { present: true; valid: true; key: string };

/**
 * Read the `Idempotency-Key` header, distinguishing three cases: absent (the
 * caller did not ask for retry safety), present-but-invalid (the caller asked
 * for it but the value cannot be stored), and valid. A present-but-invalid key
 * must never be treated as absent: the caller expects retry safety, and
 * silently running unkeyed would let a retry post a second movement.
 */
export function readIdempotencyKey(headers: Record<string, unknown>): IdempotencyKeyRead {
  const raw = headers[IDEMPOTENCY_HEADER];
  if (raw === undefined) return { present: false };
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return { present: true, valid: false };
  const key = value.trim();
  // Visible ASCII only, 1–200 characters: a UUID or any short opaque token
  // fits comfortably, while control characters and unbounded length do not.
  if (!/^[\x21-\x7e]{1,200}$/.test(key)) return { present: true, valid: false };
  return { present: true, valid: true, key };
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
 * The error code sent when a key is reused with a different request. Distinct
 * from a generic `CONFLICT` so the client can rotate its key and let the user
 * submit again, instead of being stuck on a permanent 409.
 */
export const IDEMPOTENCY_REUSE_CODE = 'IDEMPOTENCY_KEY_REUSED';

/** The transaction-scoped advisory lock key for one (actor, endpoint, key). */
function lockKey(actorId: string, endpoint: string, key: string): string {
  return `afrinov:idem:${actorId}|${endpoint}|${key}`;
}

/**
 * Run `operation` exactly once for a given (actor, endpoint, key).
 *
 * `operation` receives the transaction client and must do all of its writes —
 * including any balance recompute — through it, so the movement and the stored
 * key commit or roll back together.
 *
 * Concurrency: the lookup and the operation both run *inside* one transaction,
 * after taking a transaction-scoped advisory lock on the key. Two simultaneous
 * retries therefore serialise: the first runs the operation and stores the key;
 * the second blocks on the lock, re-reads, sees the stored row and replays it
 * without running the operation. This is what stops the loser of a race from
 * failing its own balance or state check (a 422 or an already-reversed 409)
 * before it could replay. The unique index remains as a last-resort safeguard.
 */
export async function withIdempotency(
  args: { actorId: string; endpoint: IdempotencyEndpoint; key: string; scope: string; requestBody: unknown },
  operation: (tx: Prisma.TransactionClient) => Promise<IdempotentResult>,
): Promise<IdempotentOutcome> {
  const { actorId, endpoint, key, scope, requestBody } = args;
  const requestHash = hashRequest(scope, requestBody);

  try {
    return await prisma.$transaction(async (tx) => {
      // Serialise concurrent requests that carry the same key. The lock is
      // released automatically when the transaction ends.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(actorId, endpoint, key)}))`;

      const existing = await tx.idempotencyKey.findUnique({
        where: { actorId_endpoint_key: { actorId, endpoint, key } },
        select: { requestHash: true, statusCode: true, response: true },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          // A distinct code (not a plain CONFLICT) so the client can tell a
          // reused key from a real business conflict, rotate its key and let
          // the user submit the new request instead of retrying the same 409.
          throw new ApiError(
            409,
            IDEMPOTENCY_REUSE_CODE,
            'This submission reused an earlier request\u2019s identifier with different details. Please submit it again.',
          );
        }
        return { replayed: true, statusCode: existing.statusCode, body: existing.response };
      }

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
      return { replayed: false, ...result };
    });
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
 * Delete stored keys older than the retention window, so the table does not
 * grow without bound. Safe to call on a schedule; returns the number removed.
 */
export async function pruneIdempotencyKeys(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - IDEMPOTENCY_RETENTION_MS);
  const { count } = await prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
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

/**
 * Run a mutating operation, making it retry-safe when the client sent an
 * `Idempotency-Key` header. With a key, the operation and the stored key commit
 * in one transaction, and a repeat replays the first response instead of
 * posting the movement again (TD-019). Without a key, the behaviour is exactly
 * as before: the operation opens and commits its own transaction.
 *
 * `run` receives the transaction to use (the idempotent one when a key was
 * sent, otherwise undefined, so the service opens its own) and returns the
 * status and body to send.
 */
export async function idempotentMutation(
  req: FastifyRequest,
  reply: FastifyReply,
  endpoint: IdempotencyEndpoint,
  run: (tx: Prisma.TransactionClient | undefined) => Promise<{ statusCode: number; body: unknown }>,
): Promise<FastifyReply> {
  const read = readIdempotencyKey(req.headers as Record<string, unknown>);
  if (!read.present) {
    const fresh = await run(undefined);
    return reply.code(fresh.statusCode).send(fresh.body);
  }
  if (!read.valid) {
    // The caller asked for retry safety but the key cannot be stored. Refusing
    // is safer than silently running unkeyed: a retry of an unkeyed write could
    // post the movement twice.
    throw Errors.validation('Idempotency-Key must be 1-200 printable ASCII characters');
  }
  const actorId = (req as unknown as { user: { id: string } }).user.id;
  const outcome = await withIdempotency(
    { actorId, endpoint, key: read.key, scope: req.url, requestBody: req.body },
    (tx) => run(tx),
  );
  return sendIdempotent(reply, outcome, outcome.replayed);
}
