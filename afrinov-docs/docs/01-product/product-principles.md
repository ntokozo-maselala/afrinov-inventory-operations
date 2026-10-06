# Product & Architecture Principles

1. **Business domain first.** Every table, endpoint, and screen must trace
   back to a business capability in `capability-map.md`. If it doesn't, ask
   why it exists before building it.
2. **Modular, not monolithic-in-spirit.** One codebase is fine; one
   undifferentiated codebase is not. Respect bounded contexts
   (`03-domain/bounded-contexts.md`) even inside a single deployable.
3. **Stock changes only through transactions.** No code path mutates a
   balance directly (ADR-002). This is the single most important rule
   carried over from studying SAP's material-document model.
4. **History is permanent.** Inventory transactions, once posted, are never
   edited or deleted — corrections are new transactions (adjustments), the
   same way accounting systems never rewrite the past.
5. **Learn from SAP's models, not SAP's complexity.** See
   `05-sap-study/sap-not-to-copy.md`. Every concept borrowed must be
   justified by an actual Afrinov requirement.
6. **Design for extension, not speculative complexity.** Build the Inventory
   + Procurement loop solidly; leave clean seams for Operations, Finance,
   Sales — don't build their tables now.
7. **The UI never owns business rules.** Reorder logic, stock-balance
   derivation, and approval rules live in the application/domain layer, not
   in frontend code — the opposite of the current spreadsheet, where the
   only "rule enforcement" is a human remembering to type the right formula.
8. **Data quality is a first-class deliverable.** The current location data
   alone has at least six spellings for "stores". Migration is not just an
   ETL script — it is a cleansing and validation exercise (see
   `07-data/migration-strategy.md`).
9. **Auditability over convenience.** Every mutating action records who, what,
   when. This is a step change from the current system, not an afterthought.
10. **Prefer boring, provable technology choices** for a small team
    maintaining this long-term over novel architecture for its own sake.
