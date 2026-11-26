<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-12-009</b></td>
<td align="center"><b><i>Logging</i></b><br><i>Operations</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-12-009 updated=2026-11-26 by="Ntokozo Maselala" body=091c422277db -->

# Logging

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

**Implemented:** structured JSON logs (pino, via Fastify) to stdout, one
entry when each request arrives and one when it completes, both with the
request id; business-rule errors at `warn` with their code; unexpected
errors at `error` with the stack. Level from `LOG_LEVEL` (default `info`;
`silent` in CI integration runs). Pretty-printed only in development.

**Planned:** one entry per domain event (`InventoryIssued`,
`GoodsReceived`, …) with actor id, entity id and outcome — events are
dispatched but not logged (TD-007).

Never log passwords, tokens, or full audit before/after payloads at INFO
level. *Unverified* as a guarantee: no code logs request bodies or the
authorization header, but there is no redaction configured either.
Log shipping and retention are not defined in the repository.

## Evidence
- `afrinov-platform/apps/backend/src/server.ts:48-70,180-199`
- `.github/workflows/backend-ci.yml:76`
