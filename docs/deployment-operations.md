# Deployment & operations

[← Back to index](README.md)

## Environment variables

| Variable | Required | Local value | Production value | Purpose |
|---|:-:|---|---|---|
| `DATABASE_URL` | ✔ | `postgresql://erp:erp_dev_pw@127.0.0.1:5433/hosiery_erp?schema=public` | Supabase **transaction pooler** (port 6543) + `?pgbouncer=true&connection_limit=1` | App's database connection |
| `DIRECT_URL` | ✔ | same as `DATABASE_URL` | Supabase **session/direct** connection (port 5432) | Used only by `prisma migrate` |
| `APP_URL` | ✔ | `http://localhost:3200` | `https://<your-app>.vercel.app` | Same-origin check for mutations |
| `INSECURE_COOKIES` | | `false` | `false` | `true` only for plain-HTTP LAN installs |
| `UPLOAD_MAX_BYTES` | | `2097152` | `2097152` | Max product image size |
| `SEED_DEMO` | | `true` | `false` | `false` = seed only settings + users |
| `SEED_ADMIN_PASSWORD` / `SEED_STORE_PASSWORD` / `SEED_SALES_PASSWORD` | seed only | `admin123` / `store123` / `sales123` | strong (8+ chars; required when `SEED_DEMO=false`) | Initial passwords |

Files: `.env` (local), `.env.test` (integration tests), `.env.example` (template, committed), `.env.vercel` (production values, **not committed**). All `.env*` files except `.env.example` are git-ignored.

> Use `127.0.0.1`, not `localhost`, for the local database. On Windows `localhost` can resolve to IPv6 (`::1`), which Docker Desktop doesn't forward, causing random "Can't reach database server" errors.

## Local development

```bash
docker run -d --name hosiery-pg -e POSTGRES_USER=erp -e POSTGRES_PASSWORD=erp_dev_pw \
  -e POSTGRES_DB=hosiery_erp -p 5433:5432 postgres:16-alpine
cp .env.example .env
npm install            # runs prisma generate
npm run db:migrate     # apply migrations
npm run db:seed        # demo data + admin/store/sales users (skips if users exist)
npm run dev -- -p 3200 # or: npm run build && npx next start -p 3200
```

Fresh database → migrate → seed → working app. Migrations never reset data.

## The seed (`prisma/seed.ts`)

```mermaid
flowchart TD
    A["npm run db:seed"] --> B{"any users already?"}
    B -- yes --> SKIP["'Database already has data — seed skipped.'"]
    B -- no --> C{"SEED_DEMO = false?"}
    C -- yes --> P1["require strong SEED_*_PASSWORD (8+, not the demo ones)"]
    P1 --> P2["keep/create default settings row"]
    P2 --> P3["create users: Owner (admin), Store, Sales"] --> END1["done (empty shop)"]
    C -- no --> D1["demo settings (Sri Lakshmi Hosiery, GST 5 %)"]
    D1 --> D2["3 users · 7 categories · 3 suppliers · 4 customers"]
    D2 --> D3["6 finished products (34 variants) · 4 raw materials"]
    D3 --> D4["purchases (received) · BOMs"]
    D4 --> D5["14 days of sales with interleaved production runs<br/>(chronological, so ledger balances read correctly)"]
    D5 --> D6["credit sale · dispatched order · pending dispatch ·<br/>good + damaged returns · damage adjustment · one low-stock item"]
    D6 --> V["verifyLedgerIntegrity() must be empty, else abort"]
```

Everything is created **through the real services**, so seeded data obeys every rule. The demo data is back-dated over the past days so the charts have history.

## Deploying to Vercel + Supabase

```mermaid
flowchart LR
    GH["GitHub repo (main)"] -->|push| VC["Vercel build (region sin1)"]
    VC --> C1["node scripts/check-deploy-env.mjs<br/>(fails if DB vars missing or local)"]
    C1 --> C2["prisma generate"]
    C2 --> C3["prisma migrate deploy<br/>(via DIRECT_URL, port 5432)"]
    C3 --> C4["next build"]
    C4 --> RUN["Serverless functions"]
    RUN -->|"DATABASE_URL (pooler, 6543)"| SB[("Supabase PostgreSQL<br/>ap-southeast-1")]
    C3 -->|DIRECT_URL| SB
```

1. **Supabase:** Project → *Connect* → *ORMs → Prisma*. Copy the transaction-pooler URL (6543) and the session/direct URL (5432), with your database password.
2. **Vercel:** *Add New → Project* → import the GitHub repo. In **Environment Variables** add `DATABASE_URL`, `DIRECT_URL`, `APP_URL` (paste values **without** quotes; tick Production and Preview).
3. **Deploy.** `vercel-build` runs the env check, `prisma generate`, `prisma migrate deploy` and `next build`. Tables are created automatically on the first build.
4. **Create the users once** from your computer against the production DB:

   ```bash
   DATABASE_URL=<direct url> DIRECT_URL=<direct url> SEED_DEMO=false \
   SEED_ADMIN_PASSWORD=… SEED_STORE_PASSWORD=… SEED_SALES_PASSWORD=… npm run db:seed
   ```

5. Sign in as `admin`. Fill in **Settings** (business name, address, GSTIN, tax). Ask everyone to change their password.

`vercel.json` pins the functions to **Singapore (`sin1`)**, next to the Supabase database in `ap-southeast-1`. Keep the app and database in the same region, otherwise every query crosses regions.

**Why two database URLs?** The app runs as many short-lived serverless functions, so it connects through Supabase's pooler. Migrations need a direct session connection, because they use locks that a transaction pooler doesn't support.

## Docker (self-hosted alternative)

```bash
export POSTGRES_PASSWORD='strong-password' APP_URL='https://erp.yourshop.in'
docker compose up -d --build                 # migrations run on container start
docker compose exec app npm run db:seed      # first run only
```

`Dockerfile`: multi-stage Node 22 Alpine build (`NODE_OPTIONS=--max-old-space-size=4096` for the build). Runtime command: `prisma migrate deploy && next start`. Put it behind HTTPS (Caddy/Nginx); HTTPS is required for secure cookies and the camera scanner.

## Health check

`GET /api/health` → `200 {"status":"ok","db":"up"}` or `503 {"status":"error","db":"down"}`. Use it for uptime monitoring.

## Backups

* **Supabase:** automatic daily backups on paid plans. Also export periodically: `pg_dump "<DIRECT_URL>" > backup.sql`.
* **Docker:** back up the `pgdata` volume, e.g. a nightly `pg_dump` via cron.
* Product images live in the database (`StoredFile`), so a database backup covers them.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Vercel build: `Environment variable not found: DIRECT_URL` | variable missing or set only for another environment | add it for Production, redeploy |
| Vercel build: `Can't reach database server at 127.0.0.1:5433` / env check fails "points at a local database" | local URLs pasted into Vercel | use the Supabase URLs from `.env.vercel` |
| Random "Can't reach database server at localhost:5433" locally | `localhost` resolved to IPv6 | use `127.0.0.1` in `.env` |
| Pages show "Something went wrong" right after start | database not running / unreachable | start the DB container; check `/api/health` |
| Login works locally but not on plain-HTTP LAN | `Secure` cookie on http | serve over HTTPS, or `INSECURE_COOKIES=true` on a trusted LAN |
| Camera button says camera unavailable | page not on HTTPS (or not localhost) | use HTTPS |
| "Too many login attempts" | 8 failures in 5 min for that IP + username | wait 5 minutes |
| Search/pagination click does nothing | a `loading.tsx` was added | remove it; see [Frontend](frontend.md#why-there-are-no-loadingtsx-files-and-no-prefetching) |
| Seed: "must be set to a strong password" | `SEED_DEMO=false` with weak/missing passwords | set strong `SEED_*_PASSWORD` values |
| Seed: "Database already has data — seed skipped" | users exist | expected; create more users from **Users** |
| Docker build: JavaScript heap out of memory | small Docker VM | the Dockerfile sets 4 GB heap; give Docker more memory |

## Known limitations

* The login rate limiter is per server process (not shared across serverless instances).
* Images are stored in PostgreSQL. That's fine for product photos; use object storage for thousands of large images.
* Accounting is document-level (payables/receivables per invoice), with no general ledger.
* Held POS carts live in that browser only and don't reserve stock.
