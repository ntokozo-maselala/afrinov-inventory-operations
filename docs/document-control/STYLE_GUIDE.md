<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-DOC-003</b></td>
<td align="center"><b><i>Afrinov Documentation Style Guide</i></b><br><i>Style Guide</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-DOC-003 updated=2026-11-26 by="Ntokozo Maselala" body=f661dd07658a -->

# Afrinov Documentation Style Guide

**Status:** IN REVIEW · **Owner:** Product/Engineering

How Afrinov system documents look and are controlled: the logo, the document
header, document IDs, typography, layout, tables and diagrams. It applies to every
controlled document in this repository (the list is the
[Document Register](DOCUMENT_REGISTER.md)) and to documents exported from it.

The aim is one recognisable identity across documents of different kinds. The
identity is shared, but the structure is not forced to match: an API reference stays
navigable, a decision record keeps its decision format, and a README still reads well
on GitHub.

How to create and update documents, and what the tooling does, is in
[README.md](README.md).

## 1. What this standard rests on

Each part of the standard rests on evidence, a decision, or a recommendation. Where
the company has a standard that is not in the repository, it is marked
**Not established**. The value given there is a recommendation, labelled
**RECOMMENDED**, until the company's own standard replaces it.

| Element | Basis | Source |
|---|---|---|
| Logo | **Evidence:** the official picture from Afrinov's letterhead and quotation template | `afrinov-platform/apps/frontend/src/assets/afrinov-logo.png`; its origin is recorded in `apps/frontend/src/components/Logo.tsx` |
| Logo colours | **Evidence:** the two colours of the official logo, read from its pixels | Crimson `#B60012`, green `#21BB00` |
| Document header layout | **Evidence:** an Afrinov controlled document, *Junior Programmer KPI Monthly Assessment*, `AFRI-01D-10-01-088`, dated 27/10/2026, supplied by the owner on 26 Nov 2026 | One bordered row: logo, document ID, title in bold italic over the document type, date |
| Date format in the header | **Evidence:** the same document | Day first, `DD/MM/YYYY` |
| Company document numbering | **Evidence:** the scheme exists (`AFRI-01D-10-01-088`; the stock workbook `AFRI-03A-08-IAM-02`) | What each part means and who allocates numbers is **not established** |
| Document IDs used here | **Decision** by the owner, 26 Nov 2026: interim system IDs | `AFRI-OMS-<section>-<nnn>`, section 4 |
| Updated by | **Decision** by the owner, 26 Nov 2026 | Section 5 |
| Status line | **Evidence:** the existing convention | `afrinov-docs/docs/00-governance/documentation-guide.md` |
| Corporate typeface | **Not established**: no brand guide or template font is in the repository | Section 7 (RECOMMENDED) |
| Print page layout | **Not established**: no Word or PDF template is in the repository | Section 8 (RECOMMENDED) |

Two things are deliberately **not** the corporate identity:

- **The app's red, `#E3001B`**, is a colour of the application's interface (its
  design tokens, its PDFs, the Master Presentation Brief). It is not one of the
  logo's colours. Documents use the logo's own crimson.
- **The favicon and app icon** (`public/favicon.svg`, `src/assets/icon/`) are the
  app's mark on a tile, made for small sizes. Documents use the full logo.

## 2. Corporate identity

### Logo

- Documents use the logo through the header only:
  `docs/document-control/assets/afrinov-logo-header.png`, the official logo on a
  white tile. The white tile matches the reference document and keeps the logo
  readable when GitHub or an editor shows a dark theme.
- The header file is made from the official logo by `npm run docs:logo`. When the
  official logo changes, replace `apps/frontend/src/assets/afrinov-logo.png` and run
  that command. Never edit the header logo by hand.
- Never recolour, stretch, crop, rotate, outline or add effects to the logo, and
  never place it on a busy background. The header shows it 80 px wide and keeps its
  shape.
- Never recreate the logo as text or in another drawing. If a medium cannot show
  the picture, write "Afrinov" in plain text.

### Colours

| Name | Hex | Use |
|---|---|---|
| Afrinov Crimson | `#B60012` | Accent in exported documents: the title rule, table heading text or rule. Use sparingly |
| Afrinov Green | `#21BB00` | Second accent; never for body text (too light to read on white) |
| Text (RECOMMENDED) | `#1F1F1F` | Body text in exported documents |
| Muted text (RECOMMENDED) | `#595959` | Header labels, captions, footers |
| Rule (RECOMMENDED) | `#BFBFBF` | Table borders and the header grid |
| Table heading fill (RECOMMENDED) | `#F2F2F2` | Table heading row in exported documents |

Markdown on GitHub cannot be coloured: the renderer sets every colour. So in
Markdown documents the logo is the only colour, and that is intended.

## 3. The document header

Every controlled document opens with the Afrinov header, as the reference document
does:

<table>
<tr>
<td width="104" align="center"><img src="assets/afrinov-logo-header.png" alt="Afrinov" width="80"></td>
<td width="180" align="center"><sub>Document ID</sub><br><b>AFRI-OMS-08-003</b></td>
<td align="center"><b><i>Error Model</i></b><br><i>API Reference</i></td>
<td width="160" align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>

*An example header (this page's own header is at the top).*

| Cell | Holds | Comes from |
|---|---|---|
| 1 | The Afrinov logo | `assets/afrinov-logo-header.png` |
| 2 | The document ID | `register.json` |
| 3 | The title (bold italic), over the document type (italic) | The document's `#` heading; the type from `register.json` |
| 4 | The date of the last change (`DD/MM/YYYY`) and who made it | Written when the document's text changes (section 5) |

The header is written by `npm run docs:stamp`. **Never write or edit it by hand.**
CI refuses a header that differs from what the tool would write. Small labels
("Document ID", "Last updated") are added to the reference layout so a reader of a
system document knows which date is meant.

Under the header, the document keeps its own `#` title. Under that comes the status
line (section 6), then the content.

## 4. Document IDs

`AFRI-OMS-<section>-<nnn>`, for example `AFRI-OMS-12-002`.

- **Interim.** These numbers belong to this system's documents until Afrinov
  document control allocates numbers from the company register. They are kept
  separate from that register (`OMS`, Operations Management System) so they cannot
  be mistaken for its numbers. Replacing them is one change to `register.json`
  followed by `npm run docs:stamp` (see [README.md](README.md)).
- **Section** is the folder the document lives in:

| Code | Folder | Default type |
|---|---|---|
| `00`–`14` | `afrinov-docs/docs/00-governance` … `14-validation` (the number is the folder's) | Governance … Validation |
| `ENG` | `docs/engineering/` | Engineering Assurance |
| `BE` | `docs/backend/` | Backend Reference |
| `AUD` | `docs/audits/` and `audit/` | Audit Report |
| `ARC` | `docs/archive/` | Archived Document |
| `DOC` | `docs/document-control/` | Document Control |
| `DEV` | `afrinov-platform/` | Developer Guide |
| `GEN` | anywhere else (repository root, `docs/`, `afrinov-docs/`) | General |

- **Serial** is three digits, given out in order by the tool when a document first
  appears.
- **An ID is never reused.** A document keeps its ID when it is renamed or moved,
  even into another folder. A document that is removed has its ID listed under
  *Retired IDs* in the register.
- The **type** is set by rules in `register.json` (an index, a roadmap, the decision
  log). It can be corrected by hand in the register for a single document.

## 5. Last updated, and by whom

- **Last updated** is the South African date (UTC+2, as ADR-041) on which the
  document's own text last changed. Everything under the header counts as text. A
  change to the register only (an ID or a type) does not move the date.
- **By** is the person who ran `npm run docs:stamp` after making that change. The
  name is git's `user.name`, translated through `people` in `register.json` (for
  example `ntokozo-maselala` → Ntokozo Maselala).
- On 26 Nov 2026 every document was given the header as part of this
  standardisation, carried out by Ntokozo Maselala, so every document shows that
  date and name. Each document's earlier history stays in git
  (`git log -- <file>`).
- Two dates mean different things and both are kept: the header's **Last updated**
  (when the text changed) and the status line's **Last verified against code** (when
  someone last checked the text against the code). A recent update does not mean
  the document was re-verified.

## 6. Document structure

- **One `#` title**, the first line under the header, in the words a reader would
  search for. Existing titles are kept as written.
- **Status line** directly under the title, as in the documentation guide:
  `**Status:** DRAFT | IN REVIEW | APPROVED | SUPERSEDED | ARCHIVED · **Owner:** <role or name> · **Last verified against code:** <commit>, <YYYY-MM-DD>`.
  The last part is for documents checked against the code. Do not invent an owner,
  a status or an approval: leave out what is not known.
- **Headings** run `##` then `###` then `####`, with no levels skipped. Numbered
  parts ("Part 3 —", "Phase 2:") are kept where a document is followed in order.
- **Body**: short paragraphs in plain words. Name screens and buttons in **bold**,
  exactly as they are labelled. Code, paths, commands and identifiers go in
  `backticks`.
- **Dates in body text and tables** are ISO `YYYY-MM-DD` (the repository's
  convention, which sorts) or written out ("26 Nov 2026"). Only the header uses
  `DD/MM/YYYY`.
- **Links** are relative (`../08-api/error-model.md`), so they work on GitHub, in
  an editor and in a clone. `npm run docs:links` lists any that lead nowhere.

## 7. Typography

In Markdown the renderer (GitHub, VS Code) sets the typeface. Documents use the
semantic levels below and never fake them with bold lines or HTML font tags. For
exported documents (Word, PDF) the corporate typeface is **not established**. The
RECOMMENDED interim is **Arial**, a plain grotesque that matches the reference
document's header and is on every Windows and Office installation. Substitute
Liberation Sans or Helvetica where Arial is missing.

| Level | Markdown | Exported document (RECOMMENDED) |
|---|---|---|
| Document title | Header cell 3 and the `#` heading | Header cell: 11 pt bold italic; title page: 22 pt bold, Crimson |
| Subtitle / document type | Header cell 3, second line | 10 pt italic |
| Heading 1 | `##` | 16 pt bold, 18 pt before, 6 pt after |
| Heading 2 | `###` | 13 pt bold, 12 pt before, 4 pt after |
| Heading 3 | `####` | 11 pt bold, 10 pt before, 3 pt after |
| Body | Paragraph text | 10.5 pt, line spacing 1.15, 6 pt after |
| Table heading | First table row | 9.5 pt bold, fill `#F2F2F2` |
| Table content | Table rows | 9.5 pt |
| Caption | A line in *italics* directly under the table or figure | 9 pt italic, `#595959` |
| Footnote | Markdown footnote `[^1]` | 8.5 pt |
| Header and footer | The Afrinov header | 9 pt, labels 7.5 pt `#595959` |
| Code | Fenced block with a language (` ```sh `, ` ```json `) | Consolas 9 pt, fill `#F7F7F7` |

## 8. Exported and printed documents

No Word or PDF template is in the repository, and no tool here produces either. When
a document is exported or a new one is written in Word, use the following. It is
RECOMMENDED, and is replaced once the company's template is available.

- **Paper:** A4 portrait (South African standard); landscape only for a wide table,
  on its own section.
- **Margins:** 20 mm top and bottom, 20 mm left and right; header 10 mm and footer
  10 mm from the edge.
- **Header on every page:** the section 3 row (logo, document ID, title over type,
  date), as a four-column table with `#BFBFBF` 0.5 pt borders, as in the reference.
- **Footer on every page:** classification on the left (for example
  "Internal"), and "Page *n* of *N*" on the right. Choose the classification
  deliberately; none is assigned to system documents yet.
- **Page breaks** before each `##` section in documents over ten pages; never leave a
  heading alone at the bottom of a page.
- Keep tables whole on one page where they fit, and repeat the heading row
  where they don't.

## 9. Tables and diagrams

**Tables**

- A heading row always. Headings in sentence case, short.
- Text left-aligned; numbers and amounts right-aligned (`|---:|`).
- One fact per cell. A long explanation goes under the table, not inside it.
- A caption, where the table needs one, in *italics* directly underneath.
- On GitHub the renderer draws borders and row shading; do not add HTML styling.

**Diagrams**

- Mermaid, in a ` ```mermaid ` block, so it stays text that can be reviewed and
  changed. The two diagrams in the repository follow this.
- GitHub's default Mermaid theme, with no `%%{init}%%` colour overrides and no
  `style`/`classDef` colours. GitHub switches the default theme between light and
  dark, and fixed colours break one of the two.
- Labels in the words used on screen and in the documents; no abbreviations a reader
  must look up.
- A one-line *italic* caption underneath saying what the diagram shows.
- Pictures (screenshots) live beside the document, are linked relatively, and have
  alt text.

## 10. Document types

The identity is the same for every type; the structure follows the type. Templates
are in [`templates/`](templates/).

| Type | Where | Template | Keeps |
|---|---|---|---|
| Business document, guide, overview | `afrinov-docs/docs/01`–`05`, root | `general-document.md` | Plain narrative |
| Technical specification | `afrinov-docs/docs/06`–`11`, `docs/backend/` | `technical-specification.md` | Rules, interfaces, an Evidence section |
| Procedure, operations guide, SOP | `afrinov-docs/docs/12-operations/` | `procedure.md` | Numbered parts and steps, checklist, troubleshooting |
| Decision record | `00-governance/decision-log.md` | `decision-record.md` | Date · Status, Context, Decision, Alternatives, Consequences |
| Roadmap | `13-project-management/roadmaps/` | `roadmap.md` | Byline, decisions table, phases with checkboxes, "Done when" |
| Audit or assessment | `docs/audits/`, `audit/` | `audit-report.md` | Scope, method, findings with evidence |
| README / index | Any folder | (none) | GitHub-first: what is here and where to start |
| Archived document | `docs/archive/` | (none) | Kept as written; only the header is added |
| Change log | `00-governance/change-log.md` | (none) | One table row per change, newest first |

## 11. Language

- Spelling is mixed across the documents today: mostly American
  (*authorization*, *behavior*), as the code is, with British forms in places. Keep
  the spelling a document already uses. Never change a word that names something in
  the code (`authorization.md`, a permission, a field). A single house spelling is
  an open decision (see the standardisation report).
- The words on screen, in bold, for anything a person clicks or reads in the app.
- Say what is built and what is **Planned**; never describe planned work as done.
- Business terms as in the [glossary](../../afrinov-docs/docs/00-governance/glossary.md).
