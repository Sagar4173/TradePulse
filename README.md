# TradePulse

TradePulse is an ordering and distribution platform for FMCG distributors and the kirana retailers they serve. This repository contains **Milestone 2: authentication, roles and a protected application shell**, built on top of the Milestone 1 foundation — a production-shaped Next.js application, a PostgreSQL data model, repeatable seed data, a landing page, and a database-aware health check.

Milestone 2 adds phone OTP sign-in, database-backed sessions, centralized server-side role authorization, administrator user-access management, and role-specific dashboards and navigation. The Milestone 2.3 hardening pass adds canonical normalized phone storage and atomic, database-backed OTP rate limiting. The Milestone 2.5 remediation pass moves rate-limit admission ahead of OTP hashing, replaces automatic retailer linking with administrator review, scopes stale-reservation cleanup to the admission keys in use, preserves retailer link-request history with restrictive foreign keys and a partial unique pending index, records previous and new retailer IDs in access audits, adds a fail-closed development-target guard, and documents migration recovery and deployment ordering. AI order capture, ordering and checkout, the scheme calculation engine, credit workflows, Tally integration, van loading and offline sync are intentionally **not** implemented yet.

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

## Authentication and authorization

### Phone OTP flow

1. The user enters an Indian mobile number on `/login`. The server normalizes it to `+91XXXXXXXXXX`; only valid Indian mobile numbers are accepted.
2. Every user has a canonical `phoneNormalized` value stored in a unique database column. Registration, OTP verification, administrator bootstrap, and development provisioning all write the same normalized value. Lookups use that exact indexed column instead of scanning formatted phone strings.
3. OTP admission happens before hashing. The service opens a short database transaction, acquires PostgreSQL advisory locks for the phone and hashed IP, checks the resend cooldown and both rate windows, and creates a short-lived `OtpRequestReservation`. The `scrypt` hash runs only after that lock is released.
4. The six-digit code is generated with a cryptographically secure random source and persisted only as a salted `scrypt` hash; the raw code is never stored. The reservation counts toward the per-phone and per-IP window immediately. If hashing or the request process fails, the lease expires to `ABANDONED` and still counts for the window; a provider failure marks it `FAILED` and consumes the unsent challenge. Neither case grants a free request slot or holds the resend cooldown.
5. Verification enforces an expiry timestamp and a per-challenge maximum attempt count. A successful code is consumed exactly once, outstanding codes for the same phone are invalidated, and a session is issued.
6. First-time successful verification creates a **retailer-only** account. An exact match against one retailer record creates a PENDING `RetailerLinkRequest`; the account remains unlinked and has no retailer scope until an administrator approves it. An unknown phone creates an unlinked retailer account with no link request.

Authentication errors are deliberately generic and do not reveal whether an account exists. The login response never includes OTPs in production.

### Retailer link approval

A verified phone is proof of phone ownership, not proof that the person owns an existing retailer business. Therefore:

- `ensureUserForVerifiedPhone` always creates a new user with `retailerId: null` and a neutral `Retailer <last4>` name. An existing unlinked `RETAILER` account receives the same review treatment on verification instead of being skipped.
- If the normalized phone matches exactly one retailer and the user has no pending request, the PENDING `RetailerLinkRequest` is recorded in the same database operation as the phone-verification update. A second sign-in does not create a duplicate pending request; a later verification may create a fresh request after an earlier one was rejected.
- The `/users` page lists pending requests to administrators. The review action re-checks the administrator's role and status inside a serializable transaction.
- Approval uses only the retailer stored on the request. The form cannot supply a different retailer ID, and the user update only succeeds when the account is an active, unlinked retailer.
- Approval and rejection both write an audit event (`RETAILER_LINK_APPROVED` or `RETAILER_LINK_REJECTED`) in the same transaction as the decision.
- Direct administrator linking through `/users` resolves that user's pending requests in the same transaction: the matching retailer request is approved and any other pending request is rejected. Unlinking leaves pending requests untouched.
- Link-request history is preserved. Foreign keys to the user, retailer, and reviewer use `ON DELETE RESTRICT`, and a partial unique index allows at most one PENDING request per user/retailer pair while keeping APPROVED and REJECTED rows.
- Access-change audit events record both `previousRetailerId` and the new `retailerId`, so a link change cannot erase the prior assignment.
- Ambiguous matches still fail closed instead of guessing. Genuinely new retailer onboarding continues to work: an unknown phone gets an unlinked retailer account and no request.

### Normalized phone identity

`User.phone` remains the display value, while `User.phoneNormalized` is the canonical `+91[6-9]XXXXXXXXX` identity:

- The normalized column is unique and has a format CHECK constraint.
- Existing users are backfilled without rewriting their display phone.
- The migration aborts if any existing phone is invalid or if two users normalize to the same number. It never silently merges, deletes, or overwrites users.
- Duplicate remediation is a manual data decision: review the user IDs and normalized numbers in the migration error, decide which account should retain the identity and what should happen to the other, then re-run the migration.
- Because the column is `NOT NULL` after the migration, deploy the new application code immediately after the migration. Until that code is live, first-time user provisioning fails closed rather than writing an incomplete row. Existing-user sign-in is unaffected.

### OTP rate limiting

Rate limiting is database-authoritative and safe across serverless instances:

- For each request, the service opens a short Prisma interactive transaction and acquires PostgreSQL transaction-scoped advisory locks derived from `otp:phone:<E.164>` and, when available, `otp:ip:<hash>`.
- The cooldown check, per-phone window count, per-IP window count, and reservation insert all execute inside that transaction. Locks are released automatically on commit, rollback, or connection loss.
- The expensive `scrypt` hash runs after the admission transaction commits and after the locks are released. A burst of rate-limited requests is rejected without paying the hashing cost.
- Completing a reservation is a separate conditional transaction: it only creates the challenge when the reservation is still `PENDING` and its lease has not elapsed. A reservation can produce at most one challenge.
- The SMS/provider call happens after the challenge transaction commits, so a slow provider never holds a database lock or transaction open.
- A provider failure marks the reservation `FAILED` and consumes the unsent challenge. FAILED and ABANDONED reservations still count toward the rate window, so repeated failures cannot create unlimited OTP requests.
- The admission lease defaults to 60 seconds (`AUTH_OTP_RESERVATION_LEASE_SECONDS`, clamped to 10–300). A crashed request leaves an abandoned row that is counted, not silently deleted. Expiry cleanup is scoped to the current phone and hashed-IP admission keys, so one request never rewrites unrelated reservation history.
- No process-local memory is authoritative. The in-memory store used by unit tests serializes the same critical section to model atomicity.
- If the database, lock wait, or transaction fails, the request fails closed with a generic authentication error. A bounded statement/transaction timeout prevents indefinite lock waits.
- Limitations: this relies on PostgreSQL advisory locks (the project targets Neon PostgreSQL), per-IP limits depend on a trustworthy client IP header, and there is no separate edge/WAF limiter. Add edge rate limiting as defense in depth before high-volume public exposure. Production SMS is still not implemented.


### Sessions

Sessions are database-backed and opaque:

- The browser receives a random token in an HTTP-only, `SameSite=Lax`, site-wide cookie. The token is `Secure` in production.
- Only a SHA-256 hash of the token is stored in the `Session` table.
- The user record is re-read on every request, so role changes and disabled accounts take effect immediately.
- Successful sign-in revokes any token already present in the browser before setting the new token, which prevents session fixation.
- Logout revokes the database session and clears the cookie.
- Session expiry, revocation, and account status are checked server-side by the data-access layer.

Session reads are request-time data and are wrapped in `<Suspense>` in the authenticated layout, as required by Next.js Cache Components. Authentication and authorization are enforced by the server data-access layer and every server action, not by navigation visibility.

### Route protection

- `src/lib/auth/session.ts` exposes `getSession`, `requireSession`, `requirePermission` and `requireAnyPermission`.
- Protected pages call the guards before querying data. Missing sessions trigger Next.js `unauthorized()`; a valid session without the required permission triggers `forbidden()`.
- Root `unauthorized.tsx` and `forbidden.tsx` files provide the 401 and 403 experiences; `(app)/error.tsx`, `(app)/loading.tsx`, and `not-found.tsx` cover error, loading, and 404 states.
- Server actions re-check the actor’s session and permission independently of the page that rendered the form.
- `src/proxy.ts` redirects requests without a session cookie to `/login?next=…` before the partially prerendered shell can stream. It is an optimistic gate only; the data-access layer remains authoritative.
- Retailer queries are scoped to the user’s linked `retailerId`; salesman queries are scoped to rows in `SalesmanRetailerAssignment`. Order desk and admin access is explicit in the permission map.
- Because Cache Components streams the authenticated shell, a request carrying a malformed or revoked cookie can render the 401 boundary with a `200` response status (Next.js adds `noindex`). The cookie-less case is handled by the proxy with a `307` redirect; every case is still denied by the server data-access layer.

### Role and permission matrix

The authoritative map is `src/lib/auth/permissions.ts`. Navigation is derived from `src/lib/auth/navigation.ts` but is not an authorization mechanism.

| Capability | Retailer | Salesman | Order Desk | Admin |
| --- | :---: | :---: | :---: | :---: |
| Dashboard | Yes | Yes | Yes | Yes |
| Product catalogue | Yes | — | — | — |
| Own orders | Yes | — | — | — |
| Assigned-retailer orders | — | Yes | — | — |
| All orders | — | — | Yes | Yes |
| Tally CSV export | — | — | Yes | Yes |
| Own credit information | Yes | — | — | — |
| All retailer credit | — | — | Yes | Yes |
| Assigned retailers | — | Yes | — | — |
| All retailers | — | — | Yes | Yes |
| View users | — | — | — | Yes |
| Manage user access | — | — | — | Yes |
| Products | — | — | — | Yes |
| Inventory | — | — | — | Yes |
| Schemes | — | — | — | Yes |
| Audit logs | — | — | — | Yes |
| Account page | Yes | Yes | Yes | Yes |

Role navigation:

- **Retailer:** Dashboard, Product Catalogue, My Orders, Account
- **Salesman:** Dashboard, Assigned Retailers, Orders, Account
- **Order Desk:** Dashboard, Order Management, Retailers, Account
- **Admin:** Dashboard, Users, Retailers, Products, Inventory, Schemes, Audit Logs

### Controlled role assignment

- Public first-time verification can only create `RETAILER` accounts.
- `ADMIN` and `ORDER_DESK` accounts must be provisioned by an existing administrator, the guarded development script, or the one-time first-administrator bootstrap.
- The `/users` page is administrator-only and uses a server action that re-validates the actor, target user, role, status, retailer link, and salesman assignments.
- Administrators cannot change their own role or status, and the action refuses to remove the final active administrator.
- Role or status changes revoke the target user's active sessions in the same transaction, so the change cannot be inherited by an existing session.
- Access changes are written to `AuditEvent` and revalidate the user list.

### OTP provider architecture

`src/lib/auth/providers.ts` defines the delivery boundary. No SMS vendor is implemented or assumed. The `OtpProvider` contract can only send a code; it does not return one. The explicit local development provider is marked `kind: "development"`, and `requestOtp` copies the code into its result only for that provider when the runtime config allows development OTP. `src/lib/auth/action-state.ts` applies a second, independent gate before the server action serializes a response.

- **Production:** the provider fails closed until a real adapter is added and configured. Production never returns or logs a verification code, even if `AUTH_DEV_OTP_ENABLED` is set by mistake. Production is detected when either `NODE_ENV` or `VERCEL_ENV` is `production`, so a misconfigured `NODE_ENV` cannot enable development OTP on Vercel.
- **Local development:** when `NODE_ENV` is not `production`, `AUTH_DEV_OTP_ENABLED=true`, and the database target passes the development-target guard, the generated code is returned to the local login UI. This is an explicit development mechanism; it is not a universal OTP and it cannot be enabled in production. Development must use a Neon branch or disposable database, never the production database.
- **Development-target guard:** `NODE_ENV` alone is not trusted. The guard parses the runtime `DATABASE_URL` with the PostgreSQL driver's own connection-string parser, then requires an allowlisted logical host (`TRADEPULSE_DEV_TARGET_HOSTS`), an explicit SHA-256 fingerprint of the effective `<host>/<port>/<database>/<schema>` target (`TRADEPULSE_DEV_TARGET_FINGERPRINT`), and no production runtime signal. When `DIRECT_URL` is present it must resolve to the same host, port, database, and schema; neither URL silently wins. Target-override query parameters such as `host`, `port`, `options`, and `service` are rejected, as are the `PGHOST`, `PGHOSTADDR`, `PGPORT`, `PGDATABASE`, `PGOPTIONS`, and `PGSERVICE` environment variables. Known production hosts can be listed in `TRADEPULSE_PRODUCTION_TARGET_HOSTS` as an extra denylist. Run `npm run db:dev-target` to print the non-secret runtime host, port, database, schema, and fingerprint. The output never includes credentials.
- **Provider integration:** implement the `OtpProvider` contract, add an adapter that uses environment-supplied credentials, and select it in `createOtpProvider`. Delivery adapters must use `kind: "sms"` and return no code. Do not invent provider credentials or commit secrets.
- Future provider environment names are documented as placeholders in `.env.example`: `AUTH_SMS_PROVIDER`, `AUTH_SMS_API_URL`, `AUTH_SMS_API_KEY`, `AUTH_SMS_SENDER_ID`.

### Development-only provisioning

The normal first-time OTP flow creates retailers only. To create an administrator, order-desk, or salesman test account after applying the migration locally:

```bash
AUTH_DEV_PROVISIONING_ENABLED=true npm run db:provision-dev -- --phone 9876543210 --role ADMIN --name "Dev Admin"
```

Examples:

```bash
# Salesman assigned to two retailer records
npm run db:provision-dev -- --phone 9876543211 --role SALESMAN \
  --assign-retailer-id retailer_id_1 --assign-retailer-id retailer_id_2

# Retailer linked to the seeded retailer by phone
npm run db:provision-dev -- --phone 9876543212 --role RETAILER \
  --retailer-phone 9000000001
```

The script requires `AUTH_DEV_PROVISIONING_ENABLED=true` **and** a database target that passes the development-target guard described above. It refuses to run when `NODE_ENV` or `VERCEL_ENV` is `production`, writes an audit event, and never creates an OTP or session. The user still signs in through the normal OTP flow. Because it can create elevated roles, a copied production `DIRECT_URL` fails closed even if the flag is set.

### First-administrator bootstrap (new environments)

Public sign-in can only create retailers, and `/users` requires an existing administrator. For a brand-new environment, apply the migration first, then run this from a trusted machine with the target environment's `DIRECT_URL`:

```bash
AUTH_BOOTSTRAP_ADMIN_ENABLED=true npm run db:bootstrap-admin -- \
  --phone 9876543210 --name "Operations Admin"
```

The command is a trusted CLI operation, not an HTTP route. It requires the explicit flag, refuses to run if an active administrator already exists, creates or promotes only the supplied normalized phone, clears retailer/salesman scope, writes a `USER_BOOTSTRAP_ADMIN` audit event, and never creates an OTP or issues a new session. When it promotes an existing user, it revokes all of that user's existing sessions in the same serializable transaction, so a pre-promotion session cannot inherit administrator access. Terminal output shows only the last four phone digits. Run it once, then use `/users` for subsequent access changes. Unset the flag after bootstrapping.

## Neon database

TradePulse runs against a Neon project named **TradePulse** on the `production` branch, database `neondb`, in AWS Asia Pacific 1 (Singapore). Neon is the only database required for development and production; no local PostgreSQL server is used by the application. The integration suite is separate and deliberately refuses Neon, requiring an explicit disposable test server as described under Verification.

Use two connection strings from the Neon dashboard:

- **Pooled** (`DATABASE_URL`) — hostname contains `-pooler`; used by the running application. In production this must be a dedicated least-privilege runtime role, not the database owner.
- **Direct** (`DIRECT_URL`) — hostname has no `-pooler`; used by Prisma CLI migrations, Prisma Studio, and the seed script. Keep the owner/direct credential in a trusted migration environment, not in Vercel.

Both endpoints require TLS. Neon supplies `sslmode=require` (and often `channel_binding=require`) in the connection string; keep those parameters. Prefer `sslmode=verify-full` when your client supports it; the bundled `pg` driver currently treats `require` as `verify-full` but warns that future versions may weaken that behavior.

The runtime role should have only `CONNECT`, schema `USAGE`, and `SELECT`/`INSERT`/`UPDATE`/`DELETE` on the application tables and enums. It must not own the database or tables and must not have `CREATEDB`, `CREATEROLE`, `REPLICATION`, `BYPASSRLS`, `TRUNCATE`, `REFERENCES`, or `TRIGGER` privileges. It also needs `EXECUTE` on the built-in `pg_advisory_xact_lock(bigint)` and `hashtextextended(text, bigint)` functions used by the OTP limiter; these are granted to `PUBLIC` by default, so only re-grant them if your hardening revokes function access. The audit's recommended role is `tradepulse_app`; see the deployment sequence below.

#### Runtime role runbook

Run this once from a trusted owner connection after the migrations have created the tables, and before the first application deployment. It is documentation for an approved operator, not something the application runs:

```sql
CREATE ROLE tradepulse_app
  WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD '<strong-random-password>';

GRANT CONNECT ON DATABASE neondb TO tradepulse_app;
GRANT USAGE ON SCHEMA public TO tradepulse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tradepulse_app;

-- Keep future migrated tables usable by the runtime role without granting DDL.
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tradepulse_app;
```

Then build the pooled runtime URL from the Neon dashboard (the `-pooler` host, database `neondb`, role `tradepulse_app`) and set it as Vercel's `DATABASE_URL`. The direct owner URL stays in the trusted migration environment. Rotate the password through Neon if it is ever exposed. Do not grant the runtime role ownership or schema-modification rights just to make a migration or Prisma command work.

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

Populate `.env` with the pooled and direct Neon URLs for a **development branch**. The file is git-ignored; never commit it.

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
DIRECT_URL="postgresql://USER:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
```

Use the least-privilege runtime role for `DATABASE_URL` whenever possible. `prisma.config.ts` routes Prisma CLI operations through `DIRECT_URL`; the application runtime reads the pooled `DATABASE_URL` through `@prisma/adapter-pg`.

`SHADOW_DATABASE_URL` is optional and only used by `prisma migrate dev`. Point it at a **separate Neon branch or database**, never at the pooled endpoint or the production branch.

For local OTP testing and development-only provisioning, add these flags and the verified target values to `.env`:

```dotenv
AUTH_DEV_OTP_ENABLED="true"
AUTH_DEV_PROVISIONING_ENABLED="true"

# Printed by `npm run db:dev-target`. The fingerprint covers the effective
# <host>/<port>/<database>/<schema> target of the runtime DATABASE_URL.
# DIRECT_URL, when set, must resolve to the same target. Credentials are never
# printed.
TRADEPULSE_DEV_TARGET_HOSTS="ep-xxxx.ap-southeast-1.aws.neon.tech"
TRADEPULSE_DEV_TARGET_FINGERPRINT="<64 lowercase hex characters>"

# Optional extra denylist for known production hosts.
TRADEPULSE_PRODUCTION_TARGET_HOSTS="ep-production-xxxx.ap-southeast-1.aws.neon.tech"
```

Never set the development flags or `TRADEPULSE_DEV_TARGET_*` on a public deployment. The OTP flag is ignored in production, the provisioning script refuses to run there, and a production database target fails the guard even if the flag is set. **Never point local development or preview environments at the production database branch.** Development OTP can display codes in the UI and the provisioning script can create elevated roles; both must operate only on disposable data.

### 4. Apply migrations and seed

The Neon database and role already exist; there is no local database to create.

```bash
npm run db:generate
npm run db:migrate:deploy
npm run db:seed
```

`db:migrate:deploy` applies the committed migrations with `DIRECT_URL`. The seed script also prefers `DIRECT_URL` and falls back to `DATABASE_URL` only for single-endpoint setups. `npm run db:generate` regenerates Prisma Client after any schema change; run it before `npm run typecheck` or `npm run build` when working from a fresh clone.

Four authentication migrations are currently pending production approval:

- `prisma/migrations/20261105090000_auth_sessions_rbac/migration.sql` is additive: it creates the `UserStatus` enum, adds nullable/defaulted user columns, and creates `OtpChallenge`, `Session`, and `SalesmanRetailerAssignment` tables with indexes and foreign keys.
- `prisma/migrations/20261106090000_user_phone_normalized/migration.sql` adds the nullable `User.phoneNormalized` column, backfills canonical `+91[6-9]XXXXXXXXX` values, and then enforces `NOT NULL`, a unique index, and a format CHECK constraint. Its failure examples show only the last four digits of a phone.
- `prisma/migrations/20261106120000_otp_reservations_retailer_link_reviews/migration.sql` is additive: it creates the `OtpReservationStatus` and `RetailerLinkRequestStatus` enums, the `OtpRequestReservation` and `RetailerLinkRequest` tables, and a nullable unique `OtpChallenge.reservationId`. Legacy challenges with a null reservation remain valid and are still counted by the compatibility path.
- `prisma/migrations/20261107120000_retailer_link_history_fks/migration.sql` preserves link-request history: it replaces the global unique `(userId, retailerId)` with a non-unique history index plus a partial unique index on PENDING rows, and changes the user, retailer, and reviewer foreign keys to `ON DELETE RESTRICT`.

All four migrations preserve existing data. The normalized-phone migration fails the whole migration transaction if any existing phone is invalid or any two users normalize to the same number; it does not rewrite `User.phone`, merge accounts, or delete rows. The link-history migration can be rolled back only if restoring the global unique pair would not collide; that collision is exactly the history the migration preserves. Review the SQL and resolve reported data issues manually before applying it. Do not apply any migration to production until the SQL has been reviewed and approved.

If `prisma migrate deploy` fails after a migration has started, do not edit the applied SQL and do not use `migrate resolve --applied` to pretend it succeeded. Correct the reported data first, then mark the failed attempt as rolled back and retry:

```bash
npx prisma migrate resolve --rolled-back 20261106090000_user_phone_normalized
npm run db:migrate:deploy
```

Use the migration directory name exactly as it appears in `prisma/migrations/`. Never use `--rolled-back` for a migration that actually completed successfully.

**Deployment ordering:** apply the normalized-phone migration before deploying the application code that writes `phoneNormalized`. The migration takes the column from nullable to `NOT NULL`, so during the short rollout window old code cannot create a first-time user; the request fails closed. Run the migration during a controlled low-traffic window and deploy the matching application build immediately afterward. Apply `20261107120000_retailer_link_history_fks` before deploying code that relies on multiple historical link requests for the same user/retailer pair or on direct-link request resolution. Never run the new application code against a database that has not applied the corresponding migrations.

**Retailer link-history rollback:** the preferred recovery is forward-only. If migration 4 must be rolled back in a disposable or rehearsed environment, drop `RetailerLinkRequest_userId_retailerId_pending_key` and `RetailerLinkRequest_userId_retailerId_idx`, recreate the global unique `RetailerLinkRequest_userId_retailerId_key`, and restore the previous CASCADE/SET NULL foreign-key actions. The rollback fails if history contains a duplicate user/retailer pair, which is expected. Never delete review history to make a rollback succeed. The integration suite exercises this rollback and re-apply path against a disposable database.


### 5. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in at `/login`. With `AUTH_DEV_OTP_ENABLED=true` and a verified development target, the local development code appears in the login card. A first-time verified phone becomes a retailer account; a phone matching an existing retailer creates a pending link request for administrator review. Use `npm run db:provision-dev` to create admin, order-desk, or salesman test accounts. The health check is at [http://localhost:3000/api/health](http://localhost:3000/api/health).

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | — | Pooled Neon connection (`-pooler` host) used by the running application. In production, use the least-privilege runtime role. |
| `DIRECT_URL` | Yes | — | Direct, non-pooled Neon connection used by Prisma CLI migrations, Prisma Studio, and the seed script. Keep the owner credential in a trusted migration environment. |
| `SHADOW_DATABASE_URL` | No | — | Separate Neon branch/database used only by `prisma migrate dev` for drift detection. Never point it at the production branch. |
| `AUTH_OTP_TTL_SECONDS` | No | `300` | OTP lifetime in seconds (bounded to 900). |
| `AUTH_OTP_MAX_ATTEMPTS` | No | `5` | Maximum verification attempts per challenge (bounded to 10). |
| `AUTH_OTP_RESEND_COOLDOWN_SECONDS` | No | `60` | Minimum seconds between OTP requests for one phone (bounded to 600). |
| `AUTH_OTP_RESERVATION_LEASE_SECONDS` | No | `60` | Admission reservation lease in seconds (clamped to 10–300). Expired leases become `ABANDONED` and still count for the rate window. |
| `AUTH_OTP_RATE_WINDOW_MINUTES` | No | `15` | Rate-limit window for OTP requests (bounded to 60 minutes). |
| `AUTH_OTP_MAX_REQUESTS_PER_WINDOW` | No | `5` | Maximum OTP requests per phone in the window (bounded to 20). |
| `AUTH_OTP_MAX_REQUESTS_PER_IP_WINDOW` | No | `20` | Maximum OTP requests per hashed IP in the window (bounded to 200). |
| `AUTH_SESSION_TTL_DAYS` | No | `7` | Session lifetime in days (bounded to 30). |
| `AUTH_DEV_OTP_ENABLED` | No | `false` | Development only. Returns the generated OTP to the local UI when the dev-target guard also passes. Ignored in production. |
| `AUTH_DEV_PROVISIONING_ENABLED` | No | `false` | Development only. Required by `npm run db:provision-dev`; requires a verified dev target and refuses production. |
| `TRADEPULSE_DEV_TARGET_HOSTS` | Dev only | — | Comma-separated allowlist of logical database hosts (Neon pooled and direct forms are normalized; no other host suffix is rewritten). Required for development OTP and provisioning. |
| `TRADEPULSE_DEV_TARGET_FINGERPRINT` | Dev only | — | SHA-256 fingerprint of the effective `<host>/<port>/<database>/<schema>` target printed by `npm run db:dev-target`. Required for development OTP and provisioning. |
| `TRADEPULSE_PRODUCTION_TARGET_HOSTS` | No | — | Optional comma-separated denylist of known production hosts. A match always fails the development-target guard. |
| `TRADEPULSE_TEST_DATABASE_ADMIN_URL` | Integration tests only | — | Explicit disposable PostgreSQL admin URL used only by `npm run test:integration`. Never falls back to `DATABASE_URL`/`DIRECT_URL`; Neon and production-looking targets are rejected. Set it in the test shell, not in the application `.env`. |
| `AUTH_BOOTSTRAP_ADMIN_ENABLED` | No | `false` | Trusted CLI only. Required by `npm run db:bootstrap-admin`; refuses when an active administrator exists. |

Future SMS provider placeholders (not implemented yet): `AUTH_SMS_PROVIDER`, `AUTH_SMS_API_URL`, `AUTH_SMS_API_KEY`, `AUTH_SMS_SENDER_ID`. Until a real provider adapter exists, production OTP requests fail closed with a generic error.

The Vercel build only needs `DIRECT_URL` to be syntactically present for `prisma generate`; it does not connect. Do not store the Neon owner credential in Vercel. Use a non-owner placeholder for the build and run migrations from a trusted machine.

Invalid or non-positive numeric values fall back to the bounded defaults. The authentication flags never disable rate limiting or the production fail-closed behavior.

The connection strings must use the `postgresql://` or `postgres://` protocol. A missing `DATABASE_URL` does not stop the web server from booting; database-backed requests (including `/api/health`) fail with a clear message and the health endpoint reports `degraded`. Prisma CLI commands exit early when `DIRECT_URL` is missing. The seed script prefers `DIRECT_URL` and falls back to `DATABASE_URL` for single-endpoint setups.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js development server. |
| `npm run build` | Generate Prisma Client, then create a production build. |
| `npm run start` | Serve the production build. |
| `npm run lint` | Run ESLint. |
| `npm run typecheck` | Generate Next.js route types, then run TypeScript without emitting files. |
| `npm test` | Run the authentication, OTP, session, RBAC, and validation unit tests. |
| `npm run test:integration` | Run the disposable-PostgreSQL integration suite. Requires `TRADEPULSE_TEST_DATABASE_ADMIN_URL`; creates and drops its own `tradepulse_test_*` databases. |
| `npm run db:generate` | Generate Prisma Client into `src/generated/prisma/` after cloning or a schema change. |
| `npm run db:validate` | Validate the Prisma schema. |
| `npm run db:dev-target` | Print the non-secret host, database, and fingerprint used by the development-target guard. |
| `npm run db:migrate` | Create and apply a development migration (`prisma migrate dev`). |
| `npm run db:migrate:deploy` | Apply committed migrations (`prisma migrate deploy`). |
| `npm run db:bootstrap-admin` | One-time first-administrator bootstrap; requires `AUTH_BOOTSTRAP_ADMIN_ENABLED=true`. |
| `npm run db:provision-dev` | Development-only user provisioning; requires `AUTH_DEV_PROVISIONING_ENABLED=true`. |
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

Set the following in the Vercel project. Values are never printed in this document.

| Name | Production scope | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required | Pooled Neon connection (`-pooler` host) for the **least-privilege runtime role** (`tradepulse_app` or equivalent). |
| `DIRECT_URL` | Required for build | Syntactically valid, non-owner placeholder used only because `prisma.config.ts` requires the variable for `prisma generate`. The build does not connect to the database. |
| `AUTH_OTP_*`, `AUTH_SESSION_TTL_DAYS` | Optional | Bounded authentication tuning; omit to use defaults. |
| `AUTH_SMS_*` | Only after adapter | Provider settings for the future SMS adapter. Not implemented yet. |

Do **not** store the Neon owner credential (`neondb_owner`) in Vercel. Run `prisma migrate deploy` and other Prisma CLI commands from a trusted local or CI environment that has the owner `DIRECT_URL`. The Vercel build only needs a placeholder; the build command does not run migrations. Keep that placeholder non-privileged or intentionally invalid. Non-ownership alone does not prevent DDL if the role still has write or schema grants.

Do **not** add `SHADOW_DATABASE_URL` to Vercel; it is only for local `prisma migrate dev`. Never prefix any database or SMS variable with `NEXT_PUBLIC_`.

Do **not** set `AUTH_DEV_OTP_ENABLED`, `AUTH_DEV_PROVISIONING_ENABLED`, or `AUTH_BOOTSTRAP_ADMIN_ENABLED` in Vercel. Until a real SMS provider adapter is implemented, production OTP requests fail closed with a generic error even if a development flag is accidentally present.

For Preview deployments, use a separate Neon branch and that branch's pooled and direct URLs. Do not point Preview at the production branch. Redeploy after changing environment variables; existing deployments do not pick them up automatically.

### 3. Apply migrations separately

The Vercel build deliberately does **not** run `prisma migrate deploy`. Apply schema changes from a trusted environment using the production owner `DIRECT_URL`:

```bash
npm run db:migrate:deploy
```

Run this before deploying code that depends on a new migration. Never run `prisma migrate dev`, `prisma migrate reset`, or `prisma db push` against the production branch.

Recommended production sequence after approval:

1. Create a Neon branch or snapshot of the production branch as a rollback point.
2. From a trusted machine with the production owner `DIRECT_URL`, run `npx prisma migrate status` and then `npm run db:migrate:deploy`. Confirm the migration is applied and the second status check has no pending migrations. If the normalized-phone migration reports invalid or duplicate phones, stop: resolve the listed user records manually. Then mark the failed attempt as rolled back and retry:
   ```bash
   npx prisma migrate resolve --rolled-back 20261106090000_user_phone_normalized
   npm run db:migrate:deploy
   ```
   Do not force, delete users, use `--applied`, or bypass the constraint.
3. Create or verify the least-privilege runtime role (`tradepulse_app` or equivalent) and its grants **before** deploying the application. Use that role's pooled connection as the production `DATABASE_URL`.
4. Configure the Vercel production environment before the application deployment: the runtime-role pooled `DATABASE_URL` plus a syntactically valid, non-owner `DIRECT_URL` placeholder for `prisma generate`. Keep the Neon owner credential out of Vercel.
5. Deploy the application build that reads and writes the new schema. The build runs `prisma generate`; run `npm run db:generate` locally if you need to verify types before pushing. Confirm `/api/health` reports the database as up.
6. Bootstrap the first administrator from the trusted machine with the production owner `DIRECT_URL` (see below), then unset the bootstrap flag immediately.
7. Implement and configure a real SMS provider adapter before relying on production sign-in. Until then, production OTP remains intentionally unavailable.
8. Run a controlled sign-in test and verify role-scoped access, logout, audit records, retailer link approval, and that concurrent OTP requests are limited.

After the authentication migrations are applied to a **brand-new** environment, create the first administrator once:

```bash
AUTH_BOOTSTRAP_ADMIN_ENABLED=true npm run db:bootstrap-admin -- \
  --phone 9876543210 --name "Operations Admin"
```

The script refuses to run if an active administrator already exists, revokes existing sessions if it promotes an existing user, and prints only the last four phone digits. Do not leave the bootstrap flag enabled in any environment.

> **Milestone 2 production approval required:** `prisma/migrations/20261105090000_auth_sessions_rbac/migration.sql`, `prisma/migrations/20261106090000_user_phone_normalized/migration.sql`, `prisma/migrations/20261106120000_otp_reservations_retailer_link_reviews/migration.sql`, and `prisma/migrations/20261107120000_retailer_link_history_fks/migration.sql` have been generated and validated but have **not** been applied to production. Review the SQL and obtain explicit approval before running `npm run db:migrate:deploy` against the production branch.

### 4. Verify the deployment

- `/` returns HTTP `200` and renders the landing page.
- `/api/health` returns HTTP `200` with `"status": "ok"` and `checks.database.status: "up"`.
- After the Milestone 2 deployment, `/login` returns HTTP `200` and cookie-less requests to `/dashboard` redirect to `/login`.

A `503` with `database: "down"` means the Vercel runtime cannot reach Neon; check `DATABASE_URL` and the Neon project status. A build failure during `prisma generate` usually means `DIRECT_URL` is missing from the Vercel environment. Do not fix that by adding the owner credential; add a non-owner placeholder used only for generation.

## Data model

The schema lives in [`prisma/schema.prisma`](prisma/schema.prisma).

| Model | Purpose |
| --- | --- |
| `User` | People using the system. Roles: `RETAILER`, `SALESMAN`, `ORDER_DESK`, `ADMIN`. Adds `ACTIVE`/`DISABLED` status, verified-phone and last-login timestamps. `phone` preserves the display value; unique `phoneNormalized` stores the canonical `+91` identity used for exact lookups. Retailer users link to a `Retailer`. |
| `Retailer` | Kirana shop account, including credit limit. |
| `Product` | Catalogue item keyed by SKU, with dealer price, GST rate, and active flag. |
| `RetailerProductPrice` | Retailer-specific selling price. At most one current price per retailer/SKU. |
| `Inventory` | Stock and reserved cases per product (one-to-one with `Product`). |
| `Scheme` | `BUY_X_GET_Y` or `PERCENTAGE_DISCOUNT` offers, optionally time-bounded. |
| `Order` | Order header with status, source, and Decimal totals. |
| `OrderItem` | Line item with **price snapshots** (`productName`, `unitLabel`, `unitPrice`, `gstRate`) so historical orders survive catalogue and price changes. |
| `OtpRequestReservation` | Admission lease created before OTP hashing. Counts toward the phone/IP rate window immediately; statuses are `PENDING`, `CONSUMED`, `FAILED`, and `ABANDONED`. |
| `OtpChallenge` | Short-lived phone challenge with a salted scrypt hash, attempt counter, expiry, consumption time, optional hashed request IP, and an optional unique link to its admission reservation. |
| `RetailerLinkRequest` | Pending or reviewed request to link a verified retailer account to an existing retailer. Unique per user/retailer pair; approval is administrator-only and audited. |
| `Session` | Opaque session with a unique SHA-256 token hash, user relation, expiry, last-seen time, revocation time, and optional hashed request IP. |
| `SalesmanRetailerAssignment` | Explicit salesman-to-retailer scope. Unique per salesman/retailer pair; cascades on user or retailer deletion. |
| `AuditEvent` | Generic activity trail with actor, entity reference, and JSONB metadata. User-access changes are recorded here. |

Conventions:

- All primary keys are `cuid()` strings, except `Product` (SKU) and `Inventory` (product SKU).
- Money uses `Decimal(12,2)` or `Decimal(14,2)`; percentages use `Decimal(5,2)`. JavaScript `number` is never used for persisted money.
- Timestamps use `TIMESTAMPTZ(3)` with `createdAt`/`updatedAt` where appropriate.
- Order status and source use enums; user role/status and scheme type use enums.
- Foreign keys are explicit: cascading for dependent catalogue data and sessions/assignments, `RESTRICT` for order history, `SET NULL` for optional actor/retailer links.
- CHECK constraints enforce non-negative money/stock, positive quantities, GST/discount ranges, non-negative OTP attempts, positive maximum attempts, and session expiry after creation.
- Raw OTPs and raw session tokens are never stored. OTPs use salted scrypt hashes; session tokens use SHA-256 hashes.

### Price history

`RetailerProductPrice` stores the current price only. Historical prices are captured on `OrderItem` at order time, so changing a product or retailer price never rewrites an existing order.

### Order Desk Tally export

`/orders/export` provides a read-only, Tally-compatible **CSV** export for the Order Desk and administrators. It is not native Tally XML.

- **Eligible orders:** `APPROVED`, `PROCESSING`, `READY_FOR_DISPATCH`, `DISPATCHED`, `DELIVERED`, and `FULFILLED`. `DRAFT`, `PENDING_REVIEW`, `ON_CREDIT_HOLD`, `REJECTED`, and `CANCELLED` are never exported.
- **Fields:** order number, order date, customer name, SKU, product name, unit, paid quantity, free quantity, unit price, discount, scheme name/type/percentage, GST rate, GST amount, line total, and order total. The CSV is line-level, so order fields repeat on every line.
- **Pricing basis:** `OrderItem.unitPrice` is **GST-exclusive**. The scheme discount reduces the taxable value; for `BUY_X_GET_Y` it equals the value of the free units. `OrderItem.lineTotal` and `Order.total` are **GST-inclusive**. All values come from the immutable order snapshots, never from current catalogue prices.
- **Customer data:** customer name is the retailer's current `shopName`. No GSTIN is exported because the schema does not store one.
- **Bounds and filters:** inclusive `Asia/Kolkata` date filters; at most 500 orders and 5,000 lines per export. The preview summary is itself bounded: it reads at most 501 orders, shows `500+` when the cap is exceeded, and refuses the download. Empty or over-limit ranges render an explanatory state instead of a file.
- **Safety:** UTF-8 with BOM, quoted and escaped cells, formula-injection prefixes neutralized (including values that start with whitespace), deterministic filename, and `Cache-Control: no-store`. Each successful download appends an `ORDER_TALLY_EXPORTED` / `OrderExport` audit event with aggregate counts only. Eligibility is evaluated when the export query runs, and exporting never creates or modifies an order.

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
│   │   ├── 20261104010000_data_integrity_checks/
│   │   ├── 20261105090000_auth_sessions_rbac/
│   │   ├── 20261106090000_user_phone_normalized/
│   │   ├── 20261106120000_otp_reservations_retailer_link_reviews/
│   │   └── 20261107120000_retailer_link_history_fks/
│   ├── schema.prisma
│   └── seed.ts
├── scripts/
│   ├── bootstrap-admin.ts        # one-time first administrator, explicit flag
│   ├── provision-dev-user.ts    # dev-only, production-refusing provisioning
│   └── lib/                     # shared CLI and normalized phone lookup
├── src/
│   ├── app/
│   │   ├── (app)/                # authenticated shell and role-scoped pages
│   │   │   ├── account/
│   │   │   ├── audit-logs/
│   │   │   ├── catalogue/
│   │   │   ├── dashboard/
│   │   │   ├── inventory/
│   │   │   ├── orders/
│   │   │   ├── products/
│   │   │   ├── retailers/
│   │   │   ├── schemes/
│   │   │   ├── users/
│   │   │   ├── error.tsx
│   │   │   ├── layout.tsx
│   │   │   └── loading.tsx
│   │   ├── (auth)/login/         # phone and OTP sign-in
│   │   ├── api/health/route.ts
│   │   ├── forbidden.tsx
│   │   ├── unauthorized.tsx
│   │   ├── not-found.tsx
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── auth/login-form.tsx
│   │   ├── users/user-access-editor.tsx
│   │   ├── app-shell.tsx
│   │   ├── app-shell-skeleton.tsx
│   │   ├── brand-mark.tsx
│   │   └── ui/                   # shadcn/ui primitives
│   ├── generated/prisma/         # generated, git-ignored
│   └── lib/
│       ├── auth/                 # OTP, sessions, RBAC, navigation, actions
│       ├── users/                # admin user listing and access actions
│       ├── db/index.ts           # lazy Prisma singleton + pg adapter
│       └── utils.ts
├── tests/
│   └── integration/              # disposable-PostgreSQL integration suite
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

The Milestone 2 migration is additive and was generated with the read-only `prisma migrate diff` command, then extended with CHECK constraints. The Milestone 2.3 normalized-phone migration is also additive and was written with an explicit safe backfill and fail-closed duplicate/invalid checks. The Milestone 2.5 migrations add the reservation ledger, the retailer link-request workflow, a nullable `OtpChallenge.reservationId`, and history-preserving link-request indexes and foreign keys; they rewrite no existing rows. None of the four has been applied to the production branch. Confirm the exact SQL and obtain approval before deploying.

The Milestone 2.5 OTP limiter adds an `OtpRequestReservation` table: admission is a short advisory-locked transaction, hashing happens outside it, and completion is a separate conditional transaction. It still uses the standard PostgreSQL `pg_advisory_xact_lock` and `hashtextextended` functions available on Neon. No paid external limiter dependency is introduced.

If a deployment fails partway through a migration, correct the data and mark that attempt rolled back before retrying. Do not edit an already-applied migration and do not use `migrate resolve --applied` to skip checks:

```bash
npx prisma migrate resolve --rolled-back 20261106120000_otp_reservations_retailer_link_reviews
npm run db:migrate:deploy
```

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
- **Secrets:** keep `DIRECT_URL` and `DATABASE_URL` in the deployment platform's secret store and in the local `.env` file only. Rotate the Neon role password if a URL is exposed. Keep the owner credential out of Vercel.

The current audited connection uses Neon's `neondb_owner` role for both runtime and migrations. Before enabling authentication publicly, create a separate least-privilege runtime role for `DATABASE_URL` and reserve the owner role for migrations and administration. The runtime role needs only `CONNECT`, `USAGE` on `public`, and `SELECT`/`INSERT`/`UPDATE`/`DELETE` on application tables and enum types. It must not own the database or tables and must not have `CREATEDB`, `CREATEROLE`, `REPLICATION`, `BYPASSRLS`, `TRUNCATE`, `REFERENCES`, or `TRIGGER`.

## Verification

Read-only checks (safe to run without changing the database):

```bash
npm test
npm run lint
npm run typecheck
npm run db:validate
npm run build
```

The PostgreSQL integration suite is separate and must never use `DATABASE_URL`, `DIRECT_URL`, Neon, or production credentials. Set an explicit disposable admin URL in the test shell:

```bash
# PowerShell example; the value is a disposable local/isolated server only.
$env:TRADEPULSE_TEST_DATABASE_ADMIN_URL = "postgresql://test_admin:password@127.0.0.1:5432/postgres?sslmode=disable"
npm run test:integration
```

The harness refuses Neon hosts, production-looking database/schema names, and known production hosts. It generates a unique `tradepulse_test_*` database, applies the migration chain there, and drops only that generated database. It never falls back to the application connection variables. If the variable is missing, the suite fails loudly instead of reporting a misleading pass. Run it in a disposable environment before production migrations and authentication go-live; an environment without an explicit test server reports the suite as **BLOCKED**, not passed.

Migration and seed commands change the target database. Run them only against a development branch or after explicit approval for production:

```bash
npm run db:migrate:deploy
npm run db:seed
```

With a server running (`npm run start` or `npm run dev`):

```bash
curl http://localhost:3000/api/health
```

The health endpoint must return HTTP `200` with `checks.database.status: "up"`. Because the application connects to Neon, this check also passes while any local PostgreSQL installation is stopped. A database failure returns HTTP `503` after the 5-second query timeout.

Milestone 1 verified the original schema, migrations, seed idempotency, landing page, health check, lint, typecheck and production build. Milestone 2 unit tests cover phone normalization, OTP expiry/attempts/cooldown/rate limits, provider fail-closed behavior, action-layer development-code suppression, session validation and logout, cookie hardening, safe redirects, RBAC, retailer/salesman scope, navigation, controlled access assignment, bootstrap session revocation and phone masking, and normalized phone lookup. Milestone 2.3 adds regression coverage for concurrent same-phone and per-IP OTP requests, exact cooldown boundaries, limiter failure, legacy-format phone users, canonical `phoneNormalized` queries, migration backfill/duplicate/invalid safeguards, and production development-code suppression. Milestone 2.5 adds regression coverage for admission-before-hash ordering, no hashing for rate-limited requests, scoped stale-reservation cleanup, abandoned reservations still counting toward the window, provider-failure reservation state, pending retailer linking for new and existing unlinked retailer accounts, duplicate and historical link requests, retailer-review authorization and single-decision behavior, direct-link pending-request resolution, previous/new retailer audit metadata, development-target runtime/direct mismatch, query-parameter and `PG*` overrides, port/schema fingerprinting, provider gating on the verified target, and masked phone numbers in migration errors. The disposable-PostgreSQL integration suite covers advisory-lock admission, single-winner completion, lease expiry, scoped expiry, provider-failure state, concurrent approvals, audit-failure rollback, restrictive foreign keys, the partial unique pending index, migration-3 legacy rows, and the migration-4 rollback/re-apply path. All four authentication migrations remain pending production approval.

## Security notes

- `.env` is git-ignored; `.env.example` contains placeholders only.
- No credentials are hard-coded in source or migrations.
- The current audited `neondb_owner` role is not a PostgreSQL superuser, but it owns the database and has `CREATEDB`/`CREATEROLE` privileges. Create a least-privilege runtime role for `DATABASE_URL` before exposing the application publicly, and keep the owner role for trusted migrations only.
- The health endpoint does not expose driver errors or connection strings, and its error logging is deliberately limited to an error code.
- All database access goes through Prisma's parameterized query layer.
- OTPs are stored as salted scrypt hashes and consumed exactly once. Raw OTPs are never persisted, logged, or returned in production.
- The OTP provider contract cannot return a verification code. Development codes are gated independently by the OTP service and the server-action response builder, so a production response cannot serialize one even if a development flag is accidentally set.
- Session tokens are random, stored as SHA-256 hashes, and sent only in HTTP-only, `SameSite=Lax` cookies that are `Secure` in production.
- OTP requests are limited per phone and per hashed IP; verification has an expiry and a bounded attempt count. Admission is serialized by PostgreSQL transaction-scoped advisory locks, and the expensive hash runs after those locks are released. Concurrent serverless instances cannot bypass the limits. Authentication errors are generic and do not reveal account existence.
- Public registration is fixed to the `RETAILER` role. Elevated roles require an administrator action or the guarded development script.
- A verified phone alone never grants retailer scope. A match with an existing retailer creates a PENDING `RetailerLinkRequest` for both new and existing unlinked retailer accounts; only an administrator can approve it, using the retailer stored on the request. Approval and rejection are audited, and the administrator is re-checked inside a serializable transaction. A partial unique index permits only one PENDING request per pair while retaining decided history, and restrictive foreign keys prevent history from being cascade-deleted.
- Every protected page and server action re-authorizes on the server. Retailer and salesman data access is scoped in the database query, not just hidden in navigation.
- Access changes are audited, including the previous and new retailer IDs. Administrators cannot change their own role/status and cannot remove the final active administrator.
- Admin-UI role or status changes revoke the target user's active sessions in the same serializable transaction, so a pre-change session cannot inherit new access.
- Bootstrap promotion revokes the existing user's sessions inside the serializable transaction, and terminal output shows only the last four phone digits. Development provisioning also masks the phone in its success message.
- User identity lookups use the unique `User.phoneNormalized` column. Legacy retailer matching still compares formatted candidate phones and fails closed on duplicate normalized matches. The normalized user column is the structural fix for user identity ambiguity; the migration aborts rather than merging existing duplicate users.
- No production SMS adapter is implemented. Production OTP requests fail closed until a real provider is integrated, configured, and tested.
- OTP request limits are atomic within the database: concurrent requests serialize on per-phone and per-IP advisory locks, and a lock/database failure fails closed. The provider call runs outside the lock after the challenge commits. FAILED and ABANDONED reservations remain counted, so a provider outage or crashed request cannot reset the limits. Add edge rate limiting as defense in depth before high-volume public exposure and before enabling production SMS.
- The development OTP flag is ignored in production, and both development OTP and development provisioning require an explicit allowlisted host plus a matching SHA-256 fingerprint of the effective runtime `<host>/<port>/<database>/<schema>` target. `DIRECT_URL`, when present, must resolve to the same target, and target-override query parameters or `PG*` variables fail closed. A copied production database URL cannot pass the guard. The provisioning script refuses production environments, and the first-administrator bootstrap is a CLI-only operation that refuses when an active administrator already exists.
- Neon connections require TLS. Keep the `sslmode` (and optional `channel_binding`) parameters from the Neon dashboard; prefer `sslmode=verify-full` where the deployment environment trusts the relevant CA.
- Use a least-privilege runtime role for `DATABASE_URL` and reserve the database owner role for migrations and administration where possible.
- Authentication responses should be served over HTTPS in production; the session cookie is `Secure` when either `NODE_ENV` or `VERCEL_ENV` is `production`.

## Next milestone

Milestone 3 is expected to build ordering and checkout on top of the authenticated shell, including the scheme calculation foundation and order-desk review workflows. AI text/image/voice capture, credit management, Tally integration, van loading and offline sync remain later milestones.
