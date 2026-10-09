# Hosiery ERP

A simple, fast ERP for a hosiery business: products with size/colour variants, barcode scanning (USB/Bluetooth scanners and camera), POS billing, purchases, dispatch with scan verification, customer and supplier returns, damaged stock, stock adjustments, simple manufacturing (BOM → production), stock ledger, reports, roles and an audit log.

> 📘 **Full technical documentation:** [docs/README.md](docs/README.md) — how every feature works end to end, with diagrams.

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui (Radix) · React Hook Form · Zod · TanStack Query/Table · PostgreSQL 16 · Prisma 6 · Vitest · Playwright.

---

## Quick start (local development)

Prerequisites: Node.js 20+ (tested on 24), Docker (or any PostgreSQL 14+).

```bash
# 1. Database (PostgreSQL on port 5433)
docker run -d --name hosiery-pg -e POSTGRES_USER=erp -e POSTGRES_PASSWORD=erp_dev_pw \
  -e POSTGRES_DB=hosiery_erp -p 5433:5432 postgres:16-alpine

# 2. App
cp .env.example .env          # adjust DATABASE_URL if needed
npm install                   # also runs `prisma generate`
npm run db:migrate            # apply migrations (prisma migrate deploy)
npm run db:seed               # demo data + users (skips if data exists)
npm run dev                   # http://localhost:3000  (or: npx next dev -p 3200)
```

Fresh database → `npm run db:migrate` → `npm run db:seed` → app works. Migrations are never destructive; there is no reset step in normal use.

### Test credentials (seeded)

| Role | Username | Password |
|---|---|---|
| Admin / Owner | `admin` | `admin123` |
| Store / Warehouse | `store` | `store123` |
| Sales / Billing | `sales` | `sales123` |

Change these after the first login (account menu → Change password). Seed passwords can be set with `SEED_*_PASSWORD` env vars.

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run start:prod` | `prisma migrate deploy` then `next start` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:migrate:dev` | Create a new migration after editing `schema.prisma` |
| `npm run db:seed` | Seed demo data |
| `npm test` | Unit + integration tests (Vitest, real PostgreSQL `*_test` DB) |
| `npm run test:e2e` | End-to-end tests (Playwright; builds must exist — run `npm run build` first) |
| `npm run typecheck` / `npm run lint` | Static checks |

Tests use separate databases (`hosiery_erp_test`, `hosiery_erp_e2e`, see `.env.test` and `playwright.config.ts`). The test helpers refuse to wipe any database whose name doesn't end in `_test` / `_e2e`.

---

## Environment variables (`.env.example`)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_URL` | Public URL; used for the same-origin check on mutating API calls |
| `INSECURE_COOKIES` | `true` only when serving production over plain HTTP on a trusted LAN (otherwise the session cookie is `Secure`) |
| `DIRECT_URL` | Direct (non-pooled) connection for migrations; same as `DATABASE_URL` locally |
| `SEED_DEMO` | `false` = seed only settings and users (production) |
| `UPLOAD_MAX_BYTES` | Max image size (default 2 MB) |
| `SEED_ADMIN_PASSWORD` etc. | Initial passwords used by the seed |

Barcode scanning needs no configuration: USB/Bluetooth scanners act as keyboards; the camera scanner (ZXing, lazy-loaded) requires HTTPS or `localhost`.

---

## Architecture

```
prisma/              schema.prisma, migrations/, seed.ts
src/
  app/               Next.js routes — (app)/… pages (server components), api/… route handlers
  components/        ui/ (shadcn), layout/ (shell, nav, command palette), shared/, scanner/, charts/
  features/          client UI per module (pos, purchases, returns, dispatch, manufacturing, …)
  lib/               shared pure code: decimal money, calculations, permissions, barcode, dates, format
  validators/        Zod schemas shared by forms and API
  server/
    auth/            sessions, password hashing, actor & permission assertions
    api/handler.ts   single wrapper for every API route (auth, permission, origin, validation, errors)
    services/        business logic (inventory, product, purchase, sale, return, dispatch, adjustment,
                     production, party, report, user, settings, audit)
    errors.ts        safe, user-friendly errors (raw DB errors are never exposed)
tests/               unit/, integration/ (services against PostgreSQL), e2e/ (Playwright)
```

### The inventory engine (core design)

* Stock is **never edited directly**. Every change goes through `applyStockMovements()` (`src/server/services/inventory.service.ts`), which in the caller's DB transaction:
  1. updates the `StockLevel` row with a **conditional atomic `UPDATE … WHERE onHand + q >= 0`** (row lock — concurrent sales cannot oversell), and
  2. writes an `InventoryTransaction` ledger row with the new running balance and a FK to the source document (sale, purchase, return, adjustment, production, supplier return).
* Two buckets per variant: **sellable** and **damaged**.
* Every document (sale, purchase receipt, return, production, adjustment) is created in **one transaction** with its ledger rows: either everything commits or nothing changes.
* Cancellations post **reversal entries** (`SALE_CANCEL`, `PURCHASE_CANCEL`, `PRODUCTION_CANCEL`); historical documents are never deleted.
* **Idempotency:** each form submits a unique key stored with a UNIQUE constraint; double-clicks, retries and refresh-resubmits return the original document.
* Return limits use an atomic `returnedQty + q <= quantity` update and a DB `CHECK` constraint.
* `verifyLedgerIntegrity()` recomputes every balance from the ledger; it is asserted in tests and by the seed.
* Money is `NUMERIC(12,2)` and calculated with `decimal.js` (the same calculation module runs in the POS preview and on the server).

### Database schema overview

`User`, `Session` · `Setting`, `Counter` (document numbers) · `Category` (with subcategories), `Supplier`, `Customer` · `Product` → `ProductVariant` (SKU, barcode, size, colour, prices, min/reorder) → `StockLevel` · `InventoryTransaction` (ledger) · `Purchase`/`PurchaseItem`, `SupplierReturn`/`Item` · `Sale`/`SaleItem` · `Dispatch`/`DispatchItem` · `CustomerReturn`/`Item` · `StockAdjustment`/`Item` · `BillOfMaterial`/`Item`, `Production`/`ProductionItem` · `AuditLog`. Foreign keys use `RESTRICT` for history, unique constraints on SKU/barcode/codes/idempotency keys, indexes on SKU, barcode, names (trigram GIN for fast `ILIKE`), invoice numbers, parties and dates, plus `CHECK` constraints (positive quantities, return ≤ sold, non-negative damaged stock, etc.).

### Main routes

`/login` · `/dashboard` · `/sales` · `/sales/new` (POS) · `/sales/[id]` (invoice, print) · `/purchases`, `/purchases/new`, `/purchases/[id]` · `/dispatch`, `/dispatch/[id]` · `/returns`, `/returns/new`, `/returns/[id]` · `/inventory`, `/inventory/[variantId]` (ledger), `/inventory/adjust` · `/products`, `/products/new`, `/products/[id]`, `/products/[id]/labels`, `/products/register-barcode` · `/manufacturing`, `/manufacturing/new`, `/manufacturing/boms/new`, `/manufacturing/[id]` · `/suppliers`, `/customers` (+ detail) · `/reports/sales|purchases|inventory|stock-movement|production` (CSV export) · `/audit` · `/users` · `/settings` · `/api/health`.

### Roles

| | Admin | Store | Sales |
|---|---|---|---|
| Dashboard | ✔ (with money values) | ✔ | ✔ |
| Products | manage | view | view |
| Inventory view / adjust & damage | ✔ / ✔ | ✔ / ✔ | ✔ / ✘ |
| Purchases create & receive / cancel | ✔ / ✔ | ✔ / ✘ | ✘ |
| Sales (POS) / price override / cancel | ✔ / ✔ / ✔ | view only | ✔ / ✘ / ✘ |
| Dispatch | ✔ | ✔ | view |
| Returns | ✔ | ✔ | ✔ |
| Manufacturing: BOM / produce / cancel | ✔ / ✔ / ✔ | ✘ / ✔ / ✘ | ✘ |
| Suppliers / Customers | manage / manage | view / view | ✘ / manage |
| Reports, Audit log, Users, Settings | ✔ | ✘ | ✘ |

Permissions live in `src/lib/permissions.ts`. Every API route declares its permission in `route()` **and** every service re-checks with `assertCan()`, so the UI can't be bypassed.

### Keyboard & scanning

POS: **F2** focus scan box · **Ctrl/⌘+K** search · **F4** payment · **F9** complete sale · **Esc** clear · `3*<barcode>` adds 3 · ↑/↓ change line quantity. Global: **Ctrl/⌘+K** quick actions, **Alt+N** new sale. Unknown barcodes show "Product not found" with *Create product* / *Register barcode*. Dispatch pages listen for scanner input and verify every unit.

---

## Production deployment

**Vercel + Supabase (recommended):**
1. Supabase → Project → *Connect* → *ORMs → Prisma*: copy the pooled URL (port 6543, add `?pgbouncer=true&connection_limit=1`) and the direct URL (port 5432).
2. Vercel → *Add New Project* (import the GitHub repo, or run `npx vercel`). Set env vars: `DATABASE_URL` (pooled), `DIRECT_URL` (direct), `APP_URL` (your https URL). Region is pinned to Mumbai (`bom1`) in `vercel.json` — pick the Supabase region closest to it (e.g. ap-south-1).
3. Deploy. The `vercel-build` script runs `prisma migrate deploy` before `next build`, so the schema is created automatically.
4. Create the first users once, from your computer, against the production DB:
   `DATABASE_URL=<direct url> DIRECT_URL=<direct url> SEED_DEMO=false SEED_ADMIN_PASSWORD=... SEED_STORE_PASSWORD=... SEED_SALES_PASSWORD=... npm run db:seed`
5. Sign in, open **Settings** and enter your business name, address, GSTIN and tax rate.

Product images are stored in the database (`StoredFile`), so no file storage service is needed.


**Docker Compose (simplest):**
```bash
export POSTGRES_PASSWORD='a-strong-password' APP_URL='https://erp.yourshop.in'
docker compose up -d --build                # migrations run automatically on start
docker compose exec app npm run db:seed     # first run only (creates the users)
```
Put it behind HTTPS (Caddy/Nginx/Traefik) — required for secure cookies and camera scanning. Back up the `pgdata` volume (e.g. nightly `pg_dump`) and the `uploads` volume.

**Bare server / PaaS:** set the env vars, then `npm ci && npm run build && npm run start:prod`. `GET /api/health` returns 200 when the app and database are up.

---

## Test results (at delivery)

* **Unit + integration (Vitest): 64/64 passing** — money precision, sale/purchase/refund calculations, permissions, every inventory workflow against real PostgreSQL, concurrent overselling (8 parallel sales on 5 units → exactly 5 succeed), duplicate submissions, concurrent returns, production races, rate-limited login, session revocation.
* **End-to-end (Playwright, production build): 22/22 passing** — the six required flows plus product creation, damage adjustment, sale cancellation, invoice print layout, reports/CSV, mobile POS, unknown barcodes, and security (401/403, forged session, CSRF origin, price-override and role bypass attempts).
* Smoke test of all 44 pages as admin (desktop and 390px mobile): no console errors, no failed requests, no horizontal overflow.
* Ledger integrity audit after all tests: 0 mismatches.

## Assumptions

* Raw materials are products of type *Raw material* (one engine for purchase, ledger and adjustment); finished goods are sold; raw materials can't be sold.
* Stock is deducted when a sale is confirmed. Dispatch tracks fulfilment (Pending → Packed (all items scan-verified) → Dispatched → Completed); there is no separate "reserved" quantity. Undispatched orders are cancelled (not returned); dispatched ones are returned.
* Tax is one configurable rate applied on the bill after discounts (exclusive). Purchases take a tax rate per line.
* Payment: an empty "amount received" means paid in full (credit sales: nothing paid yet). Credit/partial sales require a customer. Walk-in is the default customer.
* "Damage" moves sellable → damaged stock; "Write off damaged stock" removes it. Adjustments, supplier returns and production never allow negative stock. Sales can go negative only if the setting is enabled (off by default).
* BOMs are per finished variant (with "apply to all sizes/colours"); production quantities that need fractional whole-unit materials (e.g. 1.5 labels) are rejected.
* Day boundaries for dashboard/reports use the business timezone setting (default Asia/Kolkata); timestamps are stored in UTC.
* Held POS carts are stored in the browser of that computer and do not reserve stock.

## Known non-critical limitations

* Login rate limiting is in-memory (per server process); use a shared store if you run several app instances.
* Route-level `loading.tsx` files are intentionally not used: with Next.js 15.5 they intermittently dropped same-page navigations (search/filter changes). Pages render in ~200 ms; search boxes show their own spinner and charts have skeletons. Automatic link prefetching is also off (`src/components/shared/app-link.tsx`).
* The database URL uses `127.0.0.1`, not `localhost`: on Windows, `localhost` can resolve to IPv6, which Docker Desktop does not forward.
* Product images are stored in PostgreSQL (fine for a catalogue of product photos; move to object storage if you store thousands of large images).
* Accounting is intentionally simple: payables/receivables are tracked per document, with no general ledger.
* The seed back-dates demo documents to give charts history; real documents are always timestamped by the server.
