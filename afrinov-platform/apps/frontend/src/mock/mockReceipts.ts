// Proof of receipt in frontend-only mode (ADR-034): the server's confirmation
// and counter PIN routes (receipt-confirmation.service.ts, recipient-pin.ts),
// with its rules, so the hand-over step refuses here what it would refuse
// there. PINs are kept as typed: this is a demo in one browser, not a store.
import type { ReceiptSkipReason, ReceiptSummary } from '../api/types';

interface Slip { id: string; kind: 'ISSUE' | 'LOAN'; recipientId: string | null; recipientType: string | null; recipientName: string | null }
interface Person { id: string; name: string; type: string; active: boolean }

interface Ctx {
  slip: (slipId: string) => Slip | undefined;
  recipient: (id: string) => Person | undefined;
  userName: () => string;
  setting: (key: string) => unknown;
  err: (code: string, message: string, details?: Record<string, unknown>) => unknown;
}

interface Row { slipId: string; summary: ReceiptSummary }
interface Pin { pin: string; fails: number; locked: boolean }

let rows: Row[] = [];
const images = new Map<string, Blob>();
const pins = new Map<string, Pin>();

export function resetMockReceipts(): void {
  rows = [];
  images.clear();
  pins.clear();
}

const holdsPin = (type: string | null | undefined) => type === 'WORKER' || type === 'CONTRACTOR';
const weak = (pin: string) => /^(\d)\1+$/.test(pin) || '01234567890'.includes(pin) || '09876543210'.includes(pin)
  || (pin.length % 2 === 0 && pin === pin.slice(0, 2).repeat(pin.length / 2));

/** What GET /recipients adds to each recipient: never the PIN. */
export function mockPinFields(recipientId: string): { pinSet: boolean; pinLocked: boolean; pinFailedTries: number } {
  const p = pins.get(recipientId);
  return { pinSet: !!p, pinLocked: !!p?.locked, pinFailedTries: p?.fails ?? 0 };
}

/** A slip's receipt: its confirmation, else the latest note that it wasn't. */
export function mockReceiptOf(slipId: string): ReceiptSummary | null {
  const own = rows.filter((r) => r.slipId === slipId);
  return (own.find((r) => r.summary.method !== 'NONE') ?? own.at(-1))?.summary ?? null;
}

export function mockGetReceiptImage(slipId: string): Blob {
  const image = images.get(slipId);
  if (!image) throw new Error('404');
  return image;
}

const blobOf = (contentType: string, base64: string) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: contentType });
};

type Body = { method?: string; signerId?: string; pin?: string; reason?: ReceiptSkipReason; note?: string; image?: { contentType: string; data: string } };

function confirm(slipId: string, b: Body, ctx: Ctx): ReceiptSummary {
  const slip = ctx.slip(slipId);
  if (!slip) throw ctx.err('NOT_FOUND', 'Slip not found');
  const confirmed = rows.some((r) => r.slipId === slipId && r.summary.method !== 'NONE');
  const at = new Date().toISOString();
  const base = { confirmedAt: at, capturedByName: ctx.userName(), changed: false, imageRemoved: false };
  if (b.method === 'NONE') {
    if (!b.reason) throw ctx.err('VALIDATION_ERROR', 'Invalid confirmation');
    if ((b.reason === 'DISPUTED' || b.reason === 'OTHER') && !b.note?.trim()) throw ctx.err('VALIDATION_ERROR', b.reason === 'DISPUTED' ? 'Say what they say is wrong with the slip.' : 'Say what happened.');
    if (confirmed) throw ctx.err('ALREADY_CONFIRMED', 'This slip has already been confirmed.');
    const summary: ReceiptSummary = { ...base, method: 'NONE', signerId: null, signerName: null, collectedFor: false, reason: b.reason, note: b.note?.trim() || null, hasImage: false };
    rows.push({ slipId, summary });
    return summary;
  }
  if (b.method !== 'PIN' && b.method !== 'SIGNATURE' && b.method !== 'PAPER') throw ctx.err('VALIDATION_ERROR', 'Invalid confirmation');
  const signer = b.signerId ? ctx.recipient(b.signerId) : undefined;
  if (!signer) throw ctx.err('NOT_FOUND', 'Recipient not found');
  if (slip.recipientId && holdsPin(slip.recipientType) && signer.id !== slip.recipientId) throw ctx.err('SIGNER_NOT_RECIPIENT', `Only ${slip.recipientName ?? 'the recipient'} can confirm this slip.`);
  if (!holdsPin(signer.type)) throw ctx.err('VALIDATION_ERROR', `${signer.name} is a ${signer.type.toLowerCase()}: choose the person who collected.`);
  if (b.method === 'PIN') {
    const p = pins.get(signer.id);
    if (!p) throw ctx.err('PIN_NOT_SET', `${signer.name} has no PIN yet. They can sign instead.`);
    if (p.locked) throw ctx.err('PIN_LOCKED', `${signer.name}'s PIN is locked after too many wrong tries. They can sign instead, or a store controller can unlock it.`);
    if (b.pin !== p.pin) {
      const limit = Number(ctx.setting('inventory.receiptPinTries') ?? 5);
      p.fails += 1;
      if (p.fails >= limit) { p.locked = true; throw ctx.err('PIN_LOCKED', `${signer.name}'s PIN is locked after too many wrong tries. They can sign instead, or a store controller can unlock it.`); }
      const left = limit - p.fails;
      throw ctx.err('PIN_MISMATCH', `That PIN doesn't match. ${left} ${left === 1 ? 'try' : 'tries'} left.`, { triesLeft: left });
    }
    p.fails = 0;
  } else if (!b.image?.data) {
    throw ctx.err('VALIDATION_ERROR', 'The image is empty.');
  }
  if (confirmed) throw ctx.err('ALREADY_CONFIRMED', 'This slip has already been confirmed.');
  const summary: ReceiptSummary = {
    ...base, method: b.method, signerId: signer.id, signerName: signer.name, collectedFor: signer.id !== slip.recipientId,
    reason: null, note: null, hasImage: b.method !== 'PIN',
  };
  if (b.image) images.set(slipId, blobOf(b.image.contentType, b.image.data));
  rows.push({ slipId, summary });
  return summary;
}

/** The receipt routes, or undefined when the path is not one of them. */
export function routeReceipts(method: string, p: string, body: unknown, ctx: Ctx): unknown {
  const confirmation = /^\/slips\/([^/]+)\/confirmation$/.exec(p);
  if (method === 'POST' && confirmation) return confirm(decodeURIComponent(confirmation[1]!), (body as Body) ?? {}, ctx);

  const pinPath = /^\/recipients\/([^/]+)\/pin(?:\/(reset|unlock))?$/.exec(p);
  if (!pinPath) return undefined;
  const r = ctx.recipient(decodeURIComponent(pinPath[1]!));
  if (!r) throw ctx.err('NOT_FOUND', 'Recipient not found');
  const action = pinPath[2];
  if (method === 'PUT' && !action) {
    const pin = (body as { pin?: string })?.pin ?? '';
    if (!/^\d{4,6}$/.test(pin)) throw ctx.err('VALIDATION_ERROR', 'A PIN is 4 to 6 digits.');
    if (weak(pin)) throw ctx.err('WEAK_PIN', 'That PIN is too easy to guess. Choose one that is not a run like 1234 or the same digit repeated.');
    if (!holdsPin(r.type)) throw ctx.err('VALIDATION_ERROR', `${r.name} is a ${r.type.toLowerCase()}: whoever collects for it confirms with their own PIN.`);
    if (pins.has(r.id)) throw ctx.err('CONFLICT', `${r.name} already has a PIN. Reset it first.`);
    pins.set(r.id, { pin, fails: 0, locked: false });
    return { ...r, ...mockPinFields(r.id) };
  }
  if (method === 'POST' && action === 'reset') {
    if (!(body as { reason?: string })?.reason?.trim()) throw ctx.err('VALIDATION_ERROR', 'Say why the PIN is reset');
    if (!pins.has(r.id)) throw ctx.err('INVALID_STATE', `${r.name} has no PIN to reset.`);
    pins.delete(r.id);
    return { ...r, ...mockPinFields(r.id) };
  }
  if (method === 'POST' && action === 'unlock') {
    const pin = pins.get(r.id);
    if (!pin?.locked) throw ctx.err('INVALID_STATE', `${r.name}'s PIN is not locked.`);
    pin.locked = false;
    pin.fails = 0;
    return { ...r, ...mockPinFields(r.id) };
  }
  return undefined;
}
