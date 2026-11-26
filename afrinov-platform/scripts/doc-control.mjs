#!/usr/bin/env node
// Afrinov document control.
//
// Gives every controlled Markdown document the Afrinov header (logo, document
// ID, title and type, the date of its last change and who made it) and keeps
// it current. The header is written from docs/document-control/register.json
// and the document itself; nobody edits it by hand.
//
//   npm run docs:stamp            write or refresh every header and the register
//   npm run docs:check            fail if any header is missing or out of date (CI)
//   npm run docs:logo             rebuild the header logo from the official logo
//   node scripts/doc-control.mjs --links   list relative links that lead nowhere
//
// "Last updated" moves only when a document's own text (everything under the
// header) changes: the header keeps a fingerprint of that text, and a stamp
// that finds a different fingerprint sets today's South African date and the
// person running it. A change to the register (an ID or type) rewrites the
// header but keeps the date. See docs/document-control/README.md.
//
// Node built-ins only, so CI runs it without `npm ci`.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

export const REGISTER_PATH = 'docs/document-control/register.json';
export const REGISTER_PAGE = 'docs/document-control/DOCUMENT_REGISTER.md';
export const LOGO_SOURCE = 'afrinov-platform/apps/frontend/src/assets/afrinov-logo.png';
export const LOGO_HEADER = 'docs/document-control/assets/afrinov-logo-header.png';

const OPEN =
  '<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->';
const BLOCK_RE =
  /^<!-- afrinov:document-control[^\n]*-->[\s\S]*?<!-- \/afrinov:document-control (.*?) -->[ \t]*(?:\r?\n)*/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------- pure parts

/** A glob with `**` (any folders), `*` (within one name) and literal text. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export const matches = (glob, path) => globToRegExp(glob).test(path);

export function inScope(register, path) {
  const { include, exclude } = register.scope;
  return include.some((g) => matches(g, path)) && !exclude.some((g) => matches(g, path));
}

/** The register section a path belongs to: the longest matching folder prefix. */
export function sectionOf(register, path) {
  let best;
  for (const s of register.sections) {
    if (path.startsWith(s.path) && (!best || s.path.length > best.path.length)) best = s;
  }
  if (!best) throw new Error(`No section in the register covers ${path}`);
  return best;
}

export function typeOf(register, path) {
  const rule = register.typeRules.find((r) => matches(r.match, path));
  return rule ? rule.type : sectionOf(register, path).type;
}

export function nextId(register, code) {
  const prefix = `${register.idPrefix}-${code}-`;
  const serials = [...register.documents, ...register.retired]
    .filter((d) => d.id.startsWith(prefix))
    .map((d) => Number(d.id.slice(prefix.length)));
  const next = (serials.length ? Math.max(...serials) : 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

const toLf = (s) => s.replace(/\r\n/g, '\n');

/** Splits a document into its BOM, its header attributes (if any) and its body. */
export function parseDocument(content) {
  const bom = content.startsWith('﻿') ? '﻿' : '';
  const rest = toLf(content.slice(bom.length));
  const m = BLOCK_RE.exec(rest);
  const meta = m ? parseAttrs(m[1]) : null;
  const body = (m ? rest.slice(m[0].length) : rest).replace(/^\n+/, '');
  return { bom, meta, body, crlf: content.includes('\r\n') };
}

function parseAttrs(text) {
  const out = {};
  for (const m of text.matchAll(/(\w+)=(?:"([^"]*)"|(\S+))/g)) out[m[1]] = m[2] ?? m[3];
  return out;
}

export const bodyHash = (body) => createHash('sha256').update(toLf(body)).digest('hex').slice(0, 12);

/** The document's title: its first level-one heading, without Markdown marks. */
export function titleOf(body, path) {
  const h1 = /^# +(.+?)\s*#*\s*$/m.exec(body);
  const raw = h1 ? h1[1] : posix.basename(path, '.md').replace(/[-_]+/g, ' ');
  return raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .replace(/(^|\s)_+|_+(\s|$)/g, '$1$2')
    .trim();
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 2026-11-26 → 26/11/2026, the day-first form Afrinov's own documents print. */
export const displayDay = (day) => day.split('-').reverse().join('/');

export function renderBlock({ id, title, type, updated, by, hash, logo }) {
  return [
    OPEN,
    '<table>',
    '<tr>',
    `<td width="104" align="center"><img src="${logo}" alt="Afrinov" width="80"><br><sub>${'&nbsp;'.repeat(24)}</sub></td>`,
    // GitHub gives every image max-width:100%, so in a table squeezed onto a
    // phone the logo has no minimum width of its own and shrank to nothing. The
    // line of no-break spaces under it is invisible and gives the cell one.
    `<td align="center"><sub>Document ID</sub><br><b>${id}</b></td>`,
    `<td align="center"><b><i>${escapeHtml(title)}</i></b><br><i>${escapeHtml(type)}</i></td>`,
    `<td align="center"><sub>Last updated</sub><br><b>${displayDay(updated)}</b><br><sub>by ${escapeHtml(by)}</sub></td>`,
    '</tr>',
    '</table>',
    `<!-- /afrinov:document-control id=${id} updated=${updated} by="${by.replace(/"/g, "'")}" body=${hash} -->`,
  ].join('\n');
}

const logoFrom = (path) => posix.relative(posix.dirname(path), LOGO_HEADER);

function serialize({ bom, body, crlf }, block) {
  const text = `${block}\n\n${body}`;
  return bom + (crlf ? text.replace(/\n/g, '\r\n') : text);
}

/** The editor's display name: git's user.name through the register's people map. */
export function editorName(register, gitName) {
  if (!gitName) return null;
  return register.people[gitName] ?? gitName;
}

/** Text safe inside a Markdown table cell: backslashes first, then pipes. */
export const tableCell = (v) => v.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

/** A relative link with each part percent-encoded, so spaces and brackets can't end it. */
export const linkTo = (from, to) =>
  posix
    .relative(posix.dirname(from), to)
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/\(/g, '%28').replace(/\)/g, '%29'))
    .join('/');

function registerPageBody(register, stamped) {
  const rows = register.documents
    .filter((d) => d.path !== REGISTER_PAGE)
    .map((d) => {
      const s = stamped.get(d.path);
      const link = linkTo(REGISTER_PAGE, d.path);
      const cell = tableCell;
      return `| ${d.id} | [${cell(s.title)}](${link}) | ${cell(d.type)} | ${displayDay(s.updated)} | ${cell(s.by)} |`;
    });
  const retired = register.retired.length
    ? ['| ID | Last path | Retired |', '|---|---|---|', ...register.retired.map((r) => `| ${r.id} | \`${r.path}\` | ${displayDay(r.retired)} |`)]
    : ['None. An ID is never reused: a document that is removed keeps its number here.'];
  return [
    '# Document Register',
    '',
    'Every controlled document, its ID, and when its content last changed and by whom. This page is',
    'written by `npm run docs:stamp` from [`register.json`](register.json) and the documents',
    'themselves; do not edit it by hand. How IDs are given out and kept: [README.md](README.md).',
    '',
    `> **Interim IDs.** \`${register.idPrefix}-…\` numbers belong to this system's documents until`,
    '> Afrinov document control allocates numbers from the company register (the scheme behind',
    '> numbers such as AFRI-01D-10-01-088). Changing them is one edit to `register.json`.',
    '',
    `${rows.length} documents.`,
    '',
    '| ID | Title | Type | Last updated | By |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    '## Retired IDs',
    '',
    ...retired,
    '',
  ].join('\n');
}

/**
 * Works out every header and the register without touching the disk.
 * files: Map of path → current content, for every in-scope document on disk.
 * editor: who is stamping (null in a check, where nothing should change).
 */
export function planStamp({ register: input, files, today, editor }) {
  const register = structuredClone(input);
  const notes = [];
  const writes = new Map();
  const all = new Map(files);
  if (!all.has(REGISTER_PAGE)) all.set(REGISTER_PAGE, '');

  const byPath = () => new Map(register.documents.map((d) => [d.path, d]));
  const parsed = new Map([...all].map(([p, c]) => [p, parseDocument(c)]));

  // A file not yet registered whose header names an ID whose file is gone was moved:
  // the ID follows the document.
  for (const [path, p] of parsed) {
    if (byPath().has(path) || !p.meta?.id) continue;
    const entry = register.documents.find((d) => d.id === p.meta.id);
    if (entry && !all.has(entry.path)) {
      notes.push(`moved ${entry.id}: ${entry.path} -> ${path}`);
      entry.path = path;
    }
  }
  // A registered document whose file is gone is retired; its ID is never reused.
  for (const entry of [...register.documents]) {
    if (all.has(entry.path)) continue;
    register.documents = register.documents.filter((d) => d !== entry);
    register.retired.push({ id: entry.id, path: entry.path, retired: today });
    notes.push(`retired ${entry.id}: ${entry.path} (file no longer exists)`);
  }
  // A new document gets the next number in its section.
  const fresh = new Set();
  for (const path of [...all.keys()].sort()) {
    if (byPath().has(path)) continue;
    const id = nextId(register, sectionOf(register, path).code);
    register.documents.push({ id, path, type: typeOf(register, path) });
    fresh.add(path);
    notes.push(`registered ${id}: ${path}`);
  }
  register.documents.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  register.retired.sort((a, b) => (a.id < b.id ? -1 : 1));

  const index = byPath();
  const stamped = new Map();
  const problems = [];
  const stampOne = (path, content) => {
    const p = parseDocument(content);
    const entry = index.get(path);
    const hash = bodyHash(p.body);
    // Keep the date only for the same text under a header that belongs to this
    // document (a header copied from another document starts afresh).
    const same = p.meta && p.meta.body === hash && DAY_RE.test(p.meta.updated ?? '') && p.meta.by && !fresh.has(path);
    let updated = same ? p.meta.updated : today;
    let by = same ? p.meta.by : editor;
    if (!same) {
      if (!p.meta) problems.push(`${path}: no Afrinov header`);
      else if (p.meta.body !== hash) problems.push(`${path}: text changed since its header was written`);
      else problems.push(`${path}: header incomplete`);
    }
    if (same && updated > today) problems.push(`${path}: last-updated date ${updated} is in the future`);
    // Only a check (editor null) gets here without a name, and it has already
    // reported the document; a stamp refuses to start without one.
    by ??= '(unknown)';
    const block = renderBlock({ ...entry, title: titleOf(p.body, path), updated, by, hash, logo: logoFrom(path) });
    const out = serialize(p, block);
    stamped.set(path, { title: titleOf(p.body, path), updated, by });
    if (toLf(out) !== toLf(content)) {
      writes.set(path, out);
      if (same) problems.push(`${path}: header out of step with the register`);
    }
  };

  for (const [path, content] of all) if (path !== REGISTER_PAGE) stampOne(path, content);

  // The register page lists everyone else, so it is written last. It keeps its
  // own header, so its date moves only when the list does.
  const current = parseDocument(all.get(REGISTER_PAGE));
  const block = BLOCK_RE.exec(toLf(all.get(REGISTER_PAGE)).replace(/^﻿/, ''));
  const candidate = (block ? block[0] : '') + registerPageBody(register, stamped);
  // A document out of date makes the list out of date too; report the list only
  // when it is the one thing wrong, so a check names the file to look at.
  const before = problems.length;
  stampOne(REGISTER_PAGE, current.crlf ? candidate.replace(/\n/g, '\r\n') : candidate);
  if (before > 0) problems.length = before;

  const registerChanged = JSON.stringify(register) !== JSON.stringify(input);
  if (registerChanged && !notes.length) notes.push('register reordered');
  return { register, registerChanged, writes, notes, problems, stamped };
}

/** Relative links (Markdown and HTML) in a document that lead to no file. */
export function brokenLinks(path, content, exists) {
  const text = toLf(content)
    .replace(/^```[\s\S]*?^```/gm, '')
    .replace(/`[^`\n]*`/g, '');
  const targets = [
    ...[...text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]),
    ...[...text.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]),
  ];
  const out = [];
  for (const t of targets) {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(t)) continue;
    const clean = t.split('#')[0].split('?')[0];
    if (!clean) continue;
    let decoded = clean;
    try {
      decoded = decodeURIComponent(clean);
    } catch {
      /* keep as written */
    }
    const target = decoded.startsWith('/') ? decoded.slice(1) : posix.join(posix.dirname(path), decoded);
    if (!exists(posix.normalize(target))) out.push(t);
  }
  return out;
}

// ------------------------------------------------------------------ the logo

function decodePng(buf) {
  let p = 8;
  let w, h, ct, interlace;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error('Expected an 8-bit PNG');
      ct = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  if (ct !== 6 || interlace !== 0) throw new Error('Expected a non-interlaced RGBA PNG');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const px = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    const filter = raw[o];
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? cur[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      let v = raw[o + 1 + i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    cur.copy(px, y * stride);
    prev = cur;
  }
  return { w, h, px };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** The official logo on a white tile, as Afrinov's own forms print it. */
export function logoTile(png, padX = 32, padY = 28) {
  const { w, h, px } = decodePng(png);
  const W = w + padX * 2;
  const H = h + padY * 2;
  const rows = Buffer.alloc(H * (W * 3 + 1), 255);
  for (let y = 0; y < H; y++) rows[y * (W * 3 + 1)] = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const a = px[s + 3] / 255;
      const d = (y + padY) * (W * 3 + 1) + 1 + (x + padX) * 3;
      for (let k = 0; k < 3; k++) rows[d + k] = Math.round(px[s + k] * a + 255 * (1 - a));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------- the CLI

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

/** Today in South Africa (UTC+2 all year, ADR-041). */
export const saToday = (now = Date.now()) => new Date(now + 2 * 3600_000).toISOString().slice(0, 10);

function listDocuments(register) {
  return git('ls-files', '-z', '--cached', '--others', '--exclude-standard')
    .split('\0')
    .filter((p) => p && inScope(register, p) && existsSync(join(ROOT, p)))
    .sort();
}

function writeKeepingEol(path, text) {
  const full = join(ROOT, path);
  const crlf = existsSync(full) && readFileSync(full, 'utf8').includes('\r\n');
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, crlf ? toLf(text).replace(/\n/g, '\r\n') : text);
}

function main(argv) {
  const mode = argv.includes('--check') ? 'check' : argv.includes('--logo') ? 'logo' : argv.includes('--links') ? 'links' : 'stamp';

  if (mode === 'logo') {
    mkdirSync(dirname(join(ROOT, LOGO_HEADER)), { recursive: true });
    writeFileSync(join(ROOT, LOGO_HEADER), logoTile(readFileSync(join(ROOT, LOGO_SOURCE))));
    console.log(`Wrote ${LOGO_HEADER} from ${LOGO_SOURCE}`);
    return 0;
  }

  const register = JSON.parse(readFileSync(join(ROOT, REGISTER_PATH), 'utf8'));
  const paths = listDocuments(register);

  if (mode === 'links') {
    const exists = (p) => existsSync(join(ROOT, p));
    let count = 0;
    for (const p of paths) {
      const bad = brokenLinks(p, readFileSync(join(ROOT, p), 'utf8'), exists);
      for (const b of bad) console.log(`${p}: ${b}`);
      count += bad.length;
    }
    console.log(`${count} relative link(s) lead nowhere, in ${paths.length} documents.`);
    return 0;
  }

  const files = new Map(paths.map((p) => [p, readFileSync(join(ROOT, p), 'utf8')]));
  const today = saToday();

  if (mode === 'check') {
    const plan = planStamp({ register, files, today, editor: null });
    const problems = [...plan.problems, ...plan.notes.map((n) => `register: ${n}`)];
    if (!existsSync(join(ROOT, LOGO_HEADER))) problems.push(`${LOGO_HEADER} is missing (npm run docs:logo)`);
    if (problems.length) {
      console.error(`Document control: ${problems.length} problem(s).\n`);
      for (const p of problems) console.error(`  - ${p}`);
      console.error('\nFix: from afrinov-platform/, run `npm run docs:stamp` and commit what it writes.');
      return 1;
    }
    console.log(`Document control: ${files.size} documents, every header current.`);
    return 0;
  }

  let gitName = process.env.DOCS_EDITOR;
  if (!gitName) {
    try {
      gitName = git('config', 'user.name').trim();
    } catch {
      gitName = '';
    }
  }
  const editor = editorName(register, gitName);
  if (!editor) {
    console.error('Set git user.name (or DOCS_EDITOR) so the header can say who updated the document.');
    return 1;
  }
  const plan = planStamp({ register, files, today, editor });
  for (const [path, text] of plan.writes) writeKeepingEol(path, text);
  if (plan.registerChanged) writeKeepingEol(REGISTER_PATH, `${JSON.stringify(plan.register, null, 2)}\n`);
  for (const n of plan.notes) console.log(n);
  console.log(`Document control: ${plan.writes.size} of ${plan.stamped.size} documents written, as ${editor}, ${displayDay(today)}.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
