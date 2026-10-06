# Secrets Management

Database credentials, JWT signing secrets, and any future third-party API
keys are stored in environment variables or a secrets manager appropriate
to the deployment target — never committed to source control, never logged.
Rotate credentials on suspected compromise or role change (e.g. a departing
admin).
