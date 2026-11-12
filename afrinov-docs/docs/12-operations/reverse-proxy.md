# Reverse Proxy

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** feature/audit-p1-go-live-safety, 2026-11-11

The screens call the API at the relative path `/api/v1`
(`apps/frontend/src/api/client.ts`), so in production one web server must
serve the built screens and pass `/api/v1` to the backend on the same address.
That server is the reverse proxy. The repository did not define one (system
audit F4, discrepancy D-36); this page does.

## Why the backend must be told about it

Behind a proxy every request reaches the backend from the proxy's address.
Sign-in allows 5 tries a minute per address, so without this setting five
mistyped passwords by anyone at the counter would stop everyone signing in for
a minute, and the logs would show only the proxy.

Set `TRUST_PROXY` on the backend to the proxy's address as the backend sees
it:

| Setup | `TRUST_PROXY` |
|---|---|
| Proxy on the same machine, backend on `127.0.0.1:4000` | `127.0.0.1` |
| Proxy in the same Docker network | that network's range, for example `172.18.0.0/16` |
| No proxy (development, tests) | leave unset |

Only the addresses listed are believed. `true` and hop counts are refused at
start-up: either would believe the `X-Forwarded-For` header from anyone, and
let them choose the address the limit counts.

Sign-in is also limited per account, whatever the address: 10 wrong passwords
in 15 minutes and that account waits, or an Admin sets a temporary password.

## Example: nginx

This is the finished configuration, after Certbot has added HTTPS. To set it
up from scratch, start from the plain-HTTP version in `deployment.md`, Part 6,
and let Certbot add the rest.

```nginx
server {
    listen 443 ssl;
    server_name stock.afrinov.example;           # the real name
    # ssl_certificate and ssl_certificate_key: from the host

    root /srv/afrinov/frontend/dist;             # npm run build output
    location / {
        try_files $uri /index.html;              # the screens are one page
    }

    location /api/v1/ {
        proxy_pass http://127.0.0.1:4000;        # the backend
        proxy_set_header Host $host;
        # Replaces any header the browser sent, so it can't be faked.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 12m;                # quotation PDFs go up to 10 MB
    }
}

server {                                         # plain HTTP only redirects
    listen 80;
    server_name stock.afrinov.example;
    return 301 https://$host$request_uri;
}
```

With this, the backend runs with `TRUST_PROXY=127.0.0.1`. `CORS_ORIGIN` can
stay unset: the screens and the API share one address.

Set `proxy_set_header X-Forwarded-For $remote_addr`, not
`$proxy_add_x_forwarded_for`: the second keeps whatever the browser claimed.

## Checking it

After deploying, sign in from two computers and look at the backend log:
each `incoming request` line should show that computer's address, not
`127.0.0.1`.

## Evidence
- `afrinov-platform/apps/backend/src/shared/config.ts` — `resolveTrustProxy`
- `afrinov-platform/apps/backend/src/server.ts` — `trustProxy`, the sign-in limit
- `afrinov-platform/apps/backend/src/modules/identity/login-throttle.ts` — the per-account limit
