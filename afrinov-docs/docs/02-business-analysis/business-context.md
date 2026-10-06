# Business Context

**Status:** DRAFT — validate assumptions A-01, A-02 with business owner

## What Afrinov does (inferred from the workbook)
Afrinov appears to be a metal fabrication / engineering workshop that runs
client projects (numbered `AFRI-####`) through a **boiler shop**, **machine
shop**, **blasting**, and **paint shop**, consuming fasteners, consumables,
tooling, PPE, and project-specific material, and generating scrap metal
(mild steel, stainless steel, copper, brass, aluminium, machine-shop
shavings) as a saleable by-product.

## Business context diagram
```
                    Suppliers
              (JHB Bolts, Hydroscand,
                 SIEVERT, others)
                        |
                        v
   Employees  <----  AFRINOV  ---->  Clients (via AFRI-#### projects)
  (issue/receive           |
   stock, ~52 people)      v
                    Scrap buyers
                (mild steel, stainless,
                 copper, brass, aluminium)
```

## External actors
| Actor | Interaction |
|---|---|
| Suppliers | Deliver materials against (currently informal) orders; identified only by free-text name today |
| Clients / Projects | Consume material and tools, tracked by `AFRI-####` project number |
| Employees | Issue and receive stock, check tools in/out |
| Scrap buyers | Purchase scrap metal by-product (tracked in Rand value) |

## Physical/organisational areas referenced in the data
Stores, Boiler Shop, Machine Shop, Blasting, Paint Shop, plus numbered racks
(e.g. `D-1`, `F-7`, `N-1`) and ad hoc containers. These are strong candidates
for the `Location` master's `type` values (see `03-domain/entity-catalog.md`).

## Why this matters for scope
This context is what "study SAP" is really pointing at: Afrinov is not just
"an inventory list", it's a workshop business where inventory sits between
**procurement** (getting material in) and **operations** (consuming it on
projects) — the same shape as SAP's Materials Management sitting between
Purchasing and Production/Plant Maintenance. See `05-sap-study/sap-lessons-for-afrinov.md`.
