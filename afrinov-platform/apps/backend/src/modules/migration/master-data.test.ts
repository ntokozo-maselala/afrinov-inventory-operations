// Projects, recipients and suppliers for the import (master-data.xlsx), on
// made-up lists. No real names.
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readWorkbookLists, type WorkbookLists } from './workbook-reader.js';
import {
  applyMasterData, parseProjectEntry, readMasterDataFile, suggestMasterData, tidyName, writeMasterDataFile, type MasterData,
} from './master-data.js';
import type { Problem, ProblemCode } from './workbook-analysis.js';

const LISTS: WorkbookLists = {
  projects: [
    { row: 1, text: '1118 - Workshop PPE' },
    { row: 2, text: 'Client Mine' },
    { row: 3, text: 'AFRI-1381' },
    { row: 4, text: '2021-0FFICE MAINTENANCE' },
    { row: 5, text: 'afri-1381' },
  ],
  employees: [
    { row: 2, text: 'ALEX' },
    { row: 3, text: 'sam lee' },
    { row: 4, text: 'alex' },
    { row: 5, text: 'forklift' },
  ],
  missingSheets: [],
};

const codes = (problems: Problem[], code: ProblemCode) => problems.filter((p) => p.code === code);

describe('reading the workbook lists', () => {
  it('reads every entry and drops the header', () => {
    const wb = new ExcelJS.Workbook();
    const p = wb.addWorksheet('Project No.');
    p.getCell('B1').value = '1118 - Workshop PPE';
    p.getCell('B2').value = 'AFRI-1381';
    const e = wb.addWorksheet('Employees');
    e.getCell('B1').value = 'Names';
    e.getCell('B2').value = 'Alex';
    expect(readWorkbookLists(wb)).toEqual({
      projects: [{ row: 1, text: '1118 - Workshop PPE' }, { row: 2, text: 'AFRI-1381' }],
      employees: [{ row: 2, text: 'Alex' }],
      missingSheets: [],
    });
    expect(readWorkbookLists(new ExcelJS.Workbook()).missingSheets).toEqual(['Project No.', 'Employees']);
  });
});

describe('suggestions', () => {
  it('splits project numbers from names', () => {
    expect(parseProjectEntry('1118 - Workshop PPE')).toEqual({ projectNumber: '1118', name: 'Workshop PPE' });
    expect(parseProjectEntry('afri-1381')).toEqual({ projectNumber: 'AFRI-1381', name: null });
    expect(parseProjectEntry('AI-1119: Pump repair')).toEqual({ projectNumber: 'AI-1119', name: 'Pump repair' });
    expect(parseProjectEntry('2021-0FFICE MAINTENANCE')).toEqual({ projectNumber: '2021', name: 'OFFICE MAINTENANCE' });
    expect(parseProjectEntry('Client Mine')).toEqual({ projectNumber: null, name: 'Client Mine' });
  });

  it('tidies names typed all in capitals or all in lower case', () => {
    expect(tidyName('  ALEX  ')).toBe('Alex');
    expect(tidyName('sam lee-smith')).toBe('Sam Lee-Smith');
    expect(tidyName('McDonald')).toBe('McDonald');
  });

  it('leaves out repeated numbers and entries with no number, and groups name spellings', () => {
    const m = suggestMasterData(LISTS);
    expect(m.projects.map((p) => [p.projectNumber, p.include])).toEqual([
      ['1118', true], [null, false], ['AFRI-1381', true], ['2021', true], ['AFRI-1381', false],
    ]);
    expect(m.recipients.map((r) => [r.asWritten, r.name, r.type])).toEqual([
      ['ALEX', 'Alex', 'WORKER'], ['sam lee', 'Sam Lee', 'WORKER'], ['alex', 'Alex', 'WORKER'], ['forklift', 'Forklift', 'WORKER'],
    ]);
    expect(m.suppliers).toEqual([]);
  });
});

describe('master-data.xlsx', () => {
  async function roundTrip(data: MasterData) {
    const dir = await mkdtemp(join(tmpdir(), 'master-'));
    try {
      await writeMasterDataFile(join(dir, 'master-data.xlsx'), data);
      return await readMasterDataFile(join(dir, 'master-data.xlsx'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('survives the round trip through Excel', async () => {
    const data = suggestMasterData(LISTS);
    data.suppliers.push({ name: 'Bolt Supplies', contactName: 'Jo', contactEmail: 'jo@example.com', contactPhone: '011 000 0000' });
    const read = await roundTrip(data);
    expect(read.problems).toEqual([]);
    const strip = <T extends { row?: number }>(rows: T[]) => rows.map(({ row: _row, ...rest }) => rest);
    expect(strip(read.data.projects)).toEqual(data.projects.map((p) => ({ ...p, name: p.name ?? null })));
    expect(strip(read.data.recipients)).toEqual(data.recipients);
    expect(strip(read.data.suppliers)).toEqual(data.suppliers);
  });

  it('plans one project per number and one recipient per name', async () => {
    const data = suggestMasterData(LISTS);
    data.recipients[3]!.type = 'MACHINE';
    const { data: read } = await roundTrip(data);
    const { plan, problems } = applyMasterData(LISTS, read);
    expect(problems).toEqual([]);
    expect(plan.projects).toEqual([
      { projectNumber: '1118', name: 'Workshop PPE' }, { projectNumber: 'AFRI-1381', name: null }, { projectNumber: '2021', name: 'OFFICE MAINTENANCE' },
    ]);
    expect(plan.recipients).toEqual([
      { name: 'Alex', type: 'WORKER' }, { name: 'Sam Lee', type: 'WORKER' }, { name: 'Forklift', type: 'MACHINE' },
    ]);
  });
});

describe('checking master-data.xlsx', () => {
  it('blocks rows marked for import that cannot be loaded', () => {
    const data = suggestMasterData(LISTS);
    data.projects[1]!.include = true; // no number
    data.recipients[1]!.type = 'VISITOR';
    data.recipients[2]!.type = 'CONTRACTOR'; // Alex again, as another type
    data.suppliers.push({ name: null, contactName: 'Jo', contactEmail: null, contactPhone: null, row: 2 });
    data.suppliers.push({ name: 'Bad mail', contactName: null, contactEmail: 'not-an-email', contactPhone: null, row: 3 });
    const { problems } = applyMasterData(LISTS, data);
    expect(codes(problems, 'MASTER_DATA_INVALID').map((p) => p.detail)).toEqual([
      'Import is Yes but there is no project number',
      expect.stringContaining('Type "VISITOR"'),
      '"Alex" is given two types: WORKER and CONTRACTOR',
      'Contact details but no supplier name',
      '"not-an-email" is not an email address',
    ]);
  });

  it('notes workbook entries missing from the file, and a supplier listed twice', () => {
    const data = suggestMasterData(LISTS);
    data.recipients = data.recipients.filter((r) => r.asWritten !== 'forklift');
    data.suppliers.push({ name: 'Bolt Supplies', contactName: null, contactEmail: null, contactPhone: null });
    data.suppliers.push({ name: 'BOLT  supplies', contactName: null, contactEmail: null, contactPhone: null });
    const { plan, problems } = applyMasterData(LISTS, data);
    expect(codes(problems, 'MASTER_DATA_NOT_LISTED').map((p) => p.name)).toEqual(['forklift', 'BOLT  supplies']);
    expect(plan.suppliers.map((s) => s.name)).toEqual(['Bolt Supplies']);
  });

  it('ignores rows set to No', () => {
    const data = suggestMasterData(LISTS);
    for (const r of data.recipients) r.include = false;
    expect(applyMasterData(LISTS, data).plan.recipients).toEqual([]);
  });
});
