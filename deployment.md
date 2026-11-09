# TradePulse Deployment Record

**Release:** Integrated Milestones 2–5  
**Release date:** 9–10 November 2026 (IST)  
**Status:** Deployed and healthy; public sign-in blocked by the intentionally fail-closed OTP provider.

## Live endpoints

| Item | Value |
| --- | --- |
| Application | https://tradepulse-ai-platform.vercel.app/ |
| Health check | https://tradepulse-ai-platform.vercel.app/api/health |
| GitHub repository | https://github.com/Sagar4173/TradePulse |
| Production branch | `main` |
| Vercel project | Existing `tradepulse` project |

The previous `tradepulse.vercel.app` domain was not claimed or used.

## Release metadata

| Item | Value |
| --- | --- |
| M5 feature commit | `fd0280bd7f5006f4aa94b59dec5d5ea80ec0c8ce` — `feat: complete AI order capture and Tally export` |
| Integrated main commit at release gate | `d5ed1ca28945bd5c6916721dc3bf869027f53df1` — landing-page and mobile-login corrections |
| Integration method | Fast-forward from `feature/milestone-5-ai-order-capture`; full M2→M5 history preserved |
| Deployment source | `main` via the existing Vercel GitHub integration |
| Database | Neon project **TradePulse**, `production` branch, database `neondb`, schema `public` |

Documentation was committed after the integration checkpoint; the latest `main` commit is the authoritative release SHA.

## Stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 24 LTS |
| Framework | Next.js 16.4.5 (App Router, Cache Components, Turbopack) |
| UI | React 19.3.1, Tailwind CSS 4.3.4, shadcn/ui (Base UI) |
| Language | TypeScript 5.9.3, strict mode |
| Database | Neon Serverless PostgreSQL 18, AWS Asia Pacific 1 (Singapore) |
| Data access | Prisma 7.10.1 with `@prisma/adapter-pg` |
| Tests | Node.js test runner with `tsx` |
| Package manager | npm |

## Environment variable names

Only names are recorded here; no values or credentials are included.

| Name | Scope | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Vercel runtime / local | Pooled PostgreSQL connection used by the application. |
| `DIRECT_URL` | Local migration environment / Vercel build | Direct connection used by Prisma CLI and required by `prisma generate`. |
| `SHADOW_DATABASE_URL` | Optional local only | Separate non-production database for `prisma migrate dev`. Never production. |
| `AUTH_OTP_TTL_SECONDS` | Optional | OTP lifetime tuning. |
| `AUTH_OTP_MAX_ATTEMPTS` | Optional | Verification attempt limit. |
| `AUTH_OTP_RESEND_COOLDOWN_SECONDS` | Optional | Resend cooldown. |
| `AUTH_OTP_RESERVATION_LEASE_SECONDS` | Optional | OTP admission lease. |
| `AUTH_OTP_RATE_WINDOW_MINUTES` | Optional | OTP rate window. |
| `AUTH_OTP_MAX_REQUESTS_PER_WINDOW` | Optional | Per-phone request cap. |
| `AUTH_OTP_MAX_REQUESTS_PER_IP_WINDOW` | Optional | Per-IP request cap. |
| `AUTH_SESSION_TTL_DAYS` | Optional | Session lifetime. |
| `AUTH_DEV_OTP_ENABLED` | Development only | Shows local development OTP codes only after the non-production target guard passes. Ignored in production. |
| `AUTH_DEV_PROVISIONING_ENABLED` | Development only | Enables guarded local role provisioning. |
| `TRADEPULSE_DEV_TARGET_HOSTS` | Development only | Allowlisted local database host. |
| `TRADEPULSE_DEV_TARGET_FINGERPRINT` | Development only | Fingerprint of the local database target. |
| `TRADEPULSE_PRODUCTION_TARGET_HOSTS` | Optional | Extra production-host denylist. |
| `TRADEPULSE_TEST_DATABASE_ADMIN_URL` | Integration tests only | Disposable PostgreSQL admin URL; Neon is rejected. |
| `AUTH_BOOTSTRAP_ADMIN_ENABLED` | CLI only | Enables the one-time first-administrator bootstrap. |
| `AUTH_SMS_PROVIDER` | Not implemented | Reserved future provider selector. |
| `AUTH_SMS_API_URL` | Not implemented | Reserved future provider endpoint. |
| `AUTH_SMS_API_KEY` | Not implemented | Reserved future provider credential. |
| `AUTH_SMS_SENDER_ID` | Not implemented | Reserved future sender ID. |

The four `AUTH_SMS_*` names are placeholders only. No SMS adapter exists in this release.

## Production database migration

### Pre-migration verification

- Runtime `DATABASE_URL` and migration `DIRECT_URL` resolved to the same effective host, port, database, and schema (`neondb` / `public`).
- The target was confirmed as the TradePulse Neon production branch.
- Migration history before release: 2 applied migrations.
- Pending migrations reviewed: 7.
- Production data before migration: 1 retailer, 3 products, 3 retailer prices, 3 inventory rows, 2 schemes, 0 users, 0 orders.
- Phone-normalization risk: 0 user rows, so no invalid or duplicate phone data could block the migration.
- A logical JSON backup of all 10 existing public tables was created and read back successfully before migration (3,537 bytes; SHA-256 `aeb86ce2b4b04aad633f985a2915930b1c3452671a0b682a3f15ce247a529eb1`). Neon point-in-time recovery remained available as the platform-level restore point.
- No destructive operation (`DROP TABLE`, `DROP COLUMN`, `DELETE`, `TRUNCATE`, `db push`, or `migrate reset`) exists in the pending migration SQL.

### Applied migrations

`npm run db:migrate:deploy` applied all 7 pending migrations using `DIRECT_URL`:

1. `20261105090000_auth_sessions_rbac`
2. `20261106090000_user_phone_normalized`
3. `20261106120000_otp_reservations_retailer_link_reviews`
4. `20261107120000_retailer_link_history_fks`
5. `20261107130000_product_catalogue_metadata`
6. `20261107140000_order_lifecycle`
7. `20261109120000_product_alias`

Result: **9/9 migrations applied**.

### Post-migration verification

- `npx prisma migrate status`: **Database schema is up to date**.
- `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`: **No difference detected**.
- `npm run db:validate`: schema valid.
- Existing data preserved: 1 retailer, 3 products, 3 retailer prices, 3 inventory rows, 2 schemes, 2 original migrations.
- New tables present: `Session`, `OtpChallenge`, `OtpRequestReservation`, `RetailerLinkRequest`, `SalesmanRetailerAssignment`, `ProductAlias`.
- New columns present: `User.phoneNormalized`, `User.status`, `Product.brand`, `Product.category`, `Product.imageUrl`, `Order.orderNumber`, `Order.idempotencyKey`.
- Production operations used the direct connection for migrations and the pooled runtime connection for the application.

No production seed was run. Production contains the existing demo catalogue only and no users or orders.

## Deployment verification

| Check | Result |
| --- | --- |
| GitHub `main` pushed | Yes; remote verified at the integration commit |
| Vercel deployment | Successful via the existing GitHub integration |
| `/` | HTTP `200`; landing page renders |
| `/login` | HTTP `200`; sign-in form renders |
| `/dashboard` | HTTP `307` → `/login?next=%2Fdashboard` when unauthenticated |
| `/catalogue` | HTTP `307` → `/login?next=%2Fcatalogue` |
| `/cart` | HTTP `307` → `/login?next=%2Fcart` |
| `/orders` | HTTP `307` → `/login?next=%2Forders` |
| `/orders/export` | HTTP `307` → `/login?next=%2Forders%2Fexport` |
| `/ai-capture` | HTTP `307` → `/login?next=%2Fai-capture` |
| `/api/health` | HTTP `200`; `status: ok`; application `up`; database `up` |
| Browser console | No errors or warnings on the live landing and login pages |
| Desktop layout | Verified at 1440×1000 |
| Mobile layout | Verified at 390×844 after the login overflow fix |

A successful build was not treated as sufficient proof. The live routes and health response above were fetched from the deployed Vercel application.

## Implemented functionality

- Phone OTP authentication with hashed codes, expiry, bounded attempts, cooldown, and database-backed per-phone/per-IP rate limiting.
- Database-backed sessions, HTTP-only cookies, server-side RBAC, retailer link review, user access management, and audit events.
- Retailer catalogue with retailer-specific prices, stock, search/filter/sort/pagination, and active schemes.
- Server-authoritative cart and idempotent order submission with immutable price snapshots and checkout revalidation.
- Order lifecycle, credit exposure and credit holds, stock reservation/release/deduction, order-desk actions, and audit history.
- Deterministic Hindi/Hinglish/English AI order capture with explicit line confirmation and retailer-scoped aliases.
- Order Desk/Admin Tally-compatible CSV export with date filters, bounded output, injection protection, and export auditing.

## Authentication and demo access

**Public production sign-in is not available.** The production OTP provider is intentionally fail-closed because no SMS adapter or provider credentials exist. Production returns no OTP code, logs no OTP code, and has no universal password or bypass.

The production database has **0 users**. No demo account was seeded because creating accounts would not solve delivery without an SMS provider.

Safest legitimate reviewer options, in order:

1. Configure a real SMS provider adapter and credentials, then create a reviewer account through the normal flow.
2. Run the application against a separate disposable non-production database with the guarded `AUTH_DEV_OTP_ENABLED` development flow and provisioned demo roles.
3. Review the public landing page, `/login`, health endpoint, source, tests, and documentation without an authenticated session.

Do not enable development OTP on production, expose development codes, add a universal password, or weaken authorization to create reviewer access.

## Verification results

| Check | Result |
| --- | --- |
| Unit tests | **387 passed / 387**, 90 suites, 0 failed |
| ESLint | Passed |
| Typecheck | Passed |
| Prisma validate | Passed |
| Production build | Passed |
| Migration status | 9/9 applied |
| Schema drift | None detected |
| Production health | HTTP `200`, database `up` |
| PostgreSQL integration tests | **BLOCKED** — no disposable PostgreSQL server was available |

The integration suite deliberately refuses Neon and all production-looking targets. It was not run against `DATABASE_URL`, `DIRECT_URL`, or the Neon production branch. No integration-test pass is claimed.

## Known limitations

1. **BLOCKER for public demo:** production OTP delivery is unavailable without a real SMS provider. No safe bypass was added.
2. **No production demo users or orders:** the database contains the catalogue seed only.
3. **AI capture is deterministic and text-only:** no external LLM, images, or voice input.
4. **Tally export is Tally-compatible CSV, not native Tally XML**, and has not been validated against a specific Tally import template.
5. **PostgreSQL integration tests are blocked** by the absence of an approved disposable database.
6. **No payment, GSTIN capture, van loading, or offline sync.**
7. The database role used by the Vercel runtime was not independently inspected; a least-privilege runtime role is recommended before broader exposure.

## Reproduction commands

```bash
# Install and generate
npm install
npm run db:generate

# Safe verification
npm test
npm run lint
npm run typecheck
npm run db:validate
npm run build

# Production migration (trusted environment, DIRECT_URL)
npx prisma migrate status
npm run db:migrate:deploy
npx prisma migrate status
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code

# Live verification
curl -i https://tradepulse-ai-platform.vercel.app/
curl -i https://tradepulse-ai-platform.vercel.app/login
curl -i https://tradepulse-ai-platform.vercel.app/api/health
```

Never use `prisma db push`, `prisma migrate reset`, or destructive SQL against the production database.
