<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-DOC-002</b></td>
<td align="center"><b><i>Document Control</i></b><br><i>Index</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-DOC-002 updated=2026-11-26 by="Ntokozo Maselala" body=1343392376b2 -->

# Document Control

**Status:** IN REVIEW · **Owner:** Product/Engineering

How Afrinov system documents get their header and keep it current, and what to do
when you write, change, move or remove a document. What the header and documents
should look like is in the [Style Guide](STYLE_GUIDE.md); the list of every
controlled document is the [Document Register](DOCUMENT_REGISTER.md).

## What is here

| Path | What it is |
|---|---|
| [`STYLE_GUIDE.md`](STYLE_GUIDE.md) | The Afrinov documentation standard: logo, header, IDs, typography, layout, tables, diagrams |
| [`DOCUMENT_REGISTER.md`](DOCUMENT_REGISTER.md) | Every controlled document with its ID, type, last update and updater (written by the tool) |
| [`register.json`](register.json) | The register's data: scope, sections, type rules, people, documents and retired IDs |
| [`templates/`](templates/) | Starting points for each kind of document |
| [`assets/afrinov-logo-header.png`](assets/afrinov-logo-header.png) | The header logo, made from the official logo by `npm run docs:logo` |
| [`STANDARDISATION_REPORT.md`](STANDARDISATION_REPORT.md) | The 26 Nov 2026 audit, the changes made, the quality checks and open issues |
| `afrinov-platform/scripts/doc-control.mjs` | The tool (Node built-ins only) and its tests beside it |

## The one rule

**After changing any document, run `npm run docs:stamp` from `afrinov-platform/` and
commit what it writes.** The tool updates the header's date and name, registers new
documents and refreshes the register. CI (`docs-ci.yml`) fails a pull request whose
headers are missing or out of date, and names the files.

```sh
cd afrinov-platform
npm run docs:stamp    # write or refresh headers and the register
npm run docs:check    # what CI runs: fails if anything is out of date
npm run docs:links    # list relative links that lead nowhere
npm run docs:test     # the tool's own tests
npm run docs:logo     # rebuild the header logo after the official logo changes
```

`docs:stamp` names you from git's `user.name`. If your git name is a login rather
than your name, add it to `people` in `register.json`
(`"your-login": "Your Name"`). For a one-off, `DOCS_EDITOR="Your Name" npm run docs:stamp`.

## Which documents are controlled

Every Markdown file in the repository, except those tools or GitHub read by
convention, and the templates:

- `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`, anything under `.github/` and `.claude/`
- the README files beside Prisma migrations
- `docs/document-control/templates/`
- `system-knowledge/` (never committed)

The rule is `scope` in `register.json`. The Word brief in `afrinov-docs/docs/` is
not Markdown and is outside the tool (see the report's open issues).

## Common tasks

### Write a new document

1. Copy the matching template from [`templates/`](templates/) to the folder it
   belongs in (the Style Guide's section 10 says which).
2. Replace the placeholders and delete the template's opening comment.
3. Run `npm run docs:stamp`. The document gets the next ID in its section, the
   header, today's date and your name, and a row in the register.
4. Link it from the folder's README or index if it has one.

### Change a document

Edit the text under the header, then run `npm run docs:stamp`. Only documents whose
text changed get a new date and name. Do not touch the header itself: a hand edit is
put back by the next stamp, and CI refuses it.

### Rename or move a document

Use `git mv` and run `npm run docs:stamp`. The header carries the document's ID, so
the tool finds the moved file and keeps its ID and its date. Fix links to it (`npm
run docs:links` lists any left broken).

### Remove a document

Delete it and run `npm run docs:stamp`. Its ID moves to *Retired IDs* in the register
and is never given out again. Prefer moving a superseded document to `docs/archive/`
over deleting it.

### Correct a document's type

Edit its `type` in `register.json` and run `npm run docs:stamp`. The header changes;
its date does not. To change the type every new document of a kind gets, edit
`typeRules` (first match wins).

### Replace the interim IDs with company numbers

When Afrinov document control allocates numbers:

1. Record the company scheme (what each part means, who allocates) in the Style
   Guide's section 4.
2. Change each document's `id` in `register.json` (and `idPrefix` and `sections`
   if new documents should follow the company scheme).
3. Run `npm run docs:stamp`, then `npm run docs:check`. Headers and the register
   change; no document's date moves.

### Change the logo

Replace `afrinov-platform/apps/frontend/src/assets/afrinov-logo.png` with the new
official picture (a transparent RGBA PNG), run `npm run docs:logo`, and commit the
new `assets/afrinov-logo-header.png`. Every header points at that file, so nothing
else changes.

## When the check fails

| CI says | What happened | Fix |
|---|---|---|
| `no Afrinov header` | A new document, or the header was deleted | `npm run docs:stamp` |
| `text changed since its header was written` | The document was edited without a stamp (often an edit made on github.com) | `npm run docs:stamp` on the branch, commit |
| `header out of step with the register` | The header was edited by hand, or the register changed | `npm run docs:stamp` |
| `register: registered … / moved … / retired …` | A document was added, moved or removed without a stamp | `npm run docs:stamp` |
| `last-updated date … is in the future` | A header was written with a wrong clock or by hand | Fix the clock, delete the header, stamp |

## How it works

The header sits between two HTML comments at the top of the file. The closing comment
keeps the ID, the date, the updater and a fingerprint (SHA-256, first 12 hex digits)
of the text under the header. A stamp compares the fingerprint with the text:

- **Same text:** the date and name are kept; the header is rewritten only if the
  register (ID, type) or the title changed.
- **Different text, or no header:** today's South African date and the stamping
  person's name.

Line endings do not count (a Windows checkout and CI's Linux checkout give the same
fingerprint), and a file's own line endings and byte-order mark are kept. The check
works without git history or installed packages, so CI runs it in seconds.
