# Glossary

Terms are defined the way they are used **in this documentation and target
system**. Where the current spreadsheet uses a different word for the same
idea, that's noted — this becomes the AS-IS → TO-BE terminology bridge.

| Term | Definition | Spreadsheet equivalent |
|---|---|---|
| Material | Anything trackable as inventory: fastener, consumable, tool, PPE item, project material | Row in a `*Main` sheet |
| Material Category | One of: Fasteners/Slugs/Insulation, Tooling/PPE/Electrical, Project Material, Consumables, Tools | Sheet family (e.g. "FS&I", "TP&E") |
| Location | A physical place stock can sit: a rack, a shop area, a storeroom, a container | `Location`/`Rack` column (free text today) |
| Inventory Balance | The current on-hand quantity of a material at a location, derived from transactions | `Current Stock` cell |
| Inventory Transaction | A single, immutable, dated movement of stock (receipt, issue, transfer, adjustment) | A row in a `*Issued` sheet |
| Goods Receipt | The event of stock arriving from a supplier and being recorded IN | Rows where `In/Out = IN` |
| Stock Issue | The event of stock leaving stores for use (by a person, on a project) | Rows where `In/Out = OUT` / `Check Out` |
| Stock Transfer | Movement of stock between two locations without changing total on-hand | Not currently modelled distinctly — appears as manual dual edits |
| Stock Adjustment | A correction to on-hand quantity not caused by a receipt or issue (count variance, damage, scrap) | Not currently modelled; `Scrap Material` sheet is the closest analogue |
| Required Stock | The minimum quantity that should be kept on hand before reordering | `Required Stock` column |
| Brought Forward | Opening balance carried from the prior period | `Brought Forward` column |
| Project | A client job that consumes material and tools, identified by number | `Project No.` (e.g. `AFRI-1325`), `Project No.` sheet |
| Supplier | An external vendor that supplies materials | `Supplier Name` (free text) |
| Rack | A specific storage bin/shelf location code (e.g. `D-1`, `F-7`) | `Rack`/`Location` column |
| Issued By / Issued To | The staff member releasing stock, and the staff member receiving it | Columns on `*Issued` sheets |
| Check Out / Check In | Tool-specific movement type: a tool leaving/returning to stores | `Check In/Out` column on `Tools Issued` |
| Scrap | Waste metal (mild steel, stainless steel, copper, brass, aluminium, machine-shop shavings) sold for value | `Scrap Material` sheet |
| Stock Value | The monetary value of on-hand inventory, shown per category and overall | Summary figure on Dashboard / `*Stock Summary` sheets |
| Bounded Context | A domain-driven-design boundary: a subsystem with its own model and language | New concept, not in spreadsheet |
| SAP | Enterprise software this project studies as a reference model, not a target to replicate | External reference |
