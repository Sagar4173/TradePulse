import type { Metadata } from "next";
import { ShoppingCart, Store } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ProductCard } from "@/components/catalogue/product-card";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { AVAILABILITY_FILTERS, CATALOGUE_SORTS } from "@/lib/catalogue/types";
import { parseCatalogueFilters } from "@/lib/catalogue/filters";
import { loadCataloguePage } from "@/lib/catalogue/service";
import type { CatalogueFilters } from "@/lib/catalogue/types";
import { catalogueCopy } from "@/lib/i18n/catalogue-copy";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Product Catalogue — TradePulse",
  description:
    "Retailer-specific pricing, live stock visibility and current schemes.",
};

type SearchParams = Record<string, string | string[] | undefined>;

function catalogueHref(filters: CatalogueFilters, page: number): string {
  const params = new URLSearchParams();

  if (filters.query) {
    params.set("q", filters.query);
  }

  if (filters.category) {
    params.set("category", filters.category);
  }

  if (filters.availability !== "all") {
    params.set("availability", filters.availability);
  }

  if (filters.sort !== "name-asc") {
    params.set("sort", filters.sort);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  const query = params.toString();
  return query ? `/catalogue?${query}` : "/catalogue";
}

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await requirePermission(PERMISSIONS.CATALOGUE_VIEW);

  if (session.user.role !== "RETAILER" || !session.user.retailerId) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={catalogueCopy.eyebrow}
          title={catalogueCopy.title}
          description={catalogueCopy.description}
        />
        <EmptyState
          icon={Store}
          title={catalogueCopy.retailerRequired.title}
          description={catalogueCopy.retailerRequired.description}
        />
      </div>
    );
  }

  const filters = parseCatalogueFilters(await searchParams);
  const data = await loadCataloguePage(session.user.retailerId, filters);
  const copy = catalogueCopy;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
        actions={
          <Link
            href="/cart"
            className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
          >
            <ShoppingCart aria-hidden="true" data-icon="inline-start" />
            {copy.cartLink}
          </Link>
        }
      />

      <Card>
        <CardContent>
          <form
            method="get"
            action="/catalogue"
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
            aria-label={copy.filters.heading}
          >
            <div className="sm:col-span-2 xl:col-span-1">
              <Label htmlFor="catalogue-search">
                {copy.filters.searchLabel}
              </Label>
              <Input
                id="catalogue-search"
                name="q"
                type="search"
                defaultValue={filters.query}
                placeholder={copy.filters.searchPlaceholder}
                maxLength={80}
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="catalogue-category">
                {copy.filters.categoryLabel}
              </Label>
              <Select
                id="catalogue-category"
                name="category"
                defaultValue={filters.category ?? "all"}
                className="mt-1.5"
              >
                <option value="all">{copy.filters.allCategories}</option>
                {data.categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="catalogue-availability">
                {copy.filters.availabilityLabel}
              </Label>
              <Select
                id="catalogue-availability"
                name="availability"
                defaultValue={filters.availability}
                className="mt-1.5"
              >
                {AVAILABILITY_FILTERS.map((value) => (
                  <option key={value} value={value}>
                    {copy.filters.availability[value]}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="catalogue-sort">
                {copy.filters.sortLabel}
              </Label>
              <Select
                id="catalogue-sort"
                name="sort"
                defaultValue={filters.sort}
                className="mt-1.5"
              >
                {CATALOGUE_SORTS.map((value) => (
                  <option key={value} value={value}>
                    {copy.filters.sort[value]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex flex-wrap items-end gap-2 sm:col-span-2 xl:col-span-4">
              <button
                type="submit"
                className={cn(buttonVariants(), "min-h-11")}
              >
                {copy.filters.apply}
              </button>
              <Link
                href="/catalogue"
                className={cn(
                  buttonVariants({ variant: "ghost" }),
                  "min-h-11",
                )}
              >
                {copy.filters.clear}
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium" aria-live="polite">
          {copy.resultCount(data.total)}
        </p>
        {data.pageCount > 1 ? (
          <p className="text-sm text-muted-foreground">
            {copy.pagination.pageOf(data.page, data.pageCount)}
          </p>
        ) : null}
      </div>

      {data.items.length === 0 ? (
        <EmptyState
          icon={Store}
          title={copy.empty.title}
          description={copy.empty.description}
          action={
            <Link
              href="/catalogue"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-11",
              )}
            >
              {copy.empty.action}
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((item) => (
            <ProductCard key={item.sku} item={item} />
          ))}
        </div>
      )}

      {data.pageCount > 1 ? (
        <nav
          aria-label="Catalogue pagination"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          {data.page > 1 ? (
            <Link
              href={catalogueHref(data.filters, data.page - 1)}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-11",
              )}
              rel="prev"
            >
              {copy.pagination.previous}
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-11 opacity-50",
              )}
            >
              {copy.pagination.previous}
            </span>
          )}

          <p className="text-sm text-muted-foreground">
            {copy.pagination.pageOf(data.page, data.pageCount)}
          </p>

          {data.page < data.pageCount ? (
            <Link
              href={catalogueHref(data.filters, data.page + 1)}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-11",
              )}
              rel="next"
            >
              {copy.pagination.next}
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "min-h-11 opacity-50",
              )}
            >
              {copy.pagination.next}
            </span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
