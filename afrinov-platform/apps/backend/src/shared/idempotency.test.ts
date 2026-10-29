// Unit tests for the idempotency key reader and retention window.
//
// The database is mocked: these tests only exercise the pure header parsing and
// the retention constant, which decide whether a request is retry-safe.
import { describe, it, expect, vi } from 'vitest';

vi.mock('./db.js', () => ({ prisma: {} }));

const { readIdempotencyKey, IDEMPOTENCY_RETENTION_MS, IDEMPOTENCY_REUSE_CODE } = await import('./idempotency.js');

describe('readIdempotencyKey', () => {
  it('reports an absent header as absent', () => {
    expect(readIdempotencyKey({})).toEqual({ present: false });
  });

  it('accepts a UUID', () => {
    const sample = '123e4567-e89b-12d3-a456-426614174000';
    expect(readIdempotencyKey({ 'idempotency-key': sample })).toEqual({ present: true, valid: true, key: sample });
  });

  it('trims surrounding whitespace', () => {
    expect(readIdempotencyKey({ 'idempotency-key': '  abc  ' })).toEqual({ present: true, valid: true, key: 'abc' });
  });

  it('uses the first value when the header is repeated', () => {
    expect(readIdempotencyKey({ 'idempotency-key': ['one', 'two'] })).toEqual({ present: true, valid: true, key: 'one' });
  });

  it('rejects a blank key as present-but-invalid, never as absent', () => {
    expect(readIdempotencyKey({ 'idempotency-key': '   ' })).toEqual({ present: true, valid: false });
  });

  it('rejects a key over 200 characters', () => {
    expect(readIdempotencyKey({ 'idempotency-key': 'a'.repeat(201) })).toEqual({ present: true, valid: false });
  });

  it('accepts a key of exactly 200 characters', () => {
    const key = 'a'.repeat(200);
    expect(readIdempotencyKey({ 'idempotency-key': key })).toEqual({ present: true, valid: true, key });
  });

  it('rejects control characters', () => {
    expect(readIdempotencyKey({ 'idempotency-key': 'abc\ndef' })).toEqual({ present: true, valid: false });
  });

  it('rejects a non-string header value', () => {
    expect(readIdempotencyKey({ 'idempotency-key': 42 })).toEqual({ present: true, valid: false });
  });
});

describe('retention', () => {
  it('keeps keys for at least a day, longer than any real retry', () => {
    expect(IDEMPOTENCY_RETENTION_MS).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('exposes a stable reuse code the client can recognise', () => {
    expect(IDEMPOTENCY_REUSE_CODE).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('pruneIdempotencyKeys', () => {
  it('deletes only keys older than the retention window', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    vi.doMock('./db.js', () => ({ prisma: { idempotencyKey: { deleteMany } } }));
    vi.resetModules();
    const { pruneIdempotencyKeys, IDEMPOTENCY_RETENTION_MS: RETENTION } = await import('./idempotency.js');

    const now = new Date('2026-01-02T00:00:00.000Z');
    const removed = await pruneIdempotencyKeys(now);
    expect(removed).toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date(now.getTime() - RETENTION) } },
    });
  });
});
