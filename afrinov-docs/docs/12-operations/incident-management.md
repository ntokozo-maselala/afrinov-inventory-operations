# Incident Management

Any incident that could have caused an incorrect stock balance (a
deployment bug, a failed migration, a database anomaly) is treated as high
severity regardless of user-visible impact, given how central balance
correctness is to this project's purpose. Post-incident: a reconciliation
check (`07-data/data-quality.md`) before declaring resolved.
