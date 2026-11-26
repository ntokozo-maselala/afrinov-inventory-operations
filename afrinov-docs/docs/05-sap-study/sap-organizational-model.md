<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-05-006</b></td>
<td align="center"><b><i>SAP Organizational Model — What Was Studied</i></b><br><i>SAP Study</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-05-006 updated=2026-11-26 by="Ntokozo Maselala" body=a9ebe7f46e5c -->

# SAP Organizational Model — What Was Studied

**Status:** DRAFT · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

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
