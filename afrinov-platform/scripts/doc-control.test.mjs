// Tests for scripts/doc-control.mjs. Run: npm run docs:test (node --test, no dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REGISTER_PAGE,
  bodyHash,
  brokenLinks,
  displayDay,
  editorName,
  inScope,
  linkTo,
  matches,
  tableCell,
  nextId,
  parseDocument,
  planStamp,
  saToday,
  titleOf,
  typeOf,
} from './doc-control.mjs';

const register = () => ({
  idPrefix: 'AFRI-OMS',
  scope: { include: ['**/*.md'], exclude: ['AGENTS.md', 'docs/document-control/templates/**'] },
  people: { 'git-login': 'Display Name' },
  sections: [
    { code: '08', path: 'afrinov-docs/docs/08-api/', type: 'API Reference' },
    { code: 'ARC', path: 'docs/archive/', type: 'Archived Document' },
    { code: 'DOC', path: 'docs/document-control/', type: 'Document Control' },
    { code: 'GEN', path: '', type: 'General' },
  ],
  typeRules: [
    { match: 'docs/archive/**', type: 'Archived Document' },
    { match: '**/README.md', type: 'Index' },
  ],
  documents: [],
  retired: [],
});

const stamp = (reg, files, today = '2026-11-26', editor = 'Ntokozo Maselala') =>
  planStamp({ register: reg, files: new Map(Object.entries(files)), today, editor });

/** Applies a plan's writes, as the CLI does, and returns the files and register after it. */
const apply = (reg, files, plan) => ({
  reg: plan.register,
  files: { ...files, ...Object.fromEntries(plan.writes) },
});

test('globs: ** spans folders, * stays within a name', () => {
  assert.ok(matches('**/README.md', 'README.md'));
  assert.ok(matches('**/README.md', 'docs/archive/README.md'));
  assert.ok(!matches('README.md', 'docs/README.md'));
  assert.ok(matches('docs/archive/**', 'docs/archive/a/b.md'));
  assert.ok(matches('**/*roadmap*.md', 'a/b/procurement-roadmap.md'));
  assert.ok(!matches('*.md', 'a/b.md'));
});

test('scope leaves tool files and templates out', () => {
  const r = register();
  assert.ok(inScope(r, 'docs/README.md'));
  assert.ok(!inScope(r, 'AGENTS.md'));
  assert.ok(!inScope(r, 'docs/document-control/templates/general.md'));
  assert.ok(!inScope(r, 'src/a.ts'));
});

test('types come from the first matching rule, then the section', () => {
  const r = register();
  assert.equal(typeOf(r, 'docs/archive/README.md'), 'Archived Document');
  assert.equal(typeOf(r, 'afrinov-docs/docs/08-api/README.md'), 'Index');
  assert.equal(typeOf(r, 'afrinov-docs/docs/08-api/error-model.md'), 'API Reference');
  assert.equal(typeOf(r, 'gap-analysis.md'), 'General');
});

test('IDs count on from the highest number, retired ones included', () => {
  const r = register();
  r.documents.push({ id: 'AFRI-OMS-08-001', path: 'x', type: 't' });
  r.retired.push({ id: 'AFRI-OMS-08-007', path: 'y', retired: '2026-11-01' });
  assert.equal(nextId(r, '08'), 'AFRI-OMS-08-008');
  assert.equal(nextId(r, 'GEN'), 'AFRI-OMS-GEN-001');
});

test('the fingerprint ignores line endings', () => {
  assert.equal(bodyHash('# A\r\n\r\ntext\r\n'), bodyHash('# A\n\ntext\n'));
  assert.notEqual(bodyHash('# A\n'), bodyHash('# B\n'));
});

test('titles lose Markdown marks; a file without a heading is named from its file', () => {
  assert.equal(titleOf('# The `issue` [rules](x.md) **now**\n', 'a.md'), 'The issue rules now');
  assert.equal(titleOf('no heading\n', 'docs/my-notes_file.md'), 'my notes file');
  assert.equal(displayDay('2026-11-26'), '26/11/2026');
});

test('South African today is UTC+2', () => {
  assert.equal(saToday(Date.parse('2026-11-26T21:59:00Z')), '2026-11-26');
  assert.equal(saToday(Date.parse('2026-11-26T22:00:00Z')), '2026-11-27');
});

test('the editor is named through the people map', () => {
  assert.equal(editorName(register(), 'git-login'), 'Display Name');
  assert.equal(editorName(register(), 'Someone Else'), 'Someone Else');
  assert.equal(editorName(register(), ''), null);
});

test('a first stamp registers, numbers and heads every document, and writes the register page', () => {
  const files = { 'afrinov-docs/docs/08-api/error-model.md': '# Error Model\n\nBody.\n', 'gap-analysis.md': '# Gap Analysis\n' };
  const plan = stamp(register(), files);
  assert.deepEqual(
    plan.register.documents.map((d) => [d.id, d.path]),
    [
      ['AFRI-OMS-08-001', 'afrinov-docs/docs/08-api/error-model.md'],
      ['AFRI-OMS-DOC-001', REGISTER_PAGE],
      ['AFRI-OMS-GEN-001', 'gap-analysis.md'],
    ],
  );
  const out = plan.writes.get('afrinov-docs/docs/08-api/error-model.md');
  assert.match(out, /<b>AFRI-OMS-08-001<\/b>/);
  assert.match(out, /<b><i>Error Model<\/i><\/b><br><i>API Reference<\/i>/);
  assert.match(out, /<b>26\/11\/2026<\/b><br><sub>by Ntokozo Maselala<\/sub>/);
  assert.match(out, /src="\.\.\/\.\.\/\.\.\/docs\/document-control\/assets\/afrinov-logo-header\.png"/);
  assert.ok(out.endsWith('\n\n# Error Model\n\nBody.\n'));
  assert.match(plan.writes.get(REGISTER_PAGE), /\| AFRI-OMS-GEN-001 \| \[Gap Analysis\]\(\.\.\/\.\.\/gap-analysis\.md\) \| General \| 26\/11\/2026 \| Ntokozo Maselala \|/);
});

test('a second stamp with no text change writes nothing and the check passes, even on a later day', () => {
  const first = stamp(register(), { 'a.md': '# A\n\ntext\n' });
  const s = apply(register(), { 'a.md': '# A\n\ntext\n' }, first);
  const again = planStamp({ register: s.reg, files: new Map(Object.entries(s.files)), today: '2026-12-31', editor: null });
  assert.equal(again.writes.size, 0);
  assert.deepEqual(again.problems, []);
  assert.equal(again.registerChanged, false);
});

test('a text change moves the date and the updater; a check names the file', () => {
  const first = stamp(register(), { 'a.md': '# A\n\ntext\n' });
  const s = apply(register(), {}, first);
  s.files['a.md'] = s.files['a.md'].replace('text', 'new text');
  const check = planStamp({ register: s.reg, files: new Map(Object.entries(s.files)), today: '2026-12-02', editor: null });
  assert.deepEqual(check.problems, ['a.md: text changed since its header was written']);
  const restamp = stamp(s.reg, s.files, '2026-12-02', 'Sbonakaliso Ngcobo');
  assert.match(restamp.writes.get('a.md'), /<b>02\/12\/2026<\/b><br><sub>by Sbonakaliso Ngcobo<\/sub>/);
  assert.match(restamp.writes.get(REGISTER_PAGE), /02\/12\/2026 \| Sbonakaliso Ngcobo/);
});

test('a hand edit to the header is put back without moving the date', () => {
  const first = stamp(register(), { 'a.md': '# A\n' });
  const s = apply(register(), {}, first);
  s.files['a.md'] = s.files['a.md'].replace('<i>General</i>', '<i>Edited</i>');
  const check = planStamp({ register: s.reg, files: new Map(Object.entries(s.files)), today: '2026-12-02', editor: null });
  assert.deepEqual(check.problems, ['a.md: header out of step with the register']);
  const fixed = stamp(s.reg, s.files, '2026-12-02', 'Other');
  assert.match(fixed.writes.get('a.md'), /26\/11\/2026<\/b><br><sub>by Ntokozo Maselala/);
});

test('a type changed in the register rewrites the header but keeps the date', () => {
  const first = stamp(register(), { 'a.md': '# A\n' });
  const s = apply(register(), {}, first);
  s.reg.documents.find((d) => d.path === 'a.md').type = 'Roadmap';
  const plan = stamp(s.reg, s.files, '2026-12-02', 'Other');
  assert.match(plan.writes.get('a.md'), /<i>Roadmap<\/i>.*26\/11\/2026/s);
});

test('a moved document keeps its ID and date; a removed one is retired', () => {
  const first = stamp(register(), { 'a.md': '# A\n', 'b.md': '# B\n' });
  const s = apply(register(), {}, first);
  const idA = s.reg.documents.find((d) => d.path === 'a.md').id;
  const files = { 'docs/archive/a.md': s.files['a.md'], [REGISTER_PAGE]: s.files[REGISTER_PAGE] };
  const plan = stamp(s.reg, files, '2026-12-02', 'Other');
  const moved = plan.register.documents.find((d) => d.path === 'docs/archive/a.md');
  assert.equal(moved.id, idA);
  assert.match(plan.writes.get('docs/archive/a.md'), /26\/11\/2026/);
  assert.deepEqual(plan.register.retired.map((r) => r.path), ['b.md']);
  // The retired number is not given out again.
  const after = stamp(plan.register, { ...files, 'c.md': '# C\n' }, '2026-12-02', 'Other');
  assert.equal(after.register.documents.find((d) => d.path === 'c.md').id, 'AFRI-OMS-GEN-003');
});

test('a header copied into a new document starts afresh with its own ID', () => {
  const first = stamp(register(), { 'a.md': '# A\n' });
  const s = apply(register(), {}, first);
  const plan = stamp(s.reg, { ...s.files, 'copy.md': s.files['a.md'] }, '2026-12-02', 'Other');
  const out = plan.writes.get('copy.md');
  assert.match(out, /AFRI-OMS-GEN-002/);
  assert.match(out, /02\/12\/2026<\/b><br><sub>by Other/);
});

test('a byte-order mark and Windows line endings are kept', () => {
  const plan = stamp(register(), { 'a.md': '﻿# A\r\n\r\ntext\r\n' });
  const out = plan.writes.get('a.md');
  assert.ok(out.startsWith('﻿<!-- afrinov:document-control'));
  assert.ok(!/[^\r]\n/.test(out), 'every line ends CRLF');
  const parsed = parseDocument(out);
  assert.equal(parsed.body, '# A\n\ntext\n');
});

test('a date in the future fails the check', () => {
  const first = stamp(register(), { 'a.md': '# A\n' }, '2027-01-01');
  const s = apply(register(), {}, first);
  const check = planStamp({ register: s.reg, files: new Map(Object.entries(s.files)), today: '2026-11-26', editor: null });
  assert.ok(check.problems.some((p) => p.includes('in the future')));
});

test('titles with HTML characters are escaped in the header', () => {
  const plan = stamp(register(), { 'a.md': '# Receiving & <issuing>\n' });
  assert.match(plan.writes.get('a.md'), /Receiving &amp; &lt;issuing&gt;/);
});

test('register cells escape backslashes before pipes, and links encode each part', () => {
  assert.equal(tableCell('a | b'), 'a \\| b');
  // A title holding "\|" must not become "\\|", where the pipe would end the cell.
  assert.equal(tableCell('a \\| b'), 'a \\\\\\| b');
  assert.equal(tableCell('ends in \\'), 'ends in \\\\');
  assert.equal(
    linkTo(REGISTER_PAGE, 'docs/archive/Production Readiness & Deployment (old).md'),
    '../archive/Production%20Readiness%20%26%20Deployment%20%28old%29.md',
  );
});

test('broken links: relative targets only, code ignored, anchors and spaces handled', () => {
  const have = new Set(['docs/a.md', 'docs/b c.md', 'img/x.png']);
  const content = [
    '[ok](a.md#part) [space](b%20c.md) [gone](missing.md) [web](https://x.y) [here](#top)',
    '<img src="../img/x.png"> `[code](nope.md)`',
    '```',
    '[fenced](nope2.md)',
    '```',
  ].join('\n');
  assert.deepEqual(brokenLinks('docs/index.md', content, (p) => have.has(p)), ['missing.md']);
});
