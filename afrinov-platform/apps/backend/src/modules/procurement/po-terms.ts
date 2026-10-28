// The small print of a purchase order: the sections printed under Remarks.
// Each comes from a purchase order setting, and is copied onto the order when
// it is approved, so a later change to the settings does not change what the
// supplier accepted.
import { Prisma } from '@prisma/client';
import { SettingsService } from '../settings/settings.service.js';

export const PRINTED_TERMS_SETTINGS = {
  terms: 'purchaseOrders.terms',
  latePenalty: 'purchaseOrders.latePenalty',
  documentation: 'purchaseOrders.documentation',
  invoicing: 'purchaseOrders.invoicing',
  invoiceEmail: 'purchaseOrders.invoiceEmail',
  codeOfConduct: 'purchaseOrders.codeOfConduct',
} as const;

export type PrintedTerms = Record<keyof typeof PRINTED_TERMS_SETTINGS, string>;

/** The small print as the settings have it now, read in the approving transaction. */
export async function currentPrintedTerms(tx?: Prisma.TransactionClient): Promise<PrintedTerms> {
  const values = await SettingsService.getValues(Object.values(PRINTED_TERMS_SETTINGS), tx);
  const entries = Object.entries(PRINTED_TERMS_SETTINGS).map(([field, key]) => [field, String(values[key] ?? '')]);
  return Object.fromEntries(entries) as PrintedTerms;
}
