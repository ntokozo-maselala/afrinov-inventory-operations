<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-DOC-004</b></td>
<td align="center"><b><i>Documentation Standardisation Report</i></b><br><i>Document Control</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-DOC-004 updated=2026-11-26 by="Ntokozo Maselala" body=1890204245e3 -->

# Documentation Standardisation Report

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Baseline:** `a778414`, 2026-11-26

The 26 Nov 2026 exercise that brought the repository's documentation under one Afrinov
identity. It covers the audit, the standard set, the changes made, the quality checks
and the issues left open. It is a dated record: the current list of documents is the
[Document Register](DOCUMENT_REGISTER.md), the standard is the
[Style Guide](STYLE_GUIDE.md), and the procedure is [Document Control](README.md).

## Summary

- **218 controlled documents** now carry the Afrinov header: the official logo, a
  document ID, the title over the document type, and the date of the last change
  with who made it. The layout follows an Afrinov controlled document supplied by
  the owner (AFRI-01D-10-01-088).
- **The header keeps itself current.** `npm run docs:stamp` writes it from
  `register.json` and moves the date and name only when a document's text changes.
  `docs-ci.yml` fails any change that leaves a header missing or out of date.
- **No existing text was altered by the standardisation.** Each of the 214 existing
  documents gained 11 header lines and lost none. Five of them, and `AGENTS.md`,
  also gained short, listed additions about the new procedure (see Changes).
- **Three inputs are not in the repository** and are recorded as open: the meaning
  and allocation of Afrinov's company document numbers, a corporate typeface and
  colour guide, and a Word or PDF template. Interim IDs and RECOMMENDED values stand
  in for them and are marked as such.

## 1. Audit

### Documents discovered

| Group | Folder | Documents | Kept as |
|---|---|---:|---|
| Reference set, sections 00–14 | `afrinov-docs/docs/` | 131 | Business and technical reference, by section |
| Engineering assurance | `docs/engineering/` | 11 | Engineering documents |
| Backend reference | `docs/backend/` | 15 | Technical reference |
| Audits | `docs/audits/`, `audit/` | 20 | Audit reports |
| Archive | `docs/archive/` | 25 | Historical records, unchanged apart from the header |
| Developer guides | `afrinov-platform/` | 3 | GitHub-first READMEs and the frontend-only guide |
| General | Repository root, `docs/`, `afrinov-docs/` | 9 | Overview, indexes, root roadmaps and pointers |
| Document control (new) | `docs/document-control/` | 4 | This standard and this report |
| **Controlled** | | **218** | |

Left outside control deliberately: `AGENTS.md` and `SECURITY.md` (read by tools and
by GitHub by convention), the two README files beside Prisma migrations
(code-adjacent), and the six templates. `system-knowledge/` is never committed.

**By type:** Archived Document 25, Audit Report 20, Backend Reference 14, Roadmap 12,
Operations 11, Business Analysis 10, System Architecture 10, Testing 10, Engineering
Assurance 10, Business Process 9, SAP Study 9, Project Management 9, Product 8, Domain
Model 8, API Reference 8, Security 8, Frontend Reference 7, Validation 6, Index 5,
Governance 3, Data Architecture 3, Developer Guide 3, General 3, Decision Records 2,
Change Log 1, Document Register 1, Style Guide 1, Repository Overview 1, Document
Control 1 (this report). Each
document's type is in the register.

**Not Markdown:** `afrinov-docs/docs/Afrinov_Inventory_Operations_System_Master_Presentation_Brief.docx`
(see open issue O3).

### Brand evidence found

| Looked for | Found |
|---|---|
| Logo | The official picture from the company letterhead and quotation template, already in the app (`apps/frontend/src/assets/afrinov-logo.png`; the change log of 2026-11-13 records its adoption). Colours read from it: crimson `#B60012`, green `#21BB00` |
| An approved Afrinov document | None in the repository. The owner supplied one: *Junior Programmer KPI Monthly Assessment*, AFRI-01D-10-01-088, 27/10/2026, with a one-row header (logo, ID, title, date) |
| Company document numbering | In use (AFRI-01D-10-01-088; the stock workbook AFRI-03A-08-IAM-02); its parts and its allocation are not documented |
| Templates, fonts, colour guide | None. The Word brief uses Office's default Aptos, the app's red `#E3001B` and a plain text header; the backend PDFs use Helvetica and `#E3001B`. Both are the application's style, not a corporate standard |
| Document-generation tooling | None for documents. Markdown is read on GitHub and in editors |
| Existing conventions | The status line (`**Status:** · **Owner:** · **Last verified against code:**`) from `00-governance/documentation-guide.md`; the change log; ADR entries in one log; relative links (0 broken) |

### Inconsistencies found

| Area | Finding | Handled |
|---|---|---|
| Identity | No document carried the logo or any common header | Header added to all 218 |
| Identification | No document had an ID | Interim IDs given; register created |
| Dates | No consistent "last updated"; only the status line's verification date, on some documents | Header date, kept by the tool |
| Status line | On 126 of 214 documents; missing from roadmaps, `docs/engineering/`, `docs/backend/`, audits, the archive and root documents | Open issue O8: owners and statuses not invented |
| Status values | Four documents use values outside the convention: "In progress", "Production prototype", "Complete — basis for the refactoring plan", "Completed for repository evidence available on this date" | Open issue O5 |
| Verification age | 100 documents were last verified against the code on 2026-10-09 | Open issue O4 |
| Product name | "Afrinov Inventory Platform" (15), "Afrinov Inventory & Operations Platform" (8), "Afrinov OMS" (2); screens were renamed Afrinov OMS on 2026-11-13 | Open issue O6 |
| Spelling | Mixed: mostly American, as the code is, with British forms in places | Open issue O7 |
| Brand colour | The app's red `#E3001B` differs from the logo's crimson `#B60012` | Style Guide section 1: documents use the logo's colours |

## 2. The standard

- [Style Guide](STYLE_GUIDE.md): evidence and decisions, logo use, colours, the
  header, IDs, last updated and by whom, structure, typography, export layout,
  tables and diagrams, document types, language.
- [Templates](templates/): general document, technical specification, procedure,
  decision record, roadmap, audit report. Each mirrors the structure the
  repository already uses for that kind of document.
- [Document Control](README.md): the procedure and maintenance guidance (how to
  write, change, move or remove a document, replace the IDs, change the logo, read a
  failed check).

## 3. Changes

### Created

| Path | What |
|---|---|
| `docs/document-control/STYLE_GUIDE.md` | The standard |
| `docs/document-control/README.md` | The procedure and maintenance guidance |
| `docs/document-control/DOCUMENT_REGISTER.md` | The register page (written by the tool) |
| `docs/document-control/STANDARDISATION_REPORT.md` | This report |
| `docs/document-control/register.json` | Scope, sections, type rules, people, documents, retired IDs |
| `docs/document-control/templates/*.md` | Six templates |
| `docs/document-control/assets/afrinov-logo-header.png` | The official logo on a white tile, 532 × 477, made by `npm run docs:logo` |
| `afrinov-platform/scripts/doc-control.mjs` | The tool: stamp, check, links, logo (Node built-ins only) |
| `afrinov-platform/scripts/doc-control.test.mjs` | 19 tests (`node --test`) |
| `.github/workflows/docs-ci.yml` | The CI gate |

### Modified

- **All 214 existing controlled documents:** the header added above the title
  (11 lines). In `docs/audits/documentation-inventory.md` the byte-order mark now
  sits before the header; its title line is unchanged.
- **Additions, listed:** `afrinov-docs/docs/00-governance/documentation-guide.md`
  (a "Document header" section), `afrinov-docs/docs/00-governance/change-log.md`
  (the 2026-11-26 row), `docs/README.md` (a paragraph on the header and procedure),
  `docs/engineering/QUALITY_GATES.md` (two gates, the local commands, a failure
  row), `docs/engineering/CI_CD_ARCHITECTURE.md` (the workflow and its required
  check), `AGENTS.md` (a note).
- `afrinov-platform/package.json`: five `docs:*` scripts. No dependency was added.

### Content corrections

None. No requirement, rule, decision, procedure or figure was changed. Findings
about content are listed below for review rather than changed.

## 4. Quality assurance

| Check | Result |
|---|---|
| Tool tests (`npm run docs:test`) | 19 of 19 pass: globs, scope, types, ID numbering and reuse, fingerprint with Windows line endings, title cleaning, South African day, stamp and restamp, date kept on an unchanged text or a register change, moved, retired and copied documents, BOM and CRLF kept, a future date refused, HTML escaped, link finding |
| Check (`npm run docs:check`) | Pass: 218 documents, every header current |
| Restamp without changes | Writes nothing; dates and names kept |
| Content integrity (`git diff --numstat`) | 214 documents: +11 lines each, no line removed (the BOM document's first line re-written with the same title) |
| Line endings | Each file's own kept: 206 CRLF and 12 LF in the working copy, no conversion |
| Relative links (`npm run docs:links`) | 0 broken in 218 documents |
| Rendering | 8 representative documents put through GitHub's own Markdown renderer (`gh api markdown`) and screenshotted in light and dark: an API reference, the deployment procedure, an archived report with spaces and `&` in its file name, the repository README, the BOM document, the register, the style guide, the backend README. GitHub keeps `width`, `align`, `<sub>`, `<b>`, `<i>` and the image; the two control comments are hidden |
| Logo | Loads in every rendered document at 80 × 72 px from 532 × 477, the shape kept; on its white tile it reads in both themes |
| Phone width (390 px) | **Defect found and fixed.** GitHub gives every image `max-width: 100%`, so in a squeezed table the logo shrank to 3 px. An invisible line of no-break spaces under the logo gives its cell a minimum; it now renders at 79 × 71 px and the row scrolls sideways like any wide GitHub table |

Not verified yet: the pages on github.com itself, and the `docs-ci.yml` run, until
the branch is pushed. There is no PDF or Word output to inspect, as nothing in the
repository produces one (O2).

## 5. Open issues

| # | Issue | Needs |
|---|---|---|
| O1 | The company numbering scheme (what each part of AFRI-01D-10-01-088 means, who allocates numbers) is not in the repository, so IDs are interim `AFRI-OMS-…` | Afrinov document control: the scheme or a block of numbers. Then one change to `register.json` (README, "Replace the interim IDs") |
| O2 | No corporate typeface, colour guide or Word/PDF template in the repository; the Style Guide's typography, neutral colours and print layout are RECOMMENDED | The company letterhead or document template, to replace the RECOMMENDED values |
| O3 | The Master Presentation Brief (`.docx`) is outside the tool, and its header, Aptos type and the app's red do not follow the standard | A decision: re-issue it from a Word template once O2 is settled, or leave it as an input brief |
| O4 | 100 documents were last verified against the code on 2026-10-09 | Re-verification by each document's owner; the header's date does not mean re-verified |
| O5 | Four documents use status values outside the convention (section 1) | The owner's choice of the conventional value |
| O6 | Three product names in the documents; the screens say Afrinov OMS since 2026-11-13 | A decision on the documents' name, then one pass |
| O7 | Spelling is mixed | A decision on a house spelling (code identifiers stay as they are) |
| O8 | 88 documents have no status line, as the documentation guide asks | Owners and statuses from the people responsible: not invented here |
| O9 | `Docs CI / document-control` is not yet a required check | A branch protection setting (`CI_CD_ARCHITECTURE.md`) |
| O10 | A document edited on github.com fails the check until someone stamps it locally | Accepted: the alternative, CI committing to branches, was not adopted |
| O11 | Long inline code in some documents (for example the error model) runs past a phone screen | Pre-existing; content edit for the owner |
| O12 | No confidentiality classification is assigned to system documents | A decision; the export footer has a place for it |
| O13 | Every document reads 26/11/2026 by Ntokozo Maselala, the standardisation, as the owner decided; earlier change dates are in git history | None: recorded so the uniform date is not misread |
| O14 | Only the git name `ntokozo-maselala` is mapped in `people`; other git names show as they are | Add names to `register.json` as people stamp |
