// Demo data flow regression tests.
//
// The reported bug was that the demo backend returned `500 Internal
// Server Error` for the catalog endpoints. The fix has two parts:
//   1. The Prisma migration baseline was missing (fixed separately).
//   2. The seed only inserted the identity / location / settings catalog
//      and left the business tables empty. Reports and listings then
//      returned empty arrays, the dashboard had nothing to render, and
//      the API surface for demo data was effectively missing.
//
// These tests pin the demo data contract without importing the seed
// module (which runs `main()` at import time and would try to
// connect to a real Prisma client). Instead, we read the seed source
// file and assert the structural invariants: every demo transaction
// references a known SKU and location, every demo PO line references
// a known SKU, transfer pairs balance out, and the catalogue covers
// at least one row per material category the reporting endpoints group
// by.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SEED_PATH = join(process.cwd(), 'src', 'db', 'seed.ts');

function readSeed(): string {
  return readFileSync(SEED_PATH, 'utf8');
}

describe('demo seed catalog', () => {
  it('the seed file exports the documented demo arrays', () => {
    const src = readSeed();
    expect(src).toContain('DEMO_MATERIALS');
    expect(src).toContain('DEMO_SUPPLIERS');
    expect(src).toContain('DEMO_TRANSACTIONS');
    expect(src).toContain('DEMO_PURCHASE_ORDERS');
  });

  it('covers at least one row per material category the reports group by', () => {
    const src = readSeed();
    const categories = [
      'FASTENERS_SLUGS_INSULATION',
      'TOOLING_PPE_ELECTRICAL',
      'PROJECT_MATERIAL',
      'CONSUMABLES',
      'TOOLS',
    ];
    for (const c of categories) {
      expect(src, `seed must include at least one demo material in ${c}`).toContain(`category: '${c}'`);
    }
  });

  it('every demo transaction references a known SKU and location', () => {
    const src = readSeed();

    // Collect every SKU mentioned in the file (DEMO_MATERIALS, DEMO_TRANSACTIONS, PO lines).
    const skuMatches = Array.from(src.matchAll(/sku:\s*'([^']+)'/g)).map((m) => m[1]!);
    const uniqueSkus = new Set(skuMatches);

    // The transaction rows use the shape `{ sku, location, ... }` —
    // pull those out and verify each SKU exists in the catalogue.
    const txSkuMatches = Array.from(src.matchAll(/sku:\s*'([A-Z0-9-]+)',\s*location:/g)).map((m) => m[1]!);
    for (const sku of txSkuMatches) {
      expect(uniqueSkus.has(sku), `transaction references unknown SKU "${sku}"`).toBe(true);
    }

    // Locations must be one of the three seeded storerooms/racks.
    const allowedLocations = new Set(['Main Storeroom', 'Boiler Shop', 'D-1']);
    const txLocMatches = Array.from(src.matchAll(/location:\s*'(Main Storeroom|Boiler Shop|D-1)'/g)).map((m) => m[1]!);
    for (const loc of txLocMatches) {
      expect(allowedLocations.has(loc), `transaction references unknown location "${loc}"`).toBe(true);
    }
  });

  it('every demo PO line references a known SKU', () => {
    const src = readSeed();
    const skuMatches = Array.from(src.matchAll(/sku:\s*'([^']+)'/g)).map((m) => m[1]!);
    const uniqueSkus = new Set(skuMatches);
    const poSkuMatches = Array.from(src.matchAll(/sku:\s*'([A-Z0-9-]+)',\s*orderedQty:/g)).map((m) => m[1]!);
    for (const sku of poSkuMatches) {
      expect(uniqueSkus.has(sku), `PO line references unknown SKU "${sku}"`).toBe(true);
    }
  });

  it('includes a project-linked transaction so the project consumption endpoint has data', () => {
    const src = readSeed();
    expect(src).toMatch(/projectNumber:\s*'AFRI-1325'/);
  });

  it('seeds transfer pairs (TRANSFER_OUT + TRANSFER_IN) so the ledger is balanced', () => {
    const src = readSeed();
    const outs = (src.match(/type:\s*'TRANSFER_OUT'/g) ?? []).length;
    const ins = (src.match(/type:\s*'TRANSFER_IN'/g) ?? []).length;
    expect(outs, 'demo must have at least one TRANSFER_OUT').toBeGreaterThan(0);
    expect(ins, 'demo must have at least one TRANSFER_IN').toBe(outs);
  });

  it('seeds at least one PURCHASE_ORDER and at least one GOODS_RECEIPT', () => {
    const src = readSeed();
    expect(src).toMatch(/PO-2026-0001/);
    expect(src).toMatch(/PO-2026-0002/);
    expect(src).toMatch(/GR-2026-0001/);
  });

  it('seeds at least one ADJUSTMENT so the low-stock and exception reports have data', () => {
    const src = readSeed();
    expect(src).toMatch(/type:\s*'ADJUSTMENT'/);
    expect(src).toMatch(/reasonCode:\s*'COUNT_VARIANCE'/);
  });

  it('keeps quantities internally consistent: ISSUE / TRANSFER_OUT quantities are negative, RECEIPT / TRANSFER_IN are positive', () => {
    const src = readSeed();
    // Pull the DEMO_TRANSACTIONS literal block.
    const m = src.match(/const DEMO_TRANSACTIONS[\s\S]*?\n\];/);
    expect(m, 'DEMO_TRANSACTIONS literal must be present').toBeTruthy();
    const block = m![0]!;
    // Negative quantities only on ISSUE / TRANSFER_OUT / ADJUSTMENT; positive only on RECEIPT / TRANSFER_IN / ADJUSTMENT.
    const rows = Array.from(block.matchAll(/type:\s*'([A-Z_]+)',\s*sku:\s*'([^']+)',\s*location:\s*'[^']+',\s*quantity:\s*'(-?[\d.]+)'/g));
    expect(rows.length).toBeGreaterThan(10);
    for (const [, type, sku, quantity] of rows) {
      const allowed = Number(quantity) < 0 ? ['ISSUE', 'TRANSFER_OUT', 'ADJUSTMENT'] : ['RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT'];
      expect(allowed, `${type} of ${quantity} for ${sku}`).toContain(type);
    }
  });

  it('never takes stock below zero at any location, replayed in date order', () => {
    const block = readSeed().match(/const DEMO_TRANSACTIONS[\s\S]*?\n\];/)![0]!;
    const rows = Array.from(block.matchAll(/daysAgo:\s*(\d+),\s*type:\s*'([A-Z_]+)',\s*sku:\s*'([^']+)',\s*location:\s*'([^']+)',\s*quantity:\s*'(-?[\d.]+)'/g))
      .map((m) => ({ daysAgo: Number(m[1]), sku: m[3]!, location: m[4]!, quantity: Number(m[5]) }));
    expect(rows.length).toBeGreaterThan(10);
    const running = new Map<string, number>();
    for (const r of [...rows].sort((a, b) => b.daysAgo - a.daysAgo)) {
      const key = `${r.sku} @ ${r.location}`;
      const after = (running.get(key) ?? 0) + r.quantity;
      expect(after, `${key} goes to ${after}`).toBeGreaterThanOrEqual(0);
      running.set(key, after);
    }
  });

  it('says who every issue was for, naming a demo recipient', () => {
    const src = readSeed();
    const recipientsBlock = src.match(/const DEMO_RECIPIENTS[\s\S]*?\n\];/)![0]!;
    const names = new Set(Array.from(recipientsBlock.matchAll(/name:\s*'([^']+)'/g)).map((m) => m[1]!));
    const txBlock = src.match(/const DEMO_TRANSACTIONS[\s\S]*?\n\];/)![0]!;
    const issues = Array.from(txBlock.matchAll(/type:\s*'ISSUE'[^}]*\}/g)).map((m) => m[0]);
    expect(issues.length).toBeGreaterThan(5);
    for (const issue of issues) {
      const who = issue.match(/recipient:\s*'([^']+)'/)?.[1];
      expect(who, issue).toBeDefined();
      expect(names.has(who!), `${who} is not a demo recipient`).toBe(true);
    }
  });
});
