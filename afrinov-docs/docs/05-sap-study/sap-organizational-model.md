# SAP Organizational Model — What Was Studied

SAP's hierarchy: **Client → Company Code → Plant → Storage Location**,
representing legal entity, then physical site, then storage sub-division.

**Applied to Afrinov (validate with business owner):** Afrinov is a single
legal entity operating from what appears to be one physical site (workshop
with Boiler Shop, Machine Shop, Blasting, Paint Shop, Stores areas). This
maps to a single implicit "Plant", with `Location` (rack/storeroom/shop
area/container) serving the role of SAP's Storage Location. **A full
Client/Company Code/Plant hierarchy is not adopted** — it solves a
multi-site, multi-entity problem Afrinov does not currently have (see
`sap-not-to-copy.md`). If Afrinov opens a second site in future, `Location`
gains a `site` attribute rather than requiring a new hierarchy layer to be
retrofitted awkwardly.
