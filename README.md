# TradePulse

TradePulse is an ordering and distribution platform for FMCG distributors and the kirana retailers they serve. This repository contains the integrated **Milestones 2–5** release: phone authentication and RBAC, the retailer catalogue and server-priced cart, order and credit workflows, deterministic AI order capture, and Tally-compatible CSV export.

- **Live application:** https://tradepulse-ai-platform.vercel.app/
- **GitHub repository:** https://github.com/Sagar4173/TradePulse
- **Health check:** https://tradepulse-ai-platform.vercel.app/api/health

The application is deployed on Vercel from the `main` branch and uses a Neon PostgreSQL production branch. No SMS vendor is currently configured, so production sign-in fails closed. See [Authentication status](#authentication-status) and [Limitations](#limitations).

## Stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 24 LTS (`24.x`) |
| Framework | Next.js 16.4.5 (App Router, Cache Components, Turbopack) |
| UI | React 19.3.1, Tailwind CSS 4.3.4, shadcn/ui (Base UI) |
| Language | TypeScript 5.9.3, strict mode |
| Database | Neon Serverless PostgreSQL 18 (AWS Asia Pacific 1 / Singapore) |
| Data access | Prisma 7.10.1 with `@prisma/adapter-pg` |
| Testing | Node.js test runner with `tsx` |
| Package manager | npm |

## Implemented functionality

### Authentication and authorization

- Indian mobile-number normalization to canonical `+91[6-9]XXXXXXXXX`.
- Phone OTP sign-in with salted `scrypt` hashes, expiry, bounded attempts, resend cooldown, and database-authoritative per-phone and per-IP rate limiting.
- Database-backed sessions with opaque tokens; only SHA-256 token hashes are stored. Cookies are `HTTP-only`, `SameSite=Lax`, and `Secure` in production.
- Server-side RBAC for `RETAILER`, `SALESMAN`, `ORDER_DESK`, and `ADMIN`. Protected pages and server actions re-authorize independently of navigation.
- Administrator user-access management, retailer link-request review, session revocation on role/status changes, and audit events.
- First-time verified phones can create retailer accounts only. Elevated roles require an administrator, the guarded development provisioning script, or the one-time CLI bootstrap.
- Development OTP and provisioning require an explicit non-production database target fingerprint and are impossible in production.

### Retailer catalogue and cart

- Retailer-specific selling prices, stock visibility, product metadata, categories, search, filters, sorting, and pagination.
- Active `BUY_X_GET_Y` and percentage-discount schemes.
- Server-authoritative cart: prices, scheme benefits, GST, and stock are recalculated from the database; client-supplied money is never trusted.
- Checkout review fingerprint detects price, stock, scheme, or quantity changes before submission.
- Order submission is idempotent and creates immutable price and product snapshots.

### Order management, credit, and stock

- Human-readable order numbers in the `TP-YYYYMMDD-NNNNNN` format using the `Asia/Kolkata` calendar date.
- Lifecycle statuses: `DRAFT`, `PENDING_REVIEW`, `ON_CREDIT_HOLD`, `APPROVED`, `PROCESSING`, `READY_FOR_DISPATCH`, `DISPATCHED`, `DELIVERED`, `FULFILLED`, `REJECTED`, and `CANCELLED`.
- Order Desk and administrator transitions with explicit permission checks, audit events, and lifecycle guards.
- Credit exposure is calculated from open orders in integer paise. Approval fails into `ON_CREDIT_HOLD` when projected exposure exceeds the retailer's credit limit; re-approval rechecks both credit and stock.
- Stock is reserved during approval and released or deducted as the order moves through its lifecycle.
- Retailer, salesman, Order Desk, and administrator queries are scoped by role and assignment.

### AI order capture

- Free-form Hindi, Hinglish, or English order text is parsed deterministically into product lines, quantities, and units.
- Matching uses the retailer's catalogue, synonyms, transliteration/normalization, fuzzy scoring, and retailer-scoped confirmed aliases.
- Every parsed line must be reviewed, corrected, and explicitly confirmed before it can be added to the cart.
- Confirmed corrections can teach a retailer-scoped `ProductAlias`; aliases are never shared across retailers.
- No external AI service is used. The provider seam validates future provider output strictly against a server-generated SKU allowlist, and the server still recalculates the cart.

### Tally-compatible CSV export

- `/orders/export` is restricted to Order Desk and administrators.
- Exports eligible `APPROVED`, `PROCESSING`, `READY_FOR_DISPATCH`, `DISPATCHED`, `DELIVERED`, and `FULFILLED` orders.
- The output is a line-level, **Tally-compatible CSV**, not native Tally XML.
- Includes order number/date, customer name, SKU, product, unit, paid and free quantities, GST-exclusive unit price, discount, scheme fields, GST rate/amount, GST-inclusive line total, and order total.
- Inclusive `Asia/Kolkata` date filters; bounded to 500 orders and 5,000 lines per export.
- UTF-8 BOM, quoted/escaped cells, formula-injection neutralization, deterministic filename, and `Cache-Control: no-store`.
- Successful downloads append an `ORDER_TALLY_EXPORTED` / `OrderExport` audit event with aggregate counts.
- Customer name comes from the retailer's current `shopName`. No GSTIN is exported because the schema does not store one.

## Architecture

- `src/app/(auth)` contains the sign-in experience.
- `src/app/(app)` contains the authenticated application shell and role-scoped pages.
- `src/proxy.ts` performs an optimistic cookie check and redirects cookie-less requests to `/login`; the server data-access layer remains authoritative.
- `src/lib/auth` contains phone normalization, OTP services and providers, sessions, permissions, navigation, and server actions.
- `src/lib/catalogue`, `src/lib/cart`, `src/lib/orders`, `src/lib/schemes`, and `src/lib/inventory` contain the commercial domain logic.
- `src/lib/ai-capture` contains normalization, segmentation, deterministic parsing, alias handling, confirmation, and provider validation.
- `src/lib/orders/tally-export.ts` is the pure CSV builder; `tally-export-repository.ts` enforces status, date, and size limits in the database query.
- Prisma CLI operations use `DIRECT_URL`; the running application uses the pooled `DATABASE_URL` through the pg driver adapter.

## Data model

The schema lives in [`prisma/schema.prisma`](prisma/schema.prisma).

| Model | Purpose |
| --- | --- |
| `User` | People using the system with role/status, verified-phone timestamps, display phone, and unique canonical `phoneNormalized`. |
| `Retailer` | Kirana shop account, including credit limit and shop name. |
| `Product` | Catalogue item keyed by SKU with dealer price, GST rate, unit, active flag, brand, category, and image URL. |
| `RetailerProductPrice` | Current retailer-specific selling price per SKU. |
| `Inventory` | Stock, reserved cases, and low-stock threshold per product. |
| `Scheme` | `BUY_X_GET_Y` or percentage-discount offers, optionally time-bounded. |
| `Order` | Order header with human-readable number, lifecycle status, source, credit snapshots, stock state, and money totals. |
| `OrderItem` | Line item with immutable product/price/GST/scheme snapshots. |
| `ProductAlias` | Retailer-scoped confirmed shorthand for a catalogue SKU. |
| `OtpRequestReservation` | Admission lease created before OTP hashing; counts toward rate windows immediately. |
| `OtpChallenge` | Short-lived phone challenge with hashed code, attempt counter, expiry, and optional reservation link. |
| `RetailerLinkRequest` | Pending or reviewed request to link a verified retailer account to an existing retailer. |
| `Session` | Opaque session with a unique SHA-256 token hash, expiry, last-seen time, and revocation time. |
| `SalesmanRetailerAssignment` | Explicit salesman-to-retailer scope. |
| `AuditEvent` | Activity trail with actor, entity reference, and JSONB metadata. |

Conventions:

- Primary keys are `cuid()` strings, except `Product` (SKU) and `Inventory` (product SKU).
- Money uses `Decimal(12,2)` or `Decimal(14,2)`; percentages use `Decimal(5,2)`. Persisted money is handled as integer paise in application logic, never floating point.
- Timestamps use `TIMESTAMPTZ(3)`.
- CHECK constraints enforce non-negative money/stock, positive quantities, GST/discount ranges, lifecycle invariants, and normalized-phone format.
- Raw OTPs and raw session tokens are never stored.

## Local setup

### Prerequisites

- Node.js 24 LTS and npm
- A Neon account with access to the TradePulse project, or another PostgreSQL database
- Pooled and direct connection strings for a **non-production** branch

### Install and configure

```bash
npm install
cp .env.example .env
```

Set the required environment variable names in `.env`:

```dotenv
DATABASE_URL="<pooled PostgreSQL connection string>"
DIRECT_URL="<direct PostgreSQL connection string>"
```

`DATABASE_URL` is the runtime connection. `DIRECT_URL` is used by Prisma CLI migrations, Prisma Studio, and the seed script. Never commit `.env`.

Optional authentication tuning variables and development-only flags are documented in `.env.example`. Do not set development OTP or provisioning flags on a public deployment.

### Migrate, seed, and run

```bash
npm run db:generate
npm run db:migrate:deploy
npm run db:seed        # development/disposable databases only
npm run dev
```

Open http://localhost:3000. With `AUTH_DEV_OTP_ENABLED=true` and a database target that passes the development-target guard, the local OTP appears in the login card. Development provisioning can create elevated test roles:

```bash
AUTH_DEV_PROVISIONING_ENABLED=true npm run db:provision-dev -- \
  --phone 9876543210 --role ADMIN --name "Dev Admin"
```

The provisioning script requires an allowlisted host and matching target fingerprint, refuses production, and never creates an OTP or session.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Pooled PostgreSQL connection used by the running application. |
| `DIRECT_URL` | Yes | Direct connection used by Prisma CLI migrations, Studio, and seed. |
| `SHADOW_DATABASE_URL` | No | Separate non-production database for `prisma migrate dev` drift detection. |
| `AUTH_OTP_TTL_SECONDS` | No | OTP lifetime; default `300`, bounded to `900`. |
| `AUTH_OTP_MAX_ATTEMPTS` | No | Maximum verification attempts; default `5`, bounded to `10`. |
| `AUTH_OTP_RESEND_COOLDOWN_SECONDS` | No | Resend cooldown; default `60`, bounded to `600`. |
| `AUTH_OTP_RESERVATION_LEASE_SECONDS` | No | Admission lease; default `60`, clamped to `10–300`. |
| `AUTH_OTP_RATE_WINDOW_MINUTES` | No | Rate-limit window; default `15`, bounded to `60`. |
| `AUTH_OTP_MAX_REQUESTS_PER_WINDOW` | No | Per-phone request cap; default `5`, bounded to `20`. |
| `AUTH_OTP_MAX_REQUESTS_PER_IP_WINDOW` | No | Per-IP request cap; default `20`, bounded to `200`. |
| `AUTH_SESSION_TTL_DAYS` | No | Session lifetime; default `7`, bounded to `30`. |
| `AUTH_DEV_OTP_ENABLED` | Development only | Returns the OTP to the local UI when the development-target guard passes. Ignored in production. |
| `AUTH_DEV_PROVISIONING_ENABLED` | Development only | Enables the guarded development provisioning script. |
| `TRADEPULSE_DEV_TARGET_HOSTS` | Development only | Comma-separated allowlist of logical database hosts. |
| `TRADEPULSE_DEV_TARGET_FINGERPRINT` | Development only | SHA-256 fingerprint printed by `npm run db:dev-target`. |
| `TRADEPULSE_PRODUCTION_TARGET_HOSTS` | No | Optional denylist of known production hosts. |
| `TRADEPULSE_TEST_DATABASE_ADMIN_URL` | Integration tests only | Explicit disposable PostgreSQL admin URL; Neon and production targets are rejected. |
| `AUTH_BOOTSTRAP_ADMIN_ENABLED` | CLI only | Required by the one-time first-administrator bootstrap. |
| `AUTH_SMS_PROVIDER` | Not implemented | Reserved provider selector name. |
| `AUTH_SMS_API_URL` | Not implemented | Reserved provider endpoint name. |
| `AUTH_SMS_API_KEY` | Not implemented | Reserved provider credential name. |
| `AUTH_SMS_SENDER_ID` | Not implemented | Reserved sender ID name. |

No SMS adapter is implemented. The four `AUTH_SMS_*` names are placeholders for a future provider and have no effect today.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js development server. |
| `npm run build` | Generate Prisma Client, then create a production build. |
| `npm run start` | Serve the production build. |
| `npm run lint` | Run ESLint. |
| `npm run typecheck` | Generate route types, then run TypeScript without emitting. |
| `npm test` | Run unit tests. |
| `npm run test:integration` | Run the disposable-PostgreSQL integration suite. Requires `TRADEPULSE_TEST_DATABASE_ADMIN_URL`. |
| `npm run db:generate` | Generate Prisma Client. |
| `npm run db:validate` | Validate the Prisma schema. |
| `npm run db:dev-target` | Print the non-secret current database target and fingerprint. |
| `npm run db:migrate` | Create and apply a development migration. |
| `npm run db:migrate:deploy` | Apply committed migrations with `DIRECT_URL`. |
| `npm run db:bootstrap-admin` | One-time first-administrator bootstrap. |
| `npm run db:provision-dev` | Development-only user provisioning. |
| `npm run db:seed` | Run the idempotent demo seed. |
| `npm run db:studio` | Open Prisma Studio. |

## Deployment

The canonical GitHub repository is https://github.com/Sagar4173/TradePulse. Vercel deploys the `main` branch to the existing `tradepulse` project.

### Vercel environment variables

Set these names in the Vercel project. Values are never committed or printed in this document.

| Name | Scope | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Production | Pooled Neon connection for the application runtime. |
| `DIRECT_URL` | Build | Direct Neon connection used by Prisma CLI and required by `prisma generate`; the build does not run migrations. |

Optional authentication tuning names may be set if non-default values are required. Do **not** set development OTP/provisioning flags or `SHADOW_DATABASE_URL` in Vercel. Do not store the Neon owner credential in Vercel.

### Migration sequence

Apply migrations from a trusted environment before deploying code that depends on them:

```bash
npx prisma migrate status
npm run db:migrate:deploy
npx prisma migrate status
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

Never use `prisma db push`, `prisma migrate reset`, or `migrate resolve --applied` against a database containing real data. The release migration set is additive or replaces indexes/foreign keys after review; the normalized-phone migration aborts safely if existing phone data is invalid or duplicated.

Production migration and verification results for this release are recorded in [`deployment.md`](deployment.md).

### Verify a deployment

```bash
curl -i https://tradepulse-ai-platform.vercel.app/
curl -i https://tradepulse-ai-platform.vercel.app/api/health
```

A healthy deployment returns HTTP `200` from `/` and `/api/health`, with `checks.database.status` equal to `up`. Cookie-less requests to protected routes redirect to `/login?next=…`; they must not render application data.

## Authentication status

The production OTP provider is intentionally fail-closed because no SMS vendor adapter or credentials are configured. Production never returns, logs, or exposes a development OTP, and no authentication bypass or universal password exists. The production database currently has no user accounts.

Until a real SMS provider is integrated and configured, the application is demonstrable through:

- the public landing page, `/login`, and `/api/health`;
- locally, against a disposable non-production database, using the guarded development OTP flow.

A reviewer login on the public production deployment is **not available** without a real SMS provider. Do not treat the development OTP flow as production access.

## Verification

Release gate executed on the integrated `main` branch:

| Check | Result |
| --- | --- |
| `npm test` | **387 tests / 90 suites passed, 0 failed** |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run db:validate` | Passed |
| `npm run build` | Passed |
| `prisma migrate status` | 9/9 migrations applied |
| `prisma migrate diff` | No schema difference |
| Production `/api/health` | HTTP `200`, database `up` |

The PostgreSQL integration suite was **not run** because no disposable PostgreSQL database was available. The harness refuses Neon and production targets by design; the suite is therefore reported as blocked, not passed:

```bash
# PowerShell example; use a disposable local/isolated PostgreSQL server only.
$env:TRADEPULSE_TEST_DATABASE_ADMIN_URL = "postgresql://test_admin:password@127.0.0.1:5432/postgres?sslmode=disable"
npm run test:integration
```

## Security notes

- `.env` is git-ignored; `.env.example` contains placeholders only.
- No credentials are hard-coded in source, migrations, tests, or documentation.
- OTPs are stored as salted scrypt hashes and consumed once. Raw codes are never persisted or returned in production.
- Session tokens are stored only as SHA-256 hashes and sent in HTTP-only cookies.
- Public registration is restricted to the `RETAILER` role. Elevated roles require administrator action or a guarded CLI path.
- A verified phone never grants retailer scope automatically; an administrator must approve a retailer link request.
- Retailer and salesman queries are scoped in the database, not only in navigation.
- Role/status changes and bootstrap promotion revoke affected sessions in the same transaction.
- All database access uses Prisma's parameterized query layer.
- The health endpoint does not expose driver errors or connection strings.
- CSV export neutralizes formula-injection prefixes and never mutates orders.
- Production OTP fails closed until a real SMS adapter is implemented, configured, and tested.
- Use a least-privilege runtime role for `DATABASE_URL` where possible and reserve the database owner role for migrations.

## Limitations

1. **Production sign-in is unavailable** until a real SMS provider adapter and credentials are configured. No bypass exists.
2. **No production user or order data** is seeded. The production database contains the demo catalogue only (one retailer, three products, schemes, prices, and inventory).
3. **AI capture is deterministic and text-only.** It does not use an external AI model and does not process images or voice notes. Hindi is handled through transliteration/normalization and catalogue matching, not a language model.
4. **Tally export is CSV, not native Tally XML.** The format is Tally-compatible but has not been validated against a specific Tally version or import template.
5. **PostgreSQL integration tests are blocked** by the absence of an approved disposable database. They must not be run against Neon or production.
6. **No payment, van loading, offline sync, or GSTIN capture** is implemented.
7. The database role used by the Vercel runtime was not independently inspected. Use a least-privilege runtime role for `DATABASE_URL` and reserve the owner role for migrations.

## Project structure

```text
.
├── prisma/
│   ├── migrations/              # 9 committed migrations
│   ├── schema.prisma
│   └── seed.ts
├── scripts/                     # bootstrap, dev provisioning, target fingerprint
├── src/
│   ├── app/
│   │   ├── (app)/               # authenticated shell and role-scoped pages
│   │   ├── (auth)/login/        # phone OTP sign-in
│   │   ├── api/health/          # application and database health
│   │   └── page.tsx             # public landing page
│   ├── components/              # app shell, auth, catalogue, cart, AI capture, UI
│   ├── generated/prisma/        # generated client, git-ignored
│   └── lib/                     # auth, catalogue, cart, orders, schemes, AI, CSV
├── tests/integration/           # disposable-PostgreSQL suite
├── prisma.config.ts
├── .env.example
└── package.json
```

## Documentation

- [`deployment.md`](deployment.md) — actual release URLs, migration status, environment names, verification evidence, and limitations.
- [`TradePulse_Technical_Design_Document.pdf`](TradePulse_Technical_Design_Document.pdf) — architecture, data model, workflows, testing, and trade-offs.
