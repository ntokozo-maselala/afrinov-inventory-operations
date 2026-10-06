# Authentication

- Session-based or JWT-based login (implementation choice — either is
  reasonable at this scale; JWT simplifies stateless scaling if needed
  later).
- Credentials: email/username + password, hashed with a standard algorithm
  (e.g. bcrypt/argon2) — never stored or logged in plain text.
- No anonymous access to any endpoint that reads or writes business data;
  this is a hard change from the AS-IS system, where "access control" was
  simply "who has the Excel file."
