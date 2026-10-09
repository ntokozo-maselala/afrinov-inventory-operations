# User Personas

**Status:** DRAFT · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

## Store Controller — "Nomvula"
**Responsible for:** keeping the Main sheets/system accurate; the closest
role to today's spreadsheet owner.
**Goals:** know current stock without cross-checking sheets; trust the
number on screen; be alerted before something runs out.
**Needs:** category-agnostic stock search, low-stock dashboard, transaction
history per material, ability to record adjustments with a reason.

## Workshop Technician — "George" / "Tisetso"
**Responsible for:** taking material or tools out of stores to do the job.
**Goals:** get what's needed fast; not fill in more paperwork than
necessary.
**Needs:** a quick "issue" screen — pick material or tool, quantity, project
number (optional), done. Works on a shared terminal or tablet on the floor,
not a desktop spreadsheet.

## Procurement/Buyer (new role, not explicit today)
**Responsible for:** ordering from suppliers before stock runs out.
**Goals:** see what's below `Required Stock`; know what's already on order
so they don't double-order; get goods receipted quickly and accurately.
**Needs:** supplier master, PO creation, PO status tracking, receipt matching.

## Project Lead
**Responsible for:** running a client job (`AFRI-####`).
**Goals:** know what material and tools have been consumed against their
project.
**Needs:** a project-filtered movement report. *Status:* implemented (Stock
used page by project; the movement-history API filters by project).

## Administrator
**Responsible for:** users, roles, categories, locations, suppliers —
system configuration.
**Goals:** keep master data clean (this role effectively doesn't exist
today, which is how "Store", "Stores", "STOREROOM" all ended up as separate
locations).
**Needs:** master-data management screens with merge/dedupe tooling.
*Status:* master-data screens exist (Materials, Locations, Racks,
Projects, Recipients, Suppliers, Settings → Users); merge/dedupe tooling is
**Planned**.

## Business Owner / Manager
**Responsible for:** oversight, decisions on scope and investment.
**Goals:** trust the numbers; see the operation at a glance; understand how
this system fits the rest of the business.
**Needs:** dashboard/reporting, not data entry.

*Unverified:* personas and names are illustrative, pending the business
owner's review.
