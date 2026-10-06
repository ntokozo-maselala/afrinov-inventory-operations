# Interaction Model

- **Issue/receive flows are optimised for speed on the shop floor** — large
  touch-friendly controls, autocomplete search for material/tool by name or
  SKU, minimal required fields (project number optional, per BR-004).
- **Errors are specific and actionable**, matching `08-api/error-model.md`
  — "only 12 available at D-1" rather than a generic failure.
- **Master-data screens (Admin) surface potential duplicates** — e.g.
  creating a Location named "Storeroom" when "STOREROOM" already exists
  should prompt "did you mean...?" rather than silently creating a
  duplicate, directly addressing the AS-IS location-naming problem.
