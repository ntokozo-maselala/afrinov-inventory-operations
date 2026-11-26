<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-02-001</b></td>
<td align="center"><b><i>Business Context</i></b><br><i>Business Analysis</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-02-001 updated=2026-11-26 by="Ntokozo Maselala" body=9f5c89de9c36 -->

# Business Context

**Status:** DRAFT · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09 · validate assumptions A-01, A-02 with business owner

## What Afrinov does (inferred from the workbook — *Unverified*)
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
Purchasing and Production/Plant Maintenance. See
`05-sap-study/sap-lessons-for-afrinov.md`.
