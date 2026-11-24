// Guard for the stock floor (BR-009, ADR-047): the files that write the stock
// ledger or the stored balances are a known list. A new one fails this test,
// so its author and reviewer check it follows the rule: take the balance lock
// (lockInventoryBalances) before reading the balance, then check, write the
// line and recompute. Once it does, add it to WRITERS with what it moves.
//
// A text search, so a review prompt rather than a proof. It works file by
// file: a listed file passes if it calls the lock and the recompute
// somewhere, so a new path inside an existing file that skips them is not
// caught here (helpers write under their callers' locks, which text can't
// follow). It finds direct Prisma calls and raw SQL, not writes made through
// an alias. The race tests (integration/stock-floor-races.real-http.test.ts)
// cover the paths they name, the recompute takes the lock itself, and the
// database constraint refuses a balance below zero. One posting function
// every path goes through (TD-027) would replace this convention.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const LEDGER_WRITE = /\binventoryTransaction\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
const BALANCE_WRITE = /\binventoryBalance\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
/** Raw SQL, with or without a schema in front (`public.inventory_transactions`, `"public"."inventory_balances"`). */
const RAW_WRITE = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:"?[A-Za-z_]\w*"?\.)?"?inventory_(transactions|balances)\b/i;

export interface SourceFile { path: string; text: string }

/** The files that write the ledger or the balances, and how. */
export function findLedgerWriters(files: SourceFile[]): Map<string, Set<'ledger' | 'balance' | 'raw'>> {
  const found = new Map<string, Set<'ledger' | 'balance' | 'raw'>>();
  for (const { path, text } of files) {
    const kinds = new Set<'ledger' | 'balance' | 'raw'>();
    if (LEDGER_WRITE.test(text)) kinds.add('ledger');
    if (BALANCE_WRITE.test(text)) kinds.add('balance');
    if (RAW_WRITE.test(text)) kinds.add('raw');
    if (kinds.size > 0) found.set(path, kinds);
  }
  return found;
}

/** The files that call none of the named functions. */
export function missingCall(files: SourceFile[], ...names: string[]): string[] {
  return files
    .filter(({ text }) => !names.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(text)))
    .map(({ path }) => path);
}

/** Every file that may write the ledger, with what it moves. */
const WRITERS: Record<string, string> = {
  'src/modules/inventory/inventory.service.ts': 'issue, transfer, adjust, reverse, return, goods receipt',
  'src/modules/inventory/project-leftovers.service.ts': "a closed project's held stock to Stores",
  'src/modules/inventory/stock-count.service.ts': 'count adjustments',
  'src/modules/inventory/stock-receipt.service.ts': 'stock received without an order',
  'src/modules/inventory/tool-loan.service.ts': 'tool check-out, check-in, lost tool write-off',
  'src/modules/migration/opening-balance.service.ts': 'opening balances from the workbook (adds only)',
  'src/modules/procurement/supplier-return.service.ts': 'goods back to the supplier',
  'src/db/seed.ts': 'demo data only, never in production; single process, so no lock',
};
/** The only file that writes inventory_balances: the recompute. */
const BALANCE_WRITER = 'src/shared/inventory/balances.ts';

function sourceFiles(root: string, dir = root): SourceFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(root, full);
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts') || entry.name.endsWith('.d.ts')) return [];
    return [{ path: `src/${relative(root, full).split(sep).join('/')}`, text: readFileSync(full, 'utf8') }];
  });
}

describe('findLedgerWriters', () => {
  it('finds ledger writes, balance writes and raw SQL writes', () => {
    const found = findLedgerWriters([
      { path: 'a.ts', text: 'await tx.inventoryTransaction.create({ data })' },
      { path: 'b.ts', text: 'await tx.inventoryBalance.upsert ({ where })' },
      { path: 'c.ts', text: 'await tx.$executeRaw`UPDATE "inventory_balances" SET quantity = 0`' },
      { path: 'd.ts', text: 'await tx.$executeRaw`insert into inventory_transactions (id) values (1)`' },
      { path: 'e.ts', text: 'await tx.$executeRaw`UPDATE public.inventory_transactions SET quantity = 0`' },
      { path: 'f.ts', text: 'await tx.$executeRaw`DELETE FROM "public"."inventory_balances"`' },
    ]);
    expect([...found.entries()].map(([p, k]) => [p, [...k]])).toEqual([
      ['a.ts', ['ledger']], ['b.ts', ['balance']], ['c.ts', ['raw']], ['d.ts', ['raw']], ['e.ts', ['raw']], ['f.ts', ['raw']],
    ]);
  });

  it('names the files that call none of the required functions', () => {
    const files = [
      { path: 'calls.ts', text: 'await recomputeBalance(key, tx);' },
      { path: 'wrapper.ts', text: 'await recomputeBalancesFor (key);' },
      { path: 'imports-only.ts', text: "import { recomputeBalance } from './balances.js';" },
      { path: 'none.ts', text: 'await tx.inventoryTransaction.create({ data });' },
    ];
    expect(missingCall(files, 'recomputeBalance', 'recomputeBalancesFor')).toEqual(['imports-only.ts', 'none.ts']);
  });

  it('ignores reads', () => {
    expect(findLedgerWriters([
      { path: 'r.ts', text: 'tx.inventoryTransaction.findMany(); tx.inventoryBalance.aggregate(); SELECT * FROM inventory_balances' },
    ]).size).toBe(0);
  });
});

describe('who writes the stock ledger (ADR-047)', () => {
  const src = fileURLToPath(new URL('../../', import.meta.url));
  const writers = findLedgerWriters(sourceFiles(src));

  it('is only the known list; a new writer must follow lock → read → write → recompute and be added', () => {
    const unknown = [...writers.keys()].filter((p) => !(p in WRITERS) && p !== BALANCE_WRITER);
    expect(unknown, `New ledger writer(s): ${unknown.join(', ')}. Take lockInventoryBalances before reading the balance, then add the file to WRITERS (ADR-047).`).toEqual([]);
  });

  it('still lists only files that write, so the list stays true', () => {
    const stale = Object.keys(WRITERS).filter((p) => !writers.get(p)?.has('ledger'));
    expect(stale, `Listed but no longer writing the ledger: ${stale.join(', ')}. Remove them from WRITERS.`).toEqual([]);
  });

  it('writes inventory_balances only through the recompute', () => {
    const balanceWriters = [...writers.entries()].filter(([, k]) => k.has('balance') || k.has('raw')).map(([p]) => p);
    expect(balanceWriters).toEqual([BALANCE_WRITER]);
  });

  const production = () => Object.keys(WRITERS)
    .filter((p) => p !== 'src/db/seed.ts')
    .map((p) => ({ path: p, text: readFileSync(join(src, p.replace(/^src\//, '')), 'utf8') }));

  it('takes the balance lock in every production writer', () => {
    expect(missingCall(production(), 'lockInventoryBalances')).toEqual([]);
  });

  it('recomputes the balance in every writer, so the stored balance follows the ledger', () => {
    // A line written without a recompute leaves the stored balance stale, and
    // every later check reads the stale figure; the stock floor can't see it.
    const all = [...production(), { path: 'src/db/seed.ts', text: readFileSync(join(src, 'db/seed.ts'), 'utf8') }];
    expect(missingCall(all, 'recomputeBalance', 'recomputeBalancesFor'),
      'Every file that writes the ledger recomputes the balances it touched (ADR-047).').toEqual([]);
  });
});
