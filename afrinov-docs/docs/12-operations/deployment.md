# Deployment

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** feature/audit-p1-go-live-safety (ADR-036, ADR-037), 2026-11-12

This is the step-by-step guide for putting Afrinov Inventory into production,
from an empty server to the day the workbook is retired, and for looking after
it afterwards. Follow the parts in order and tick each step. Commands are for
the server's terminal unless a step says otherwise. Where a value is yours to
choose, it is shown in angle brackets, like `<stock.afrinov.co.za>`.

**Who does it:** an Admin comfortable with a Linux terminal, or the business's
IT provider, with the business owner for the decisions in Part 0. Allow one
day for Parts 1 to 8, and the go-live weekend for Part 10.

## How it fits together

```
 Browser at the store ── HTTPS ──▶ nginx on the server (screens + /api/v1)
                                        │ 127.0.0.1:4000
                                        ▼
                                  backend container ── 127.0.0.1:5432 ──▶ db container (PostgreSQL 16)
                                                                               ▲
                                  backup container ── every evening ───────────┘
                                        │ encrypted copies
                                        ├──▶ backup disk on the server (7 days)
                                        └──▶ Azure Blob Storage, Johannesburg (30 days daily, 12 months monthly)
```

Everything except nginx runs in Docker, from `apps/backend/docker-compose.yml`
with the production overrides in `apps/backend/docker-compose.prod.yml`. The
database and the API answer only on the server itself; only nginx (ports 80
and 443) faces the network.

---

## Part 0 — Decide and gather before you start

| # | What | Recommended | Why |
|---|---|---|---|
| 0.1 | **The server** | A small Ubuntu 24.04 LTS virtual machine in Azure *South Africa North* (2 vCPU, 4 GB RAM, for example size B2s), with a second 32 GB data disk for backups | The business already uses Microsoft 365 and the backups go to Azure in Johannesburg; a cloud server keeps running through load-shedding at the store. Any Ubuntu 24.04 server with these resources works, including one in the office on a UPS. RECOMMENDED |
| 0.2 | **The web address** | `stock.afrinov.co.za` | Whoever manages the `afrinov.co.za` DNS adds an A record pointing it at the server's public IP address. |
| 0.3 | **Two Admins** | Two named people | One resets the other's forgotten password; once two exist, the system keeps two (ADR-036). |
| 0.4 | **Who holds the backup key** | Both Admins in a password manager; the business owner a sealed paper copy | Lose every copy of the key and every backup is lost with it. |
| 0.5 | **Azure subscription** | Pay-as-you-go, under Afrinov's Microsoft account | Microsoft 365 doesn't include Azure. Needed for the server (if 0.1 is followed) and for backups. |
| 0.6 | **The workbook and the count date** | The current stock workbook, and the date of the go-live stock count | The import loads the counted balances once, dated the count day (Part 10). |
| 0.7 | **The store's people** | Names and roles for every account, and each worker's counter PIN | Accounts are created in Part 7; PINs let people confirm what they collect (ADR-034). |

Also have ready: SSH access to the server, an account that can use `sudo`,
and the Git URL of this repository.

---

## Part 1 — Prepare the server

**1.1 Update it and set the time zone** (backups and reports follow it):

```sh
sudo apt update && sudo apt -y upgrade
sudo timedatectl set-timezone Africa/Johannesburg
```

**1.2 Install Docker Engine and the Compose plugin** (Compose 2.24 or later is
needed for the production overrides). Follow Docker's guide for Ubuntu
(docs.docker.com → Install Docker Engine on Ubuntu, "Install using the apt
repository"), then:

```sh
sudo usermod -aG docker "$USER"     # sign out and back in afterwards
docker compose version              # must show v2.24 or later
```

**1.3 Install Node 24** (to build the screens and run the import and check
scripts), Git, nginx and Certbot:

```sh
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git nginx certbot python3-certbot-nginx
node --version                      # v24.x
```

**1.4 Mount the backup disk** at `/mnt/backup` (Azure: attach the data disk
from 0.1 first). Find it with `lsblk`; it is the empty disk of the size you
chose, for example `/dev/sdc`. Only for a new, empty disk:

```sh
sudo mkfs.ext4 /dev/<sdc>
sudo mkdir -p /mnt/backup
echo "UUID=$(sudo blkid -s UUID -o value /dev/<sdc>) /mnt/backup ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab
sudo mount -a && df -h /mnt/backup
sudo mkdir -p /mnt/backup/afrinov && sudo chown 70 /mnt/backup/afrinov   # uid 70 is the backup service
```

**1.5 Open only what is needed.** On Azure, the network security group allows
22 (from the office's address only), 80 and 443. On the server:

```sh
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

- [ ] Server updated, time zone Africa/Johannesburg
- [ ] Docker and Compose 2.24+, Node 24, nginx, Certbot installed
- [ ] Backup disk mounted at `/mnt/backup`, `/mnt/backup/afrinov` owned by uid 70
- [ ] Firewall: only SSH, 80 and 443

---

## Part 2 — Get the code

```sh
sudo mkdir -p /opt/afrinov && sudo chown "$USER" /opt/afrinov
git clone <repository URL> /opt/afrinov
cd /opt/afrinov
git checkout main
git log --oneline -1                # note the commit: it is the version going live
cd afrinov-platform && npm ci
```

- [ ] Code at `/opt/afrinov`, commit noted
- [ ] `npm ci` finished without errors

---

## Part 3 — Configure

All production settings live in one file, `apps/backend/.env`, which Git
ignores. Make the secrets first, each on its own (hex keeps them safe inside
the database address):

```sh
cd /opt/afrinov/afrinov-platform/apps/backend
openssl rand -hex 24   # POSTGRES_PASSWORD
openssl rand -hex 48   # JWT_SECRET
openssl rand -hex 12   # SEED_ADMIN_PASSWORD (the first admin password; changed at first sign-in)
```

Create the file with `nano .env` (put each value straight in; never paste them
into email or chat):

```sh
# Use both Compose files, so plain `docker compose ...` is the production stack.
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml

NODE_ENV=production
POSTGRES_PASSWORD=<the first value>
JWT_SECRET=<the second value>
SEED_ADMIN_PASSWORD=<the third value>

# nginx on this machine is the reverse proxy (reverse-proxy.md).
TRUST_PROXY=127.0.0.1

# Backups (Part 8). BACKUP_REMOTE stays empty until the Azure step is done.
BACKUP_DISK=/mnt/backup/afrinov
BACKUP_REMOTE=
BACKUP_AT=18:30

# For the import and check scripts run on this server (not used by the containers).
DATABASE_URL=postgresql://afrinov:<the first value>@127.0.0.1:5432/afrinov?schema=public
```

```sh
chmod 600 .env
```

| Setting | What it does |
|---|---|
| `COMPOSE_FILE` | Makes every `docker compose` command include the production overrides |
| `NODE_ENV` | `production`: refuses weak secrets and demo data |
| `POSTGRES_PASSWORD` | The database password; the backend's address is built from it |
| `JWT_SECRET` | Signs sign-ins; at least 32 bytes; changing it signs everyone out |
| `SEED_ADMIN_PASSWORD` | Creates `admin@afrinov.local` on the first start; required on every start, and never changes an existing password |
| `TRUST_PROXY` | The proxy's address, so sign-in limits count each person, not the proxy (ADR-036) |
| `BACKUP_DISK`, `BACKUP_REMOTE`, `BACKUP_AT` | Where and when backups go (ADR-037) |
| `DATABASE_URL` | Lets the scripts in Parts 10 and 11 reach the database from this server |

Optional, with their defaults: `PROCUREMENT_ENABLED=true`,
`API_DOCS_ENABLED` (off in production), `BACKUP_KEEP_DAYS=7`,
`RATE_LIMIT_AUTH=5`, `RATE_LIMIT_GLOBAL=1000`. Leave `CORS_ORIGIN` unset: the
screens and the API share one address.

Write the three secrets into the password manager now.

- [ ] `apps/backend/.env` written, `chmod 600`
- [ ] Secrets stored in the password manager

---

## Part 4 — Start the database and the API

```sh
cd /opt/afrinov/afrinov-platform/apps/backend
docker compose up -d --build db backend
docker compose logs backend | tail -30
```

The log should show the migrations applied, then **"Seed complete: roles,
permissions, settings and the admin account. No demo data"**, then the server
listening. Check it from the server:

```sh
curl -s http://127.0.0.1:4000/health/ready     # {"status":"ready","database":"connected",...}
docker compose ps                               # db and backend "running"; db port 127.0.0.1:5432 only
```

If the backend stops at once, read `docker compose logs backend`: a missing
`SEED_ADMIN_PASSWORD`, a short `JWT_SECRET` or `TRUST_PROXY=true` each stop it
with a message saying so.

- [ ] Backend healthy, no demo data
- [ ] Ports show `127.0.0.1` only

---

## Part 5 — Build the screens

```sh
cd /opt/afrinov/afrinov-platform
npm run build --workspace=@afrinov/frontend
sudo mkdir -p /srv/afrinov/frontend
sudo rsync -a --delete apps/frontend/dist/ /srv/afrinov/frontend/
```

The build refuses to run if demo mode is switched on
(`VITE_FRONTEND_ONLY` or `VITE_DEMO_AUTH_ENABLED`), so a production bundle
always talks to the real API.

- [ ] Screens built and copied to `/srv/afrinov/frontend`

---

## Part 6 — The web address and HTTPS

**6.1** Check the DNS record from 0.2 has reached the server:
`dig +short <stock.afrinov.co.za>` shows its public IP.

**6.2** Create `/etc/nginx/sites-available/afrinov` (`sudo nano ...`) with
plain HTTP first; Certbot turns it into HTTPS in the next step:

```nginx
server {
    listen 80;
    server_name <stock.afrinov.co.za>;

    root /srv/afrinov/frontend;
    location / {
        try_files $uri /index.html;              # the screens are one page
    }

    location /api/v1/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        # Replaces whatever the browser sent, so the address can't be faked.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 12m;                # quotation PDFs go up to 10 MB
    }
}
```

```sh
sudo ln -s /etc/nginx/sites-available/afrinov /etc/nginx/sites-enabled/afrinov
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx --redirect -d <stock.afrinov.co.za>   # a free certificate, renewed automatically
sudo certbot renew --dry-run                                # proves renewal will work
```

Certbot adds the HTTPS server and sends plain HTTP to it. Why each line is
there: `reverse-proxy.md`.

**6.3** From a computer at the store, open `https://<stock.afrinov.co.za>`:
the sign-in page appears with a padlock. Check the API through the proxy:
`https://<stock.afrinov.co.za>/api/v1/health/ready`.

**6.4** Sign in once (Part 7), then on the server run
`docker compose logs backend | grep "incoming request" | tail -3`: the
addresses shown should be the store's, not `127.0.0.1`. If they are
`127.0.0.1`, `TRUST_PROXY` or the nginx `X-Forwarded-For` line is wrong.

- [ ] HTTPS works at the web address, certificate from Certbot
- [ ] Logs show the store's address

---

## Part 7 — First sign-in and setup in the app

**7.1** Sign in as `admin@afrinov.local` with `SEED_ADMIN_PASSWORD`. At once
choose **Change password** in the header and set a strong one. Every other
sign-in of the account ends.

**7.2 Settings**, as Admin, in this order:

| Section | Set |
|---|---|
| General | Company name; where people start |
| Purchase orders | Afrinov's VAT number, delivery address and contact, invoice and RFQ email addresses, the order small print; **first order number** set past the last number used in the workbook; who signs from what amount; exchange rates for USD, EUR and GBP |
| Inventory | Write-off approval limit; tool loan periods; receipt confirmation on **Ask** for now; how long slip photos are kept |
| Projects | Days the business is closed |
| Security | Minutes without activity before sign-out (60 unless the business says otherwise) |

**7.3 Accounts** (Settings → Users): one per person, with their real email and
the roles their job needs (the store controller, Procurement, the signers,
technicians). Give the **second Admin** the Admin role now; until then
Settings → Users and the Dashboard warn. The password you type for each new
account is a starting one: the person signs in with it once and must choose
their own, so nobody else knows it. Tell them the starting password in
person.

**7.4 Recipients and PINs** (Recipients): the workers, contractors, machines
and sites stock is issued to; set each worker's and contractor's counter PIN.
Once every PIN is set and the counter is ready, change receipt confirmation
from **Ask** to **Required** (Inventory settings).

Recipients, suppliers and projects in the workbook are also created by the
import in Part 10; anything created here first is kept, not duplicated.

- [ ] Admin password changed
- [ ] Settings filled in, first order number past the workbook's
- [ ] Accounts created, second Admin given the role
- [ ] Recipients and PINs (or noted for Part 10)

---

## Part 8 — Backups

Full detail: `backup-and-recovery.md`. In short, from
`/opt/afrinov/afrinov-platform/apps/backend`:

**8.1 The key:**

```sh
mkdir -p secrets
openssl rand -base64 32 | tr -d '\n' > secrets/backup_key
sudo chown 70 secrets/backup_key && sudo chmod 400 secrets/backup_key
```

Copy the key into both Admins' password managers and onto the owner's sealed
paper copy (0.4) now.

**8.2 The off-site store in Azure.** Install the Azure CLI
(learn.microsoft.com → "Install the Azure CLI on Linux"), sign in to
Afrinov's Microsoft account, and run the setup:

```sh
az login                              # opens a sign-in page; use a browser on any device
bash backup/azure-setup.sh            # prints the storage account name: store it with the key
sudo chown 70 secrets/rclone.conf && sudo chmod 400 secrets/rclone.conf
```

Set `BACKUP_REMOTE=offsite:afrinov-backups` in `.env`.

**8.3 Start it and test it:**

```sh
docker compose up -d backup
docker compose run --rm backup now
docker compose run --rm --entrypoint /opt/afrinov-backup/restore.sh backup latest --drill
```

The first prints "copied off site", the second "restore test passed". In the
app, Settings → Data & backup shows both as green. Record the date, the file
and who did it in `docs/engineering/VERIFICATION_EVIDENCE.md`.

**8.4 A week later**, after seven good backups, lock the 30-day rule with the
command `azure-setup.sh` printed. It can't be undone.

- [ ] Key made and stored in three places
- [ ] Azure set up, `BACKUP_REMOTE` set
- [ ] First backup off site, restore test passed, evidence recorded
- [ ] Reminder set to lock the rule after a week

---

## Part 9 — Rehearse before go-live

The import runs **once** per database (`opening-balance.service.ts`). The
pilot import and the two-week parallel run therefore happen on a separate
rehearsal copy, never on production (`workbook-replacement-roadmap.md`,
Cutover and go-live):

1. On another machine (or the same server, as a second stack in another
   folder with its own `.env`, other ports and no backup service), follow
   Parts 2 to 5 with `SEED_DEMO_DATA` unset.
2. Run the import into it (Part 10, steps 10.2 to 10.5) and work in it beside
   the workbook for two weeks.
3. At the go/no-go meeting, check the go-live gate in the roadmap. Then
   delete the rehearsal stack, its database included.

- [ ] Rehearsal done, go-live gate passed, rehearsal deleted

---

## Part 10 — Go-live day

**10.1** Close the store for the count and count every location onto the
workbook's count sheets. Production holds no stock yet, so the count screen
isn't used for this.

**10.2** Update the workbook with the counts. Put it on the server, for
example in `/opt/afrinov/import/`, then run the dry run until it reports no
blocking problems. From `/opt/afrinov/afrinov-platform/apps/backend`:

```sh
npm run import:workbook -- --file /opt/afrinov/import/<workbook.xlsm>
```

The first run writes `import-reports/mapping.xlsx` and
`import-reports/master-data.xlsx`; the store controller and the buyer review
and correct them, then run it again.

**10.3** Optionally load the supplier list from the order template the same
way: `npm run import:suppliers -- --file <file>`, then with
`--apply --database afrinov --actor <your email>`.

**10.4 Take a backup first:** `docker compose run --rm backup now`.

**10.5 The one production import**, dated the count day, as your own account:

```sh
npm run import:workbook -- --file /opt/afrinov/import/<workbook.xlsm> \
  --apply --database afrinov --date <YYYY-MM-DD> --actor <your email>
npm run import:workbook -- --file /opt/afrinov/import/<workbook.xlsm> --reconcile
npm run check:issued-stock && npm run check:catalogue && npm run check:units
```

The reconciliation compares item counts and rand values per category with
the workbook; every difference must be explained before going on. A mistake
found after this is corrected with the count screen or an adjustment, never a
second import.

**10.6** In Settings → Inventory, set where project deliveries are booked, now
that the locations exist. Open the store: from this moment every entry goes
into the app.

**10.7** Save the workbook read-only with the go-live date in its name. No
further entries.

**10.8** Take a backup: `docker compose run --rm backup now`.

- [ ] Count done, dry run clean, mapping reviewed
- [ ] Backup before the import
- [ ] Import applied, reconciled, checks clean
- [ ] Project delivery location set, workbook archived, backup after

---

## Part 11 — Looking after it

| When | Who | What |
|---|---|---|
| Every working day | Admin | Glance at the Dashboard: a **Backups** or **Admins** card means something needs doing |
| Every week | Admin | `docker compose ps` all running; `df -h /mnt/backup` has room |
| Every three months | Admin, then the owner | Restore test (8.3, second command); the owner signs it off under Settings → Data & backup |
| Every year, before it lapses | Admin | Renew the backup service's Azure access: `ACCOUNT=<name> RG=rg-afrinov-backups bash backup/azure-setup.sh renew` |
| Monthly | Admin | `sudo apt update && sudo apt -y upgrade`, then `sudo reboot` if asked; the containers start again on their own |

### Installing a new version

```sh
cd /opt/afrinov/afrinov-platform/apps/backend
docker compose run --rm backup now                  # a backup before every change
cd /opt/afrinov && git fetch && git checkout <new commit or tag>
cd afrinov-platform && npm ci
cd apps/backend && docker compose up -d --build     # applies new migrations on start
docker compose logs backend | tail -30
cd /opt/afrinov/afrinov-platform && npm run build --workspace=@afrinov/frontend
sudo rsync -a --delete apps/frontend/dist/ /srv/afrinov/frontend/
```

Then sign in and open Stock and Movements. Migrations only go forward: going
back to an older version across a database change means restoring the backup
taken first (`backup-and-recovery.md`, "Restoring in earnest").

### When something goes wrong

| What you see | What to do |
|---|---|
| Someone forgot their password | The other Admin sets a temporary one (Settings → Users → Temporary password) |
| Every Admin is locked out | On the server: put a new `SEED_ADMIN_PASSWORD` in `.env`, then `npm run db:rotate-admin --workspace=@afrinov/backend` (resets `admin@afrinov.local` only) |
| "Too many sign-in attempts" | Wait 15 minutes, or an Admin sets a temporary password for that account |
| The site doesn't load | `docker compose ps`; `sudo systemctl status nginx`; `docker compose logs backend` |
| Dashboard: backups failed or late | Settings → Data & backup shows the reason; `docker compose logs backup` |
| The server is lost | A new server through Parts 1 to 6, then `backup-and-recovery.md`, "Restoring in earnest", from the newest off-site copy |

## Evidence
- `afrinov-platform/apps/backend/docker-compose.yml`, `docker-compose.prod.yml` — the stack and its production ports
- `afrinov-platform/apps/backend/Dockerfile`, `backup/Dockerfile`
- `afrinov-platform/apps/backend/src/db/seed-plan.ts` — what the seed loads
- `afrinov-platform/apps/backend/src/shared/config.ts` — required settings, `TRUST_PROXY`
- `afrinov-platform/apps/backend/scripts/import-workbook.ts` — the import's dry run, `--apply` and `--reconcile`
- `afrinov-platform/apps/frontend/.env.example` — the build refuses demo mode
- `afrinov-docs/docs/12-operations/reverse-proxy.md`, `backup-and-recovery.md`
- `workbook-replacement-roadmap.md` — Cutover and go-live
