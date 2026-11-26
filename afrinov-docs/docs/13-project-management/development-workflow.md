<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-13-005</b></td>
<td align="center"><b><i>Development Workflow</i></b><br><i>Project Management</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-13-005 updated=2026-11-26 by="Ntokozo Maselala" body=ac55dd81d397 -->

# Development Workflow

**Status:** DRAFT · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

Follow the document dependency chain established in this documentation set:

```
Business Context -> AS-IS/TO-BE -> Business Requirements -> Domain Model ->
SAP Study/Mapping -> Architecture -> Data Model -> API -> UI -> Implementation
-> Testing -> Deployment -> Operations
```

Do not start a module's implementation before its entry in `03-domain/` and
`04-processes/` exists and has been reviewed — this is the concrete
practice that prevents repeating the original mistake (building UI before
the business model was understood).

*Unverified* as current practice: implementation now follows the phases in
`workbook-replacement-roadmap.md` (repository root), and several modules
(recipients, returns, stock counts, month-end) were built before their
`03-domain/` and `04-processes/` entries existed; those entries were added
in the 2026-10-09 documentation reconciliation.
