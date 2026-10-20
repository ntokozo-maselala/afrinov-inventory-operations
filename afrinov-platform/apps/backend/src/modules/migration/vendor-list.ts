// The vendor list in the AFRI-0000_x purchase order template ("Item
// Description" workbook, sheet "Suppliers (2)"): one row per supplier with
// vendor name, vendor code, address, contact, number, currency, email,
// website, services and payment terms.
//
// readVendorList reads the rows; planVendorImport compares them with the
// suppliers already in the app. An existing supplier (same name ignoring
// case) only has its empty fields filled; nothing typed in the app is
// overwritten. Rows that can't be loaded as they are become problems in the
// report rather than guesses.
import ExcelJS from 'exceljs';
import { textOf } from './workbook-reader.js';
import {
  EMAIL_PATTERN, cleanCurrency, cleanPaymentTerms, cleanText, cleanVendorCode, cleanWebsite,
} from '../procurement/supplier-fields.js';

export interface VendorRow {
  row: number;
  name: string | null;
  vendorCode: string | null;
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
  currency: string | null;
  /** As written, before checking. */
  currencyRaw: string | null;
  contactEmail: string | null;
  emailRaw: string | null;
  website: string | null;
  services: string | null;
  paymentTerms: string | null;
}

export interface VendorList {
  sheet: string | null;
  rows: VendorRow[];
}

const COLUMNS = {
  name: 'vendor name',
  vendorCode: 'vendor code',
  address: 'physical address',
  contactName: 'contact person',
  contactPhone: 'contact number',
  currency: 'currency',
  email: 'email address',
  website: 'website',
  services: 'services and supplies',
  paymentTerms: 'payment terms',
} as const;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** The first sheet whose top row has a "Vendor name" heading. */
export function readVendorList(wb: ExcelJS.Workbook): VendorList {
  for (const ws of wb.worksheets) {
    const columns = new Map<string, number>();
    ws.getRow(1).eachCell((cell, col) => {
      const t = textOf(cell.value);
      if (t && !columns.has(norm(t))) columns.set(norm(t), col);
    });
    if (!columns.has(COLUMNS.name)) continue;
    const at = (row: ExcelJS.Row, key: keyof typeof COLUMNS) => {
      const col = columns.get(COLUMNS[key]);
      return col === undefined ? null : textOf(row.getCell(col).value);
    };
    const rows: VendorRow[] = [];
    ws.eachRow((row, r) => {
      if (r === 1) return;
      const name = cleanText(at(row, 'name'));
      const vendorCode = cleanVendorCode(at(row, 'vendorCode'));
      if (!name && !vendorCode) return;
      const emailRaw = cleanText(at(row, 'email'));
      const currencyRaw = cleanText(at(row, 'currency'));
      rows.push({
        row: r,
        name,
        vendorCode,
        address: cleanText(at(row, 'address')),
        contactName: cleanText(at(row, 'contactName')),
        contactPhone: cleanText(at(row, 'contactPhone')),
        currency: cleanCurrency(currencyRaw),
        currencyRaw,
        contactEmail: emailRaw && EMAIL_PATTERN.test(emailRaw) ? emailRaw : null,
        emailRaw,
        website: cleanWebsite(at(row, 'website')),
        services: cleanText(at(row, 'services')),
        paymentTerms: cleanPaymentTerms(at(row, 'paymentTerms')),
      });
    });
    return { sheet: ws.name, rows };
  }
  return { sheet: null, rows: [] };
}

export async function readVendorListFile(path: string): Promise<VendorList> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return readVendorList(wb);
}

/** The supplier fields the import writes. */
export interface VendorFields {
  vendorCode: string | null;
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  currency: string;
  website: string | null;
  services: string | null;
  paymentTerms: string | null;
}

export type ExistingSupplier = { id: string; name: string } & VendorFields;

export type VendorProblemCode =
  | 'NO_NAME' | 'DUPLICATE_NAME' | 'CODE_BELONGS_TO_OTHER' | 'CODE_DIFFERS' | 'NO_CODE' | 'BAD_EMAIL' | 'UNKNOWN_CURRENCY';

export interface VendorProblem { code: VendorProblemCode; row: number; name: string | null; detail: string }

export const VENDOR_PROBLEM_TEXT: Record<VendorProblemCode, { title: string; skipped: boolean }> = {
  NO_NAME: { title: 'Row has a vendor code but no name: not loaded', skipped: true },
  DUPLICATE_NAME: { title: 'Name appears more than once: the most complete row was loaded, this one was not', skipped: true },
  CODE_BELONGS_TO_OTHER: { title: 'Vendor code is already used by a different supplier in the app: not loaded', skipped: true },
  CODE_DIFFERS: { title: 'Supplier is in the app with a different vendor code: kept the app\'s code', skipped: false },
  NO_CODE: { title: 'No vendor code: loaded without one', skipped: false },
  BAD_EMAIL: { title: 'Email address is not valid: loaded without it', skipped: false },
  UNKNOWN_CURRENCY: { title: 'Currency not recognised: loaded as ZAR', skipped: false },
};

export interface VendorPlan {
  create: Array<{ row: number; name: string } & VendorFields>;
  /** Existing suppliers and the empty fields the import fills. */
  fill: Array<{ row: number; id: string; name: string; fields: Partial<VendorFields> }>;
  unchanged: Array<{ row: number; name: string }>;
  problems: VendorProblem[];
}

const FIELD_KEYS: Array<keyof VendorFields> = [
  'vendorCode', 'address', 'contactName', 'contactPhone', 'contactEmail', 'currency', 'website', 'services', 'paymentTerms',
];

function fieldsOf(r: VendorRow): VendorFields {
  return {
    vendorCode: r.vendorCode,
    address: r.address,
    contactName: r.contactName,
    contactPhone: r.contactPhone,
    contactEmail: r.contactEmail,
    currency: r.currency ?? 'ZAR',
    website: r.website,
    services: r.services,
    paymentTerms: r.paymentTerms,
  };
}

const filledCount = (r: VendorRow) => FIELD_KEYS.filter((k) => fieldsOf(r)[k] !== null).length;
const key = (name: string) => name.toLowerCase();

export function planVendorImport(list: VendorList, existing: ExistingSupplier[]): VendorPlan {
  const plan: VendorPlan = { create: [], fill: [], unchanged: [], problems: [] };
  const problem = (code: VendorProblemCode, r: VendorRow, detail: string) =>
    plan.problems.push({ code, row: r.row, name: r.name, detail });

  // Duplicated names: keep the row with most filled in (the first on a tie).
  const byName = new Map<string, VendorRow[]>();
  for (const r of list.rows) {
    if (!r.name) { problem('NO_NAME', r, `Vendor code ${r.vendorCode}`); continue; }
    byName.set(key(r.name), [...(byName.get(key(r.name)) ?? []), r]);
  }
  const kept: VendorRow[] = [];
  for (const group of byName.values()) {
    const best = group.reduce((a, b) => (filledCount(b) > filledCount(a) ? b : a));
    kept.push(best);
    for (const r of group) {
      if (r !== best) problem('DUPLICATE_NAME', r, `${r.vendorCode ?? 'no code'}; row ${best.row} (${best.vendorCode ?? 'no code'}) was loaded instead`);
    }
  }
  kept.sort((a, b) => a.row - b.row);

  const existingByName = new Map(existing.map((s) => [key(s.name), s]));
  const existingByCode = new Map(existing.filter((s) => s.vendorCode).map((s) => [s.vendorCode!, s]));
  // Codes taken by rows already planned in this run, so two rows can't load the same one.
  const claimed = new Map<string, VendorRow>();

  for (const r of kept) {
    const name = r.name!;
    if (r.emailRaw && !r.contactEmail) problem('BAD_EMAIL', r, `"${r.emailRaw}"`);
    if (r.currencyRaw && !r.currency) problem('UNKNOWN_CURRENCY', r, `"${r.currencyRaw}"`);
    const fields = fieldsOf(r);
    const match = existingByName.get(key(name));
    const codeOwner = r.vendorCode ? existingByCode.get(r.vendorCode) : undefined;

    if (codeOwner && codeOwner !== match) {
      problem('CODE_BELONGS_TO_OTHER', r, `${r.vendorCode} is ${codeOwner.name} in the app`);
      continue;
    }
    const earlier = r.vendorCode ? claimed.get(r.vendorCode) : undefined;
    if (earlier) {
      problem('CODE_BELONGS_TO_OTHER', r, `${r.vendorCode} is also on row ${earlier.row} (${earlier.name}), which was loaded`);
      continue;
    }
    if (r.vendorCode) claimed.set(r.vendorCode, r);
    if (!r.vendorCode) problem('NO_CODE', r, 'No vendor code');

    if (!match) {
      plan.create.push({ row: r.row, name, ...fields });
      continue;
    }
    if (match.vendorCode && r.vendorCode && match.vendorCode !== r.vendorCode) {
      problem('CODE_DIFFERS', r, `App has ${match.vendorCode}, vendor list has ${r.vendorCode}`);
    }
    const fill: Partial<VendorFields> = {};
    for (const k of FIELD_KEYS) {
      const incoming = fields[k];
      if (incoming === null) continue;
      // Currency always has a value; ZAR is the default, so a different one on the list is new information.
      const empty = k === 'currency' ? match.currency === 'ZAR' && incoming !== 'ZAR' : match[k] === null || match[k] === '';
      if (empty) (fill as Record<string, string>)[k] = incoming;
    }
    if (Object.keys(fill).length > 0) plan.fill.push({ row: r.row, id: match.id, name: match.name, fields: fill });
    else plan.unchanged.push({ row: r.row, name: match.name });
  }
  return plan;
}

const cell = (s: string | null | undefined) => (s ?? '').replace(/\|/g, '\\|');

export function renderVendorReport(plan: VendorPlan, meta: { file: string; sheet: string | null; generatedAt: Date }): string {
  const out: string[] = [];
  out.push('# Vendor list import', '');
  out.push(`- Workbook: ${meta.file}${meta.sheet ? `, sheet "${meta.sheet}"` : ''}`);
  out.push(`- Generated: ${meta.generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`, '');
  if (!meta.sheet) {
    out.push('No sheet with a "Vendor name" heading in the top row was found. Nothing to import.');
    return out.join('\n') + '\n';
  }
  out.push('| | Suppliers |', '|---|---:|');
  out.push(`| New | ${plan.create.length} |`, `| Already in the app, empty fields filled | ${plan.fill.length} |`);
  out.push(`| Already in the app, nothing to add | ${plan.unchanged.length} |`);
  out.push(`| Not loaded | ${plan.problems.filter((p) => VENDOR_PROBLEM_TEXT[p.code].skipped).length} |`, '');

  const codes = (Object.keys(VENDOR_PROBLEM_TEXT) as VendorProblemCode[]).filter((c) => plan.problems.some((p) => p.code === c));
  if (codes.length > 0) {
    out.push('## To review', '');
    for (const code of codes) {
      out.push(`### ${VENDOR_PROBLEM_TEXT[code].title}`, '', '| Row | Name | Detail |', '|---:|---|---|');
      for (const p of plan.problems.filter((x) => x.code === code)) out.push(`| ${p.row} | ${cell(p.name)} | ${cell(p.detail)} |`);
      out.push('');
    }
  }
  if (plan.fill.length > 0) {
    out.push('## Existing suppliers that get empty fields filled', '', '| Row | Supplier | Fields |', '|---:|---|---|');
    for (const f of plan.fill) out.push(`| ${f.row} | ${cell(f.name)} | ${cell(Object.keys(f.fields).join(', '))} |`);
    out.push('');
  }
  if (plan.create.length > 0) {
    out.push('## New suppliers', '', '| Row | Code | Name | Currency | Payment terms | Services |', '|---:|---|---|---|---|---|');
    for (const c of plan.create) {
      out.push(`| ${c.row} | ${cell(c.vendorCode)} | ${cell(c.name)} | ${c.currency} | ${cell(c.paymentTerms)} | ${cell(c.services)} |`);
    }
    out.push('');
  }
  return out.join('\n') + '\n';
}
