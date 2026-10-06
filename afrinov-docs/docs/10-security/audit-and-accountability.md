# Audit & Accountability

Every mutating action is logged (`07-data/audit-model.md`). The audit log
is read-only to everyone except the system itself, and viewable (read-only)
by Admin. This is the direct fix for the AS-IS system's complete absence of
"who changed this and when" — flagged repeatedly across
`02-business-analysis/gap-analysis.md` as the highest-value gap.
