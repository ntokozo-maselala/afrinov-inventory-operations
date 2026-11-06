// Reconciles Materials with Stock and Tools in the database DATABASE_URL points
// at (ADR-031). The pages count different things, so their totals don't add up
// on their own: this prints how they relate, item by item. Read-only.
//
// It reads the same services the pages do, and exits 1 when an item on Stock or
// on Tools isn't on Materials, or the Materials tabs don't add up to the
// catalogue. Neither should ever happen: each would be a bug, not a count.
//
//   npm run check:catalogue --workspace=@afrinov/backend
import { prisma } from '../src/shared/db.js';
import { CatalogueService, catalogueTabOf } from '../src/modules/inventory/catalogue.service.js';
import { MaterialService } from '../src/modules/inventory/material.service.js';
import { ToolLoanService } from '../src/modules/inventory/tool-loan.service.js';
import { ReportingService } from '../src/modules/reporting/reporting.service.js';

const row = (label: string, value: number | string) => console.log(`${label.padEnd(56)}${String(value).padStart(9)}`);
const signed = (n: number) => (n < 0 ? `-${-n}` : `+${n}`);

async function main(): Promise<void> {
  const [summary, materials, stock, tools] = await Promise.all([
    CatalogueService.summary(),
    MaterialService.list(),
    ReportingService.currentStock(),
    ToolLoanService.list(),
  ]);

  const { stock: s, notOnStock, states, tabs } = summary;
  console.log('Stock and Tools against Materials:\n');
  row('Stock page, as shown (one line per item per location)', `${s.lines} lines`);
  row('Less second and further locations of the same item', signed(s.items - s.lines));
  row('Different items on Stock', s.items);
  row('Add items with no line on Stock', signed(notOnStock.items));
  row('Materials, Stores and Tools tabs', tabs.STORES + tabs.TOOLS);
  row('Add the Projects tab', signed(tabs.PROJECTS));
  row('Every item in the catalogue', summary.items);
  console.log('');
  row('Stores tab', tabs.STORES);
  row('Tools tab', tabs.TOOLS);
  row('Projects tab', tabs.PROJECTS);
  row('Tools page (active tools)', summary.toolsListed);
  row('Tools on both the Stock and Tools pages', s.tools);
  row('Stores and Tools items in stock', states.IN_STOCK);
  row('Held for a project only', states.HELD_FOR_PROJECT);
  row('Out of stock', states.OUT_OF_STOCK);
  row('Never received', states.NEVER_RECEIVED);
  row('Inactive items', summary.inactive);

  const listed = new Set(materials.map((m) => m.id));
  const onStock = stock.filter((r) => catalogueTabOf(r.category) !== 'PROJECTS' && !r.heldForProject);
  const missing = [
    ...onStock.filter((r) => !listed.has(r.materialId)).map((r) => `${r.materialSku} (on Stock)`),
    ...tools.filter((t) => !listed.has(t.materialId)).map((t) => `${t.sku} (on Tools)`),
  ];
  const seen = new Set(onStock.map((r) => r.materialId));
  const never = materials.filter((m) => catalogueTabOf(m.category) !== 'PROJECTS' && !seen.has(m.id));

  if (never.length > 0) {
    console.log(`\nNot on Stock (${never.length}), for information:`);
    for (const m of never.slice(0, 50)) console.log(`- ${m.sku}${m.category === 'TOOLS' ? ' (tool)' : ''}`);
    if (never.length > 50) console.log(`- … and ${never.length - 50} more`);
  }

  const addsUp = tabs.STORES + tabs.TOOLS + tabs.PROJECTS === materials.length && summary.items === materials.length;
  if (missing.length === 0 && addsUp) {
    console.log('\nEvery item on Stock and Tools is on Materials, and the tabs add up to the catalogue.');
    return;
  }
  if (!addsUp) console.log(`\nThe tabs do not add up: ${summary.items} counted, ${materials.length} listed.`);
  if (missing.length > 0) {
    console.log(`\nOn Stock or Tools but not on Materials (${missing.length}):`);
    for (const m of missing.slice(0, 50)) console.log(`- ${m}`);
  }
  process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
