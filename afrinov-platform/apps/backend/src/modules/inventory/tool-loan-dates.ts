// Reading tool loan terms and due dates from the database, for the Tools page
// (tool-loan.service.ts) and for Movements (inventory.service.ts), which lists
// a loan's due date changes beside its check-out and check-in. The rules
// themselves are in tool-loan-terms.ts.
import { Prisma } from '@prisma/client';
import { SettingsService } from '../settings/settings.service.js';
import { TERM_SETTINGS, loanDatesOf, termsFrom, type LoanDates, type LoanTerms } from './tool-loan-terms.js';

type Db = Pick<Prisma.TransactionClient, 'inventoryTransaction'>;

/** The loan settings as they are now. */
export async function loanTerms(): Promise<LoanTerms> {
  return termsFrom(await SettingsService.getValues(Object.values(TERM_SETTINGS)));
}

/** The due dates of these loans (LOAN rows), by loan id. Ids that are not loans are left out. */
export async function loanDatesFor(db: Db, loanIds: string[], terms: LoanTerms): Promise<Map<string, LoanDates>> {
  const ids = [...new Set(loanIds)];
  if (ids.length === 0) return new Map();
  const loans = await db.inventoryTransaction.findMany({
    where: { id: { in: ids }, type: 'LOAN' },
    select: { id: true, postedAt: true, dueOn: true, loanExtensions: { select: { id: true, createdAt: true, dueOn: true } } },
  });
  return new Map(loans.map((l) => [l.id, loanDatesOf(l, l.loanExtensions, terms)]));
}
