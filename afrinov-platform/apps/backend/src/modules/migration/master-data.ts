// Projects, recipients and suppliers for the import: a second review file,
// master-data.xlsx, next to the mapping file. The first dry run fills it from
// the workbook's "Project No." and "Employees" sheets; the workbook has no
// supplier names, so the buyer types those in. Later runs read it back.
//
// Kept apart from mapping.xlsx so adding it never touches a mapping the
// storeman has already started on.
import ExcelJS from 'exceljs';
import type { RecipientType } from '@prisma/client';
import { textOf, type ListEntry, type WorkbookLists } from './workbook-reader.js';
import type { Problem } from './workbook-analysis.js';

export interface ProjectRow { asWritten: string; projectNumber: string | null; name: string | null; include: boolean; row?: number }
export interface RecipientRow { asWritten: string; name: string | null; type: string | null; include: boolean; row?: number }
export interface SupplierRow { name: string | null; contactName: string | null; contactEmail: string | null; contactPhone: string | null; row?: number }

export interface MasterData { projects: ProjectRow[]; recipients: RecipientRow[]; suppliers: SupplierRow[] }

export interface MasterDataPlan {
  projects: Array<{ projectNumber: string; name: string | null }>;
  recipients: Array<{ name: string; type: RecipientType }>;
  suppliers: Array<{ name: string; contactName: string | null; contactEmail: string | null; contactPhone: string | null }>;
}

export const RECIPIENT_TYPES: RecipientType[] = ['WORKER', 'MACHINE', 'SITE', 'CONTRACTOR'];

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** "VUSI" and "vusi" become "Vusi"; mixed case is kept as typed. */
export function tidyName(s: string): string {
  const t = tidy(s);
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
  return t.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

/**
 * Splits a Project No. entry into number and name:
 *   "1118 - Workshop PPE" → 1118, Workshop PPE
 *   "AFRI-1381"           → AFRI-1381
 *   "2021-0FFICE MAINTENANCE" → 2021, OFFICE MAINTENANCE (a zero typed for an O)
 *   "Northam Plats"       → no number
 */
export function parseProjectEntry(text: string): { projectNumber: string | null; name: string | null } {
  const t = tidy(text);
  const coded = t.match(/^([A-Za-z]{1,6}-\d{2,6})(?:\s*[-–:]\s*(.+))?$/);
  if (coded) return { projectNumber: coded[1]!.toUpperCase(), name: coded[2] ? tidy(coded[2]) : null };
  const numbered = t.match(/^(\d{3,6})\s*[-–:]\s*(.+)$/);
  if (numbered) return { projectNumber: numbered[1]!, name: tidy(numbered[2]!.replace(/^0(?=[A-Za-z])/, 'O')) };
  if (/^\d{3,6}$/.test(t)) return { projectNumber: t, name: null };
  return { projectNumber: null, name: t };
}

export function suggestMasterData(lists: WorkbookLists): MasterData {
  const seenProjects = new Set<string>();
  const projects = lists.projects.map((e: ListEntry): ProjectRow => {
    const { projectNumber, name } = parseProjectEntry(e.text);
    // A repeat of a number already listed is left out; entries without a number wait for one.
    const include = projectNumber !== null && !seenProjects.has(projectNumber);
    if (projectNumber) seenProjects.add(projectNumber);
    return { asWritten: e.text, projectNumber, name, include };
  });

  // Spellings of one name ("Khotso", "KHOTSO ") share the first tidy spelling.
  const firstSpelling = new Map<string, string>();
  const recipients = lists.employees.map((e: ListEntry): RecipientRow => {
    const key = letters(e.text);
    if (!firstSpelling.has(key)) firstSpelling.set(key, tidyName(e.text));
    return { asWritten: e.text, name: firstSpelling.get(key)!, type: 'WORKER', include: true };
  });

  return { projects, recipients, suppliers: [] };
}

// ── The Excel file ────────────────────────────────────────────────────

const README = [
  'Projects, recipients and suppliers for the stock workbook import',
  '',
  'Fill in or correct the white columns only. Grey columns come from the stock workbook.',
  '',
  'Projects sheet',
  '- One row per entry on the workbook\'s "Project No." sheet. The number and name are split out where the entry has both.',
  '- Import = No leaves the row out: a repeat of a number already listed, or an entry with no project number (a client or site name).',
  '  Give such an entry a number and set Import to Yes to load it as a project.',
  '',
  'Recipients sheet ("Issued To")',
  '- One row per name on the workbook\'s "Employees" sheet. Rows with the same Recipient name become one recipient.',
  '- Type: WORKER, MACHINE, SITE or CONTRACTOR. Set Import to No for anyone who has left.',
  '',
  'Suppliers sheet',
  '- The workbook has no supplier names. List the suppliers the store buys from; only the name is required.',
  '',
  'Anything that already exists in the platform (same project number, or same name in any case) is left as it is.',
  'Then save this file and run the dry run again.',
];

type Column = { header: string; key: string; width: number; fromWorkbook: boolean };
const PROJECT_COLUMNS: Column[] = [
  { header: 'As written in the workbook', key: 'asWritten', width: 34, fromWorkbook: true },
  { header: 'Project number', key: 'projectNumber', width: 16, fromWorkbook: false },
  { header: 'Project name', key: 'name', width: 34, fromWorkbook: false },
  { header: 'Import', key: 'include', width: 10, fromWorkbook: false },
];
const RECIPIENT_COLUMNS: Column[] = [
  { header: 'As written in the workbook', key: 'asWritten', width: 28, fromWorkbook: true },
  { header: 'Recipient name', key: 'name', width: 28, fromWorkbook: false },
  { header: 'Type', key: 'type', width: 16, fromWorkbook: false },
  { header: 'Import', key: 'include', width: 10, fromWorkbook: false },
];
const SUPPLIER_COLUMNS: Column[] = [
  { header: 'Supplier name', key: 'name', width: 34, fromWorkbook: false },
  { header: 'Contact name', key: 'contactName', width: 24, fromWorkbook: false },
  { header: 'Contact email', key: 'contactEmail', width: 30, fromWorkbook: false },
  { header: 'Contact phone', key: 'contactPhone', width: 18, fromWorkbook: false },
];

function sheet(wb: ExcelJS.Workbook, name: string, columns: Column[], rows: Array<Record<string, unknown>>, lists: Record<string, string[]>) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns.map(({ header, key, width }) => ({ header, key, width }));
  for (const r of rows) ws.addRow(r);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const header = ws.getRow(1);
  header.font = { bold: true };
  columns.forEach((c, i) => {
    header.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.fromWorkbook ? 'FFD9D9D9' : 'FFFFF2CC' } };
    if (c.fromWorkbook) {
      for (let r = 2; r <= rows.length + 1; r++) ws.getRow(r).getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    }
    const options = lists[c.key];
    // Room for rows typed in later, such as new suppliers.
    if (options) {
      for (let r = 2; r <= Math.max(rows.length + 1, 200); r++) {
        ws.getRow(r).getCell(i + 1).dataValidation = {
          type: 'list', allowBlank: true, formulae: [`"${options.join(',')}"`],
          showErrorMessage: true, errorStyle: 'stop', errorTitle: c.header, error: `Choose one of ${options.join(', ')}.`,
        };
      }
    }
  });
}

const yesNo = (b: boolean) => (b ? 'Yes' : 'No');

export async function writeMasterDataFile(path: string, data: MasterData): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const readme = wb.addWorksheet('Read me');
  readme.getColumn(1).width = 120;
  README.forEach((line, i) => { readme.getRow(i + 1).getCell(1).value = line; });
  readme.getRow(1).font = { bold: true, size: 14 };

  sheet(wb, 'Projects', PROJECT_COLUMNS, data.projects.map((p) => ({ ...p, include: yesNo(p.include) })), { include: ['Yes', 'No'] });
  sheet(wb, 'Recipients', RECIPIENT_COLUMNS, data.recipients.map((r) => ({ ...r, include: yesNo(r.include) })), { type: RECIPIENT_TYPES, include: ['Yes', 'No'] });
  sheet(wb, 'Suppliers', SUPPLIER_COLUMNS, data.suppliers.map((s) => ({ ...s })), {});
  await wb.xlsx.writeFile(path);
}

function rowsOf(ws: ExcelJS.Worksheet | undefined): Array<{ row: number; get: (header: string) => string | null }> {
  if (!ws) return [];
  const cols = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => { const t = textOf(cell.value); if (t) cols.set(t.toLowerCase(), col); });
  const out: Array<{ row: number; get: (header: string) => string | null }> = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (header: string) => { const c = cols.get(header.toLowerCase()); return c ? textOf(row.getCell(c).value) : null; };
    if ([...cols.values()].some((c) => textOf(row.getCell(c).value))) out.push({ row: r, get });
  }
  return out;
}

const isYes = (v: string | null) => /^(y|yes|true|1)$/i.test(v ?? '');

export async function readMasterDataFile(path: string): Promise<{ data: MasterData; problems: Problem[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return readMasterDataSheets(wb);
}

export function readMasterDataSheets(wb: ExcelJS.Workbook): { data: MasterData; problems: Problem[] } {
  const problems: Problem[] = [];
  for (const name of ['Projects', 'Recipients', 'Suppliers']) {
    if (!wb.getWorksheet(name)) problems.push({ code: 'MAPPING_SHEET_MISSING', sheet: name, detail: `master-data.xlsx has no "${name}" sheet` });
  }
  const data: MasterData = {
    projects: rowsOf(wb.getWorksheet('Projects')).map(({ row, get }) => ({
      row, asWritten: get('As written in the workbook') ?? '', projectNumber: get('Project number'), name: get('Project name'), include: isYes(get('Import')),
    })),
    recipients: rowsOf(wb.getWorksheet('Recipients')).map(({ row, get }) => ({
      row, asWritten: get('As written in the workbook') ?? '', name: get('Recipient name'),
      type: get('Type')?.toUpperCase() ?? null, include: isYes(get('Import')),
    })),
    suppliers: rowsOf(wb.getWorksheet('Suppliers')).map(({ row, get }) => ({
      row, name: get('Supplier name'), contactName: get('Contact name'), contactEmail: get('Contact email'), contactPhone: get('Contact phone'),
    })),
  };
  return { data, problems };
}

// ── Checking it ───────────────────────────────────────────────────────

/**
 * What the import would load, and what is wrong with the file. Rows marked
 * Import = No are ignored. Names that differ only in case or spacing are one.
 */
export function applyMasterData(lists: WorkbookLists | undefined, data: MasterData): { plan: MasterDataPlan; problems: Problem[] } {
  const problems: Problem[] = [];
  const plan: MasterDataPlan = { projects: [], recipients: [], suppliers: [] };
  const bad = (sheet: string, row: number | undefined, detail: string, name?: string | null) =>
    problems.push({ code: 'MASTER_DATA_INVALID', sheet, row, name, detail });

  // Entries added to the workbook since the file was made are not imported until listed.
  if (lists) {
    const listedProjects = new Set(data.projects.map((p) => tidy(p.asWritten).toLowerCase()));
    for (const e of lists.projects) {
      if (!listedProjects.has(tidy(e.text).toLowerCase())) {
        problems.push({ code: 'MASTER_DATA_NOT_LISTED', sheet: 'Project No.', row: e.row, name: e.text, detail: 'Not on the Projects sheet of master-data.xlsx, so not imported' });
      }
    }
    const listedRecipients = new Set(data.recipients.map((r) => tidy(r.asWritten).toLowerCase()));
    for (const e of lists.employees) {
      if (!listedRecipients.has(tidy(e.text).toLowerCase())) {
        problems.push({ code: 'MASTER_DATA_NOT_LISTED', sheet: 'Employees', row: e.row, name: e.text, detail: 'Not on the Recipients sheet of master-data.xlsx, so not imported' });
      }
    }
  }

  const projects = new Map<string, { name: string | null; row?: number }>();
  for (const p of data.projects) {
    if (!p.include) continue;
    if (!p.projectNumber) { bad('Projects', p.row, 'Import is Yes but there is no project number', p.asWritten); continue; }
    if (p.projectNumber.length > 64) { bad('Projects', p.row, 'Project number longer than 64 characters', p.asWritten); continue; }
    if ((p.name ?? '').length > 200) { bad('Projects', p.row, 'Project name longer than 200 characters', p.asWritten); continue; }
    const key = p.projectNumber.toUpperCase();
    const earlier = projects.get(key);
    if (earlier) {
      if ((earlier.name ?? '') !== (p.name ?? '')) bad('Projects', p.row, `${p.projectNumber} is also on row ${earlier.row} with another name; set one of them to No`, p.asWritten);
      continue;
    }
    projects.set(key, { name: p.name, row: p.row });
    plan.projects.push({ projectNumber: p.projectNumber, name: p.name });
  }

  const recipients = new Map<string, RecipientType>();
  for (const r of data.recipients) {
    if (!r.include) continue;
    if (!r.name) { bad('Recipients', r.row, 'Import is Yes but there is no recipient name', r.asWritten); continue; }
    if (r.name.length > 200) { bad('Recipients', r.row, 'Recipient name longer than 200 characters', r.asWritten); continue; }
    if (!r.type || !RECIPIENT_TYPES.includes(r.type as RecipientType)) {
      bad('Recipients', r.row, `Type "${r.type ?? ''}" is not one of ${RECIPIENT_TYPES.join(', ')}`, r.asWritten);
      continue;
    }
    const key = tidy(r.name).toLowerCase();
    const earlier = recipients.get(key);
    if (earlier) {
      if (earlier !== r.type) bad('Recipients', r.row, `"${r.name}" is given two types: ${earlier} and ${r.type}`, r.asWritten);
      continue;
    }
    recipients.set(key, r.type as RecipientType);
    plan.recipients.push({ name: tidy(r.name), type: r.type as RecipientType });
  }

  const suppliers = new Set<string>();
  for (const s of data.suppliers) {
    if (!s.name) { bad('Suppliers', s.row, 'Contact details but no supplier name'); continue; }
    if (s.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.contactEmail)) { bad('Suppliers', s.row, `"${s.contactEmail}" is not an email address`, s.name); continue; }
    const key = tidy(s.name).toLowerCase();
    if (suppliers.has(key)) { problems.push({ code: 'MASTER_DATA_NOT_LISTED', sheet: 'Suppliers', row: s.row, name: s.name, detail: 'Listed twice; loaded once' }); continue; }
    suppliers.add(key);
    plan.suppliers.push({ name: tidy(s.name), contactName: s.contactName, contactEmail: s.contactEmail, contactPhone: s.contactPhone });
  }

  return { plan, problems };
}
