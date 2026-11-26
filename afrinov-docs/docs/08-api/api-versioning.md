<!-- afrinov:document-control: written by `npm run docs:stamp` from docs/document-control/register.json. Do not edit by hand. -->
<table>
<tr>
<td width="104" align="center"><img src="../../../docs/document-control/assets/afrinov-logo-header.png" alt="Afrinov" width="80"><br><sub>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</sub></td>
<td align="center"><sub>Document ID</sub><br><b>AFRI-OMS-08-004</b></td>
<td align="center"><b><i>API Versioning</i></b><br><i>API Reference</i></td>
<td align="center"><sub>Last updated</sub><br><b>26/11/2026</b><br><sub>by Ntokozo Maselala</sub></td>
</tr>
</table>
<!-- /afrinov:document-control id=AFRI-OMS-08-004 updated=2026-11-26 by="Ntokozo Maselala" body=1050b2267f0c -->

# API Versioning

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** 4e6d76f, 2026-10-09

- Version in the URL path: `/api/v1/...`. This is the only version; every
  module is registered under that prefix. The health checks are also served
  unversioned at `/health` and `/health/ready`.
- Breaking changes require a new version (`/api/v2/...`); additive changes
  (new optional field, new endpoint) do not.
- The one consumer today is the platform's own frontend, which calls
  `/api/v1` directly. Versioning discipline matters most once external
  integrations start depending on the API.
- The OpenAPI document's `info.version` is the backend package version, not
  the API path version.

## Evidence
- `afrinov-platform/apps/backend/src/server.ts:246-278`
- `afrinov-platform/apps/frontend/src/api/client.ts:61`
- `afrinov-platform/apps/backend/src/openapi/document.ts:583-592`
