# SAP: What NOT to Copy

Explicitly rejected, and why — to prevent scope creep disguised as "SAP
best practice."

| SAP complexity | Why Afrinov doesn't need it (yet) |
|---|---|
| Stock Types (unrestricted, quality inspection, blocked) | No quality-hold process exists in the current business; add only if a real QA workflow emerges |
| Purchase Requisition approval layer | Current buying process is informal and immediate; inventing an approval step nobody asked for adds friction without a stated business need |
| Multi-level org structure (Client/Company Code/Plant/Storage Location) | Afrinov is one legal entity, effectively one site |
| 100+ Movement Types | Four types (Receipt, Issue, Transfer, Adjustment) cover every case observed in the AS-IS data |
| Full accounting/costing integration (standard cost, moving average, valuation classes) | Finance integration is explicitly future scope; a simple stock-value figure suffices for v1 |
| Batch/serial number management | No evidence of lot-tracking need in the current data (no batch/serial columns anywhere in the workbook) |
| Multi-currency, multi-language | Single currency (Rand, per `Scrap Material` sheet), single language observed throughout |
| Complex authorization objects (SAP's fine-grained authorization concept) | A straightforward role-based permission model (`10-security/access-control.md`) is sufficient at this scale |
| MRP (Material Requirements Planning) / demand forecasting | `Required Stock` as a static threshold is what the business uses today; forecasting is a genuine future upgrade, not a v1 need |

## Guiding principle
**Learn SAP's models; don't reproduce SAP's complexity.** Every adopted
concept in `sap-lessons-for-afrinov.md` is there because it maps to an
actual Afrinov requirement in `02-business-analysis/business-requirements.md`
— not because "that's how SAP does it."
