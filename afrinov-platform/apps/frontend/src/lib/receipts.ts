// Proof of receipt on the client (ADR-034): whether the hand-over step opens,
// who may confirm a slip, and how a slip's receipt reads. The server decides
// (apps/backend/src/modules/inventory/receipt-confirmation.service.ts); this
// only shapes the screens.
import { useApi } from '../hooks/useApi';
import { formatDateTime } from './format';
import type { ReceiptSkipReason, ReceiptSummary } from '../api/types';

export type ReceiptMode = 'off' | 'ask' | 'require';

const MODE_KEY = 'inventory.receiptConfirmation';

/** Settings > Inventory: off, ask (the default) or require. Ask until the setting loads. */
export function useReceiptMode(): ReceiptMode {
  const values = useApi<Record<string, unknown>>(`/settings/values?keys=${MODE_KEY}`);
  const v = values.data && !Array.isArray(values.data) ? values.data[MODE_KEY] : undefined;
  return v === 'off' || v === 'require' ? v : 'ask';
}

export type RecipientKind = 'WORKER' | 'MACHINE' | 'SITE' | 'CONTRACTOR';

/** Workers and contractors confirm for themselves; a machine or site, by whoever collects for it. */
export const holdsPin = (type: string | null | undefined): boolean => type === 'WORKER' || type === 'CONTRACTOR';

export const SKIP_REASONS: Array<{ value: ReceiptSkipReason; label: string; help?: string }> = [
  { value: 'LEFT', label: 'Left before confirming' },
  { value: 'CANNOT', label: 'Can’t sign or use a PIN' },
  { value: 'NO_SCREEN', label: 'Screen or tablet not available' },
  { value: 'DISPUTED', label: 'Says the slip is wrong', help: 'The store controller is asked to check and correct the slip.' },
  { value: 'OTHER', label: 'Other' },
];

/** These need a note, as the server asks. */
export const NOTE_REASONS: ReceiptSkipReason[] = ['DISPUTED', 'OTHER'];

export const reasonLabel = (r: ReceiptSkipReason | null): string => SKIP_REASONS.find((x) => x.value === r)?.label ?? 'Not given';

export const isConfirmed = (r: ReceiptSummary | null | undefined): boolean => !!r && r.method !== 'NONE';

export type ReceiptTone = 'success' | 'warning' | 'danger';

/** The badge and sentence a slip shows about its receipt. */
export function describeReceipt(r: ReceiptSummary | null | undefined, recipientName: string | null): { badge: string; tone: ReceiptTone; text: string } {
  if (!r) return { badge: 'Not confirmed', tone: 'warning', text: 'Nobody has confirmed this slip yet.' };
  if (r.method === 'NONE') {
    return {
      badge: r.reason === 'DISPUTED' ? 'Disputed' : 'Not confirmed',
      tone: r.reason === 'DISPUTED' ? 'danger' : 'warning',
      text: `${reasonLabel(r.reason)}${r.note ? `: “${r.note}”` : ''}. Recorded by ${r.capturedByName}, ${formatDateTime(r.confirmedAt)}.`,
    };
  }
  const how = r.method === 'PIN' ? 'with their PIN' : r.method === 'SIGNATURE' ? 'signed on screen' : 'signed paper slip attached';
  const collected = r.collectedFor && recipientName ? `, collecting for ${recipientName}` : '';
  return {
    badge: r.changed ? 'Changed after it was confirmed' : 'Confirmed',
    tone: r.changed ? 'danger' : 'success',
    text: `${r.signerName ?? 'Someone'}${collected}, ${how}. ${formatDateTime(r.confirmedAt)}, captured by ${r.capturedByName}.${r.imageRemoved ? ' The image was removed after the keep period.' : ''}`,
  };
}

/**
 * Too easy to guess, as the server refuses it (recipient-pin.ts): one digit
 * repeated, a straight run up or down, or a pair repeated.
 */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  if ('01234567890'.includes(pin) || '09876543210'.includes(pin)) return true;
  return pin.length % 2 === 0 && pin === pin.slice(0, 2).repeat(pin.length / 2);
}

/**
 * A short, stable handle for an image, so a retry of the same confirmation is
 * recognised without keeping the image itself in the browser's retry store.
 */
export function imageHandle(base64: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < base64.length; i++) {
    h ^= base64.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${base64.length}:${h.toString(16)}`;
}
