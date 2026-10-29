// Transaction helper shared by the mutating services.
//
// Kept in its own module (rather than `db.ts`) so the many unit tests that mock
// `shared/db.js` to supply a fake Prisma client do not also have to mock this:
// the helper calls whatever `prisma.$transaction` the caller's mock provides.
import type { Prisma } from '@prisma/client';
import { prisma } from './db.js';

/**
 * Run `body` in the caller's transaction when one was passed (a retry-safe
 * route already opened it, so the movement and the stored idempotency key
 * commit together), otherwise open a new one. Mutating services take an
 * optional `within` and route through here, so a retry-safe caller never nests
 * a second transaction around the write.
 */
export function inTx<T>(
  within: Prisma.TransactionClient | undefined,
  body: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return within ? body(within) : prisma.$transaction(body);
}
