# Milestone 3 — Retailer Catalogue, Pricing, Schemes and Cart

> Working plan. Build owns implementation; no commits or pushes are permitted in this milestone without separate approval.

**Goal:** Give an authenticated retailer a working catalogue with isolated pricing, stock visibility, scheme benefits, and a server-calculated cart.

**Architecture:** Server components by default. Pure money/scheme/cart services are tested with fixtures. Prisma repositories enforce retailer scope. A temporary owner-bound cookie stores only SKU and paid quantity; all prices, stock, schemes and totals are recomputed on the server.

**Constraints:**
- Work only in `F:\Projects\TradePulse`.
- Branch `feature/milestone-3-retailer-catalogue`.
- No Neon connection, migration application, seed run, user bootstrap, OTP, deployment, commit or push.
- No price, discount, stock or total is trusted from the browser.
- Money uses integer paise/BigInt, never floating point.
- One scheme per line; no stacking.

## File map

- `prisma/schema.prisma` — additive `Product.brand`, `category`, `imageUrl`.
- `prisma/migrations/20261107130000_product_catalogue_metadata/migration.sql` — additive SQL, not applied.
- `prisma/seed.ts` — demo brand/category/image metadata and local SVG paths.
- `public/products/*.svg` — lightweight demo product illustrations.
- `src/lib/money.ts` — exact paise parsing, percentage, rounding, formatting.
- `src/lib/inventory/stock.ts` — availability and stock status.
- `src/lib/schemes/engine.ts` — active-window, minimum-quantity, Buy X Get Y and percentage evaluation.
- `src/lib/catalogue/{types,filters,service,repository,image}.ts` — catalogue mapping, validated URL filters, Prisma adapter.
- `src/lib/cart/{types,cookie,service,store,action-types,actions,authorization}.ts` — owner-bound cart and server actions.
- `src/lib/i18n/catalogue-copy.ts` — typed English copy for future Hindi addition.
- `src/components/catalogue/*` — cards, filters, stock/scheme badges, add button, pagination.
- `src/components/cart/*` — line controls, summary, clear-cart.
- `src/app/(app)/catalogue/{page,loading,error}.tsx` — catalogue route.
- `src/app/(app)/cart/{page,loading,error}.tsx` — cart route.
- `src/components/app-shell.tsx`, `src/lib/auth/navigation.ts`, `src/app/(app)/layout.tsx`, `src/proxy.ts` — cart link/count and route protection.
- `src/lib/auth/__tests__/permissions.test.ts` — updated retailer navigation expectation.

## Tasks

### 1. Additive product metadata

- Add nullable `brand`, `category`, `imageUrl` fields and `@@index([isActive, category])`.
- Create the additive migration SQL; do not apply it.
- Extend the seed with demo brand/category and local image paths.
- Add local SVG product assets.
- Run `npm run db:generate` and `npm run db:validate`.

### 2. Money and scheme engine

- Write failing tests for paise parsing, half-up percentage rounding, GST, and formatting.
- Implement `src/lib/money.ts`.
- Write failing tests for active/expired/future/inactive schemes, minimum quantity, Buy 10 Get 1, 3% at 5+, single-scheme selection, and invalid scheme data.
- Implement `src/lib/schemes/engine.ts`.

### 3. Stock and catalogue logic

- Write failing tests for available stock, statuses, missing inventory, search by name/SKU/brand, category/availability filters, sorting, pagination, retailer price isolation and missing price.
- Implement stock and catalogue filters/service.
- Implement the Prisma repository with a lightweight candidate query and one hydrate query.

### 4. Cart logic

- Write failing tests for cookie parsing, owner binding, max lines, quantity validation, out-of-stock, missing price, over-stock, scheme totals, empty cart and unauthorized scope.
- Implement cart types, cookie codec, cart service and authorization guard.
- Implement server actions that only read SKU/quantity and re-fetch all commercial data.

### 5. Catalogue UI

- Replace the read-only catalogue page with search, category/availability filters, sorting, pagination, responsive cards, fallback images, stock badges, scheme information and add-to-cart.
- Add loading/error/empty states and a cart action in the page header.

### 6. Cart UI and navigation

- Add `/cart` with quantity controls, remove/clear, scheme benefits, subtotal, discounts, GST breakdown and estimated total.
- Add the cart link and item-count badge to the retailer navigation.
- Extend the proxy matcher and navigation test.

### 7. Verification and review

- Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run db:validate`, `npm run build`.
- Inspect the diff and security-sensitive paths.
- Obtain independent review if warranted.
- Report exact results, database limitations and remaining issues.
- Do not commit, push, apply the migration, seed or deploy.
