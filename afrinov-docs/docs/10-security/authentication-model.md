# Authentication Model

Login with email/username + password; hashed with a modern algorithm
(bcrypt/argon2, sufficient work factor); session or short-lived JWT +
refresh token; logout invalidates the session/token; account lockout or
rate-limiting after repeated failed attempts to resist brute force.
