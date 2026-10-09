# Glossary

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Terms are defined the way they are used **in this documentation and target
system**. Where the current spreadsheet uses a different word for the same
idea, that's noted — this becomes the AS-IS → TO-BE terminology bridge.

| Term | Definition | Spreadsheet equivalent |
|---|---|---|
| Material | Anything trackable as inventory: fastener, consumable, tool, PPE item, project material | Row in a `*Main` sheet |
| Material Category | One of: Fasteners/Slugs/Insulation, Tooling/PPE/Electrical, Project Material, Consumables, Tools | Sheet family (e.g. "FS&I", "TP&E") |
| Location | A physical place stock can sit: a rack, a shop area, a storeroom, a container | `Location`/`Rack` column (free text today) |
| Inventory Balance | The current on-hand quantity of a material at a location, derived from transactions | `Current Stock` cell |
| Inventory Transaction | A single, immutable, dated movement of stock (receipt, issue, transfer out/in, adjustment, return) | A row in a `*Issued` sheet |
| Goods Receipt | The event of stock arriving from a supplier and being recorded IN | Rows where `In/Out = IN` |
| Stock Issue | The event of stock leaving stores for use (by a person, on a project) | Rows where `In/Out = OUT` / `Check Out` |
| Stock Transfer | Movement of stock between two locations without changing total on-hand | Not currently modelled distinctly — appears as manual dual edits |
| Stock Adjustment | A correction to on-hand quantity not caused by a receipt or issue (count variance, damage, scrap) | Not currently modelled; `Scrap Material` sheet is the closest analogue |
| Required Stock | The minimum quantity that should be kept on hand before reordering | `Required Stock` column |
| Brought Forward | Opening balance carried from the prior period | `Brought Forward` column |
| Project | A client job that consumes material and tools, identified by number | `Project No.` (e.g. `AFRI-1325`), `Project No.` sheet |
| Supplier | An external vendor that supplies materials | `Supplier Name` (free text) |
| Issued By / Issued To | Issued By: the signed-in user who records the issue. Issued To: the recipient — a worker, machine, client site or contractor (ADR-008) | Columns on `*Issued` sheets |
| Check Out / Check In | Tool-specific movement type: a tool leaving/returning to stores (**Planned** — not in the platform) | `Check In/Out` column on `Tools Issued` |
| Scrap | Waste metal (mild steel, stainless steel, copper, brass, aluminium, machine-shop shavings) sold for value | `Scrap Material` sheet |
| Stock Value | The monetary value of on-hand inventory, shown per category and overall | Summary figure on Dashboard / `*Stock Summary` sheets |
| Recipient | Who issued stock goes to: a worker, machine, client site or contractor; not a user account (ADR-008) | `Employees` sheet / `Issued To:` |
| Return | Unused stock coming back from an issue, recorded against that issue | Not modelled |
| Reversal | A new transaction that cancels a mistaken one by posting its opposite, linked to it (ADR-005) | Editing or deleting a row |
| Counter receipt | Receiving stock without a purchase order, with the supplier and delivery/invoice number | Rows where `In/Out = IN` |
| Stock count | Counting a location and posting the differences as COUNT_VARIANCE adjustments | Not modelled |
| Stock status | URGENT, WARNING, OK or NOT_SET: on hand as a share of Required Stock, by configurable bands | `URGENCY` column |
| Opening balance | The one-off receipt per item and location that loads the workbook's stock at go-live | `Current Stock` at cut-over |
| Month-end report | Per-category stock, value, status and stock used as at a month's end, rebuilt from the ledger | `*Stock Summary` / `*Stock Report` sheets |
| Rack | A numbered storage position record (code, optional location and project) | `Rack` column |
| Bounded Context | A domain-driven-design boundary: a subsystem with its own model and language | New concept, not in spreadsheet |
| SAP | Enterprise software this project studies as a reference model, not a target to replicate | External reference |
