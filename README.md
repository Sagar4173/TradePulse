# TradePulse

TradePulse is an ordering and distribution platform for FMCG distributors and the kirana retailers they serve. This repository currently contains **Milestone 1: the project foundation** — a production-shaped Next.js application, a PostgreSQL data model, repeatable seed data, a landing page, and a database-aware health check.

Authentication, AI order capture, the scheme calculation engine, and retailer/order-desk dashboards are intentionally **not** implemented yet.

## Stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 24 LTS (`24.x`) |
| Framework | Next.js 16.4.5 (App Router, Turbopack) |
| UI | React 19.3.1, Tailwind CSS 4.3.4, shadcn/ui (Base UI) |
| Language | TypeScript 5.9.3, strict mode |
| Database | Neon Serverless PostgreSQL 18 (AWS Asia Pacific 1 / Singapore) |
| Data access | Prisma 7.10.1 with `@prisma/adapter-pg` |
| Package manager | npm |

## Neon database

TradePulse runs against a Neon project named **TradePulse** on the `production` branch, database `neondb`, in AWS Asia Pacific 1 (Singapore). Neon is the only database required for development and production; no local PostgreSQL server is used.

Use two connection strings from the Neon dashboard:

- **Pooled** (`DATABASE_URL`) — hostname contains `-pooler`; used by the running application.
- **Direct** (`DIRECT_URL`) — hostname has no `-pooler`; used by Prisma CLI migrations, Prisma Studio, and the seed script.

Both endpoints require TLS. Neon supplies `sslmode=require` (and often `channel_binding=require`) in the connection string; keep those parameters.

## Quick start

### 1. Prerequisites

- Node.js 24 LTS and npm
- A Neon account with access to the TradePulse project (or another Neon project/database)
- The pooled and direct connection strings for the target branch

### 2. Install dependencies

```bash
npm install
```

### 3. Configure the environment

```bash
cp .env.example .env
```

Populate `.env` with the pooled and direct Neon URLs. The file is git-ignored; never commit it.

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
DIRECT_URL="postgresql://USER:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
```

`prisma.config.ts` routes Prisma CLI operations through `DIRECT_URL`; the application runtime reads the pooled `DATABASE_URL` through `@prisma/adapter-pg`.

`SHADOW_DATABASE_URL` is optional and only used by `prisma migrate dev`. Point it at a **separate Neon branch or database**, never at the pooled endpoint or the production branch.

### 4. Apply migrations and seed

The Neon database and role already exist; there is no local database to create.

```bash
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
```

`db:migrate:deploy` applies the committed migrations with `DIRECT_URL`. The seed script also prefers `DIRECT_URL` and falls back to `DATABASE_URL` only for single-endpoint setups.

### 5. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The health check is at [http://localhost:3000/api/health](http://localhost:3000/api/health).

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Pooled Neon connection (`-pooler` host) used by the running application. |
| `DIRECT_URL` | Yes | Direct, non-pooled Neon connection used by Prisma CLI migrations, Prisma Studio, and the seed script. |
| `SHADOW_DATABASE_URL` | No | Separate Neon branch/database used only by `prisma migrate dev` for drift detection. Never point it at the production branch. |

The connection strings must use the `postgresql://` or `postgres://` protocol. A missing `DATABASE_URL` does not stop the web server from booting; database-backed requests (including `/api/health`) fail with a clear message and the health endpoint reports `degraded`. Prisma CLI commands exit early when `DIRECT_URL` is missing. The seed script prefers `DIRECT_URL` and falls back to `DATABASE_URL` for single-endpoint setups.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js development server. |
| `npm run build` | Generate Prisma Client, then create a production build. |
| `npm run start` | Serve the production build. |
| `npm run lint` | Run ESLint. |
| `npm run typecheck` | Generate Next.js route types, then run TypeScript without emitting files. |
| `npm run db:generate` | Generate Prisma Client into `src/generated/prisma/`. |
| `npm run db:validate` | Validate the Prisma schema. |
| `npm run db:migrate` | Create and apply a development migration (`prisma migrate dev`). |
| `npm run db:migrate:deploy` | Apply committed migrations (`prisma migrate deploy`). |
| `npm run db:seed` | Run the idempotent demo seed (development only; see below). |
| `npm run db:studio` | Open Prisma Studio. |

Prisma Client is generated code and is deliberately git-ignored. `npm run build` generates it automatically before `next build`; after cloning or a schema change, run `npm run db:generate` before `npm run typecheck`.

## Deploy to Vercel

The canonical GitHub repository is `https://github.com/Sagar4173/TradePulse`. Vercel deploys from the `main` branch.

### 1. Import the repository

1. In Vercel, choose **Add New → Project** and import `Sagar4173/TradePulse`.
2. Use the **Next.js** framework preset with **Root Directory** `.`.
3. Set **Install Command** to `npm ci` and **Build Command** to `npm run build`.
4. Leave **Output Directory** at the Next.js default (`.next`) and select Node.js **24.x**. The `engines.node` field in `package.json` also pins the major version.

The build script runs `prisma generate` before `next build` because the generated Prisma Client is intentionally not committed.

### 2. Environment variables

Add both variables in the Vercel project for **Production**, **Preview**, and **Development**:

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Pooled Neon connection (`-pooler` host) used by the running application. |
| `DIRECT_URL` | Direct Neon connection used by the build's `prisma generate` step and by manual Prisma CLI operations. |

`prisma.config.ts` loads `DIRECT_URL` for every Prisma CLI command, including generation, so a missing value fails the build with a clear error. Do not add `SHADOW_DATABASE_URL` to Vercel; it is only for local `prisma migrate dev`. Never prefix either variable with `NEXT_PUBLIC_`.

For Preview deployments, prefer a separate Neon branch and use that branch's pooled and direct URLs instead of the production branch.

### 3. Apply migrations separately

The Vercel build deliberately does **not** run `prisma migrate deploy`. Apply schema changes from a trusted environment using the production `DIRECT_URL`:

```bash
npm run db:migrate:deploy
```

Run this before deploying code that depends on a new migration. Never run `prisma migrate dev`, `prisma migrate reset`, or `prisma db push` against the production branch.

### 4. Verify the deployment

- `/` returns HTTP `200` and renders the landing page.
- `/api/health` returns HTTP `200` with `"status": "ok"` and `checks.database.status: "up"`.

A `503` with `database: "down"` means the Vercel runtime cannot reach Neon; check `DATABASE_URL` and the Neon project status. A build failure during `prisma generate` usually means `DIRECT_URL` is missing from the Vercel environment.

## Data model

The schema lives in [`prisma/schema.prisma`](prisma/schema.prisma).

| Model | Purpose |
| --- | --- |
| `User` | People using the system. Roles: `RETAILER`, `SALESMAN`, `ORDER_DESK`, `ADMIN`. Retailer users link to a `Retailer`. |
| `Retailer` | Kirana shop account, including credit limit. |
| `Product` | Catalogue item keyed by SKU, with dealer price, GST rate, and active flag. |
| `RetailerProductPrice` | Retailer-specific selling price. At most one current price per retailer/SKU. |
| `Inventory` | Stock and reserved cases per product (one-to-one with `Product`). |
| `Scheme` | `BUY_X_GET_Y` or `PERCENTAGE_DISCOUNT` offers, optionally time-bounded. |
| `Order` | Order header with status, source, and Decimal totals. |
| `OrderItem` | Line item with **price snapshots** (`productName`, `unitLabel`, `unitPrice`, `gstRate`) so historical orders survive catalogue and price changes. |
| `AuditEvent` | Generic activity trail with actor, entity reference, and JSONB metadata. |

Conventions:

- All primary keys are `cuid()` strings, except `Product` (SKU) and `Inventory` (product SKU).
- Money uses `Decimal(12,2)` or `Decimal(14,2)`; percentages use `Decimal(5,2)`. JavaScript `number` is never used for persisted money.
- Timestamps use `TIMESTAMPTZ(3)` with `createdAt`/`updatedAt` where appropriate.
- Order status and source use enums; role and scheme type use enums.
- Foreign keys are explicit: cascading for dependent catalogue data, `RESTRICT` for order history, `SET NULL` for optional actor/retailer links.
- CHECK constraints in the second migration enforce non-negative money/stock, positive quantities, and GST/discount ranges that Prisma cannot express in its schema.

### Price history

`RetailerProductPrice` stores the current price only. Historical prices are captured on `OrderItem` at order time, so changing a product or retailer price never rewrites an existing order.

## Seed data

`prisma/seed.ts` is idempotent for demo data (uses `upsert`) and can be run repeatedly without creating duplicate rows. Rerunning it **resets seed-owned operational fields** — stock, reservations, retailer prices, and schemes — to the values below, so only run it against a development or disposable database. It refuses to run when `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true` is explicitly set.

It creates:

| SKU | Product | Unit | Dealer price | GST | Stock (cases) | Retailer price |
| --- | --- | --- | --- | --- | ---: | ---: |
| `SKU-BS-075` | Glucose Biscuit 75g | Case of 96 | ₹8.10 | 18% | 340 | ₹9.50 |
| `SKU-DT-1KG` | Detergent Powder 1kg | Case of 20 | ₹101.50 | 18% | 85 | ₹112.00 |
| `SKU-TE-250` | Tea Leaf 250g | Case of 40 | ₹118.00 | 5% | 0 | ₹130.00 |

It also creates the `Demo Kirana Store` retailer and two active schemes:

- Buy 10 cases of `SKU-BS-075`, get 1 free
- 3% discount on 5 or more cases of `SKU-DT-1KG`

GST rates and prices are illustrative seed values, not tax advice.

## Health endpoint

`GET /api/health` is request-time only (never cached or prerendered) and probes the Neon PostgreSQL database with `SELECT 1`.

Healthy response — HTTP `200`:

```json
{
  "status": "ok",
  "service": "tradepulse",
  "timestamp": "2026-11-03T21:07:34.541Z",
  "checks": {
    "application": { "status": "up" },
    "database": { "status": "up" }
  }
}
```

Database failure — HTTP `503` with `status: "degraded"` and `checks.database.status: "down"`. The response deliberately omits driver errors and connection details. Database connections and queries are bounded by a 5-second timeout so a blackholed database cannot hang the probe indefinitely.

## Project structure

```text
.
├── prisma/
│   ├── migrations/
│   │   ├── 20261103210315_init/
│   │   └── 20261104010000_data_integrity_checks/
│   ├── schema.prisma
│   └── seed.ts
├── src/
│   ├── app/
│   │   ├── api/health/route.ts
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── brand-mark.tsx
│   │   └── ui/                  # shadcn/ui primitives
│   ├── generated/prisma/        # generated, git-ignored
│   └── lib/
│       ├── db/index.ts          # lazy Prisma singleton + pg adapter
│       └── utils.ts
├── prisma.config.ts
├── .env.example
└── package.json
```

## Migration workflow

`prisma.config.ts` sends all Prisma CLI commands through `DIRECT_URL`. For schema changes during development:

```bash
# edit prisma/schema.prisma
npm run db:migrate -- --name describe_the_change
npm run db:generate
```

`prisma migrate dev` needs a shadow database to detect drift. Set `SHADOW_DATABASE_URL` to a **separate Neon branch or database** before using `migrate dev`. Never point the shadow URL at the production branch, and never use `migrate dev` against production.

For CI, production, and any shared Neon branch, apply committed migrations only:

```bash
npm run db:migrate:deploy
```

`prisma migrate deploy` does not need a shadow database. Never use `prisma migrate reset` or `db push` against a database containing real data.

## Neon operations and backups

Neon manages the database cluster, storage, and backups. No local PostgreSQL process is required for TradePulse.

- **Branching:** use Neon branches for development, preview environments, and migration rehearsals. Keep the `production` branch isolated.
- **Point-in-time recovery:** Neon retains a restore window based on the project plan. Restore by creating a new branch from a point in time, verify the data, then promote or reconnect deliberately.
- **Logical backups:** for an independent copy, run `pg_dump` with the direct URL and store the file outside the repository:

  ```bash
  pg_dump "$DIRECT_URL" --format=custom --no-owner --file=tradepulse_YYYYMMDD.dump
  pg_restore --list tradepulse_YYYYMMDD.dump
  ```

- **Restores:** restore into a new Neon branch or database first, verify the schema and row counts, then switch `DATABASE_URL`/`DIRECT_URL` only after validation.
- **Secrets:** keep `DIRECT_URL` and `DATABASE_URL` in the deployment platform's secret store and in the local `.env` file only. Rotate the Neon role password if a URL is exposed.

The current connection uses Neon's `neondb_owner` role on the `neondb` database. Before exposing the application publicly, create a separate least-privilege runtime role for `DATABASE_URL` and reserve the owner role for migrations and administration.

## Verification

```bash
npm run lint
npm run typecheck
npm run build
npm run db:validate
npm run db:migrate:deploy
npm run db:seed
```

With the production server running (`npm run start`):

```bash
curl http://localhost:3000/api/health
```

The health endpoint must return HTTP `200` with `checks.database.status: "up"`. Because the application connects to Neon, this check also passes while any local PostgreSQL installation is stopped. A database failure returns HTTP `503` after the 5-second query timeout.

The Neon migration was verified by validating the schema, applying both committed migrations, running the seed twice without duplicate rows, confirming the expected record counts, and passing lint, typecheck, production build, landing-page, and health checks.

## Security notes

- `.env` is git-ignored; `.env.example` contains placeholders only.
- No credentials are hard-coded in source or migrations.
- The current `neondb_owner` role is not a PostgreSQL superuser, but it owns the database and has `CREATEDB`/`CREATEROLE` privileges. Create a least-privilege runtime role for `DATABASE_URL` before exposing the application publicly.
- The health endpoint does not expose driver errors or connection strings, and its error logging is deliberately limited to an error code.
- All database access goes through Prisma's parameterized query layer.
- Neon connections require TLS. Keep the `sslmode` (and optional `channel_binding`) parameters from the Neon dashboard; prefer `sslmode=verify-full` where the deployment environment trusts the relevant CA.
- Use a least-privilege runtime role for `DATABASE_URL` and reserve the database owner role for migrations and administration where possible.

## Next milestone

Milestone 2 is expected to introduce authentication and authorization, the retailer catalogue with retailer-specific pricing and live stock, and the scheme calculation/order-capture foundations. AI text/image/voice capture and order-desk workflows remain later milestones.
