# API Versioning

- Version in the URL path: `/api/v1/...`.
- Breaking changes require a new version (`/api/v2/...`); additive changes
  (new optional field, new endpoint) do not.
- Given this is a new system with one internal consumer (its own frontend)
  initially, versioning discipline matters most once/if external
  integrations (Finance, etc.) start depending on the API.
