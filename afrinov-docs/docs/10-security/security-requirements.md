<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-10-006</b></td>
<td align="center"><b><i>Security Requirements</i></b><br><i>Security</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-10-006 updated=2026-11-26 by="Ntokozo Maselala" body=24600d6620ea -->

# Security Requirements

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

| Requirement | Status in code |
|---|---|
| All access authenticated; no anonymous read or write | Met: only login and health checks are public |
| All mutating actions authorized server-side by role | Met: every mutating route calls `requirePermission` |
| All mutating actions logged to the audit trail with actor, before/after, and timestamp | Partly met: see `audit-and-accountability.md` (issues, transfers, adjustments, PO creation, goods receipts not in the audit log; ledger records the actor) |
| Passwords hashed (never plain text, never logged) | Met: bcrypt cost 12; hashes never returned by the API |
| Transport encrypted (HTTPS only) | *Unverified:* TLS is not configured in the repository; the API sends `Strict-Transport-Security` through helmet, which only takes effect over HTTPS |
| Sensitive configuration in environment variables/secret manager, never in source control | Met for the repository; see `secrets-management.md` |

## Evidence
- `afrinov-platform/apps/backend/src/modules/identity/identity.service.ts:7-16`, `afrinov-platform/apps/backend/src/modules/identity/identity.service.ts:51-71` — user reads exclude `passwordHash`
- `afrinov-platform/apps/backend/src/server.ts:85-103` — helmet
- `afrinov-platform/apps/backend/src/shared/config.ts:42-77`
