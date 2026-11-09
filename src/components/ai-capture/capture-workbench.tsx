"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Info,
  LoaderCircle,
  Search,
  ShoppingCart,
  Sparkles,
} from "lucide-react";
import { useActionState, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  INITIAL_CAPTURE_ACTION_STATE,
  MAX_CAPTURE_TEXT_LENGTH,
  type CaptureSearchResult,
} from "@/lib/ai-capture/action-types";
import { MAX_ALIAS_PHRASE_LENGTH } from "@/lib/ai-capture/alias";
import {
  confirmCaptureAction,
  parseCaptureTextAction,
  searchCaptureProductsAction,
} from "@/lib/ai-capture/actions";
import { parseCasePackSize } from "@/lib/ai-capture/quantity";
import type { CaptureLine } from "@/lib/ai-capture/types";
import { MAX_LINE_QUANTITY } from "@/lib/cart/cookie";
import { cn } from "@/lib/utils";

type ProductOption = {
  sku: string;
  name: string;
  brand: string | null;
  unitLabel: string;
  availableCases: number | null;
  hasRetailerPrice: boolean;
};

type SearchProduct = ProductOption;

type ReviewRow = {
  line: CaptureLine;
  include: boolean;
  selectedSku: string;
  quantity: number | null;
  customProduct: ProductOption | null;
  searchOpen: boolean;
  searchQuery: string;
  searchPending: boolean;
  searchResults: SearchProduct[];
  searchError: string | null;
};

const EXAMPLE =
  "bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti 250 wala 1 peti";

function toOption(
  product: Pick<
    ProductOption,
    | "sku"
    | "name"
    | "brand"
    | "unitLabel"
    | "availableCases"
    | "hasRetailerPrice"
  >,
): ProductOption {
  return {
    sku: product.sku,
    name: product.name,
    brand: product.brand,
    unitLabel: product.unitLabel,
    availableCases: product.availableCases,
    hasRetailerPrice: product.hasRetailerPrice,
  };
}

function productOptions(row: ReviewRow): ProductOption[] {
  const options = new Map<string, ProductOption>();

  for (const candidate of [row.line.candidate, ...row.line.alternatives]) {
    if (candidate) {
      options.set(candidate.sku, toOption(candidate));
    }
  }

  if (row.customProduct) {
    options.set(row.customProduct.sku, row.customProduct);
  }

  return [...options.values()];
}

function quantityForSelection(
  line: CaptureLine,
  product: ProductOption | null,
): number | null {
  if (!product || line.quantity === null) {
    return line.proposedCaseQuantity;
  }

  if (line.unitKind === "CASE") {
    return Number.isSafeInteger(line.quantity)
      ? line.quantity
      : line.proposedCaseQuantity;
  }

  if (line.unitKind === "PIECE") {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      return null;
    }

    const packSize = parseCasePackSize(product.unitLabel);

    if (!packSize || line.quantity % packSize !== 0) {
      return null;
    }

    const cases = line.quantity / packSize;
    return cases <= MAX_LINE_QUANTITY ? cases : null;
  }

  return line.proposedCaseQuantity;
}

function pieceConversionNote(
  line: CaptureLine,
  product: ProductOption | null,
  quantity: number | null,
): string | null {
  if (
    line.unitKind !== "PIECE" ||
    line.quantity === null ||
    quantity === null ||
    !product
  ) {
    return null;
  }

  const packSize = parseCasePackSize(product.unitLabel);

  if (!packSize || line.quantity <= 0 || line.quantity % packSize !== 0) {
    return null;
  }

  const cases = line.quantity / packSize;

  if (cases !== quantity) {
    return null;
  }

  return `${line.quantity} pieces = ${cases} ${cases === 1 ? "case" : "cases"}`;
}

function makeRows(lines: readonly CaptureLine[]): ReviewRow[] {
  return lines.map((line) => {
    const defaultProduct = line.candidate ? toOption(line.candidate) : null;

    return {
      line,
      include: false,
      selectedSku: defaultProduct?.sku ?? "",
      quantity: quantityForSelection(line, defaultProduct),
      customProduct: null,
      searchOpen: false,
      searchQuery: "",
      searchPending: false,
      searchResults: [],
      searchError: null,
    };
  });
}

function selectedOption(row: ReviewRow): ProductOption | null {
  return (
    productOptions(row).find((option) => option.sku === row.selectedSku) ?? null
  );
}

function supportsCaseEntry(line: CaptureLine): boolean {
  return line.unitKind === "CASE" || line.unitKind === "PIECE";
}

function rowProblem(row: ReviewRow): string | null {
  const { line } = row;

  if (line.description.length > MAX_ALIAS_PHRASE_LENGTH) {
    return "The captured description is too long to save as a shorthand. Add this line from the catalogue instead.";
  }

  if (!supportsCaseEntry(line)) {
    return line.unitKind === "UNKNOWN"
      ? "No case unit was captured. Add this line from the catalogue so the case quantity is explicit."
      : "This is not a case quantity. Add the exact case count from the catalogue; it will not be guessed.";
  }

  const option = selectedOption(row);

  if (!option) {
    return "Choose a product before confirming this line.";
  }

  if (!option.hasRetailerPrice) {
    return "This product has no retailer price and cannot be added.";
  }

  if (option.availableCases === null) {
    return "Stock is unavailable for this product.";
  }

  if (option.availableCases <= 0) {
    return "This product is out of stock.";
  }

  if (row.quantity === null || !Number.isSafeInteger(row.quantity)) {
    return "Enter a whole case quantity.";
  }

  if (row.quantity < 1 || row.quantity > MAX_LINE_QUANTITY) {
    return `Case quantity must be between 1 and ${MAX_LINE_QUANTITY}.`;
  }

  if (row.quantity > option.availableCases) {
    return `Only ${option.availableCases} ${option.availableCases === 1 ? "case is" : "cases are"} available.`;
  }

  return null;
}

function statusLabel(row: ReviewRow): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
} {
  if (!selectedOption(row)) {
    return { label: "Choose a product", variant: "outline" };
  }

  const problem = rowProblem(row);

  if (problem) {
    return { label: "Needs attention", variant: "destructive" };
  }

  if (row.include) {
    return { label: "Confirmed", variant: "default" };
  }

  return { label: "Ready to confirm", variant: "secondary" };
}

function parserNote(line: CaptureLine): string | null {
  switch (line.clarificationCode) {
    case "UNIT_MISSING":
      return "The text did not include a case unit such as peti. No case quantity was assumed.";
    case "PIECE_NOT_CASE_MULTIPLE":
      return "The piece count is not an exact case multiple. It was not rounded.";
    case "CASE_PACK_UNKNOWN":
      return "The case pack size is not labelled explicitly, so pieces were not converted.";
    case "WEIGHT_NOT_CASE":
      return "A weight or volume is not a case quantity. No conversion was guessed.";
    case "WHOLE_CASES_ONLY":
      return "Only whole cases can be ordered. Enter the exact case count yourself.";
    case "PRODUCT_NOT_FOUND":
      return "No catalogue match was found. Search below to correct it.";
    case "PRODUCT_AMBIGUOUS":
      return "The match was ambiguous. Choose the correct product below.";
    case "QUANTITY_MISSING":
      return "No quantity was captured. Enter the exact case count yourself.";
    case "QUANTITY_OUT_OF_RANGE":
      return "The captured quantity is outside the allowed range. Enter the exact case count.";
    case "PRICE_UNAVAILABLE":
      return "The matched product has no retailer price.";
    default:
      return null;
  }
}

const ISSUE_LABELS: Record<string, string> = {
  PRODUCT_UNAVAILABLE: "Product unavailable",
  PRICE_UNAVAILABLE: "Price unavailable",
  STOCK_UNAVAILABLE: "Stock unavailable",
  OUT_OF_STOCK: "Out of stock",
  INSUFFICIENT_STOCK: "Insufficient stock",
  QUANTITY_LIMIT: "Case limit exceeded",
  CART_FULL: "Cart is full",
};

function ReviewLine({
  row,
  onChange,
  onSearch,
}: {
  row: ReviewRow;
  onChange: (next: ReviewRow) => void;
  onSearch: () => void;
}) {
  const { line } = row;
  const options = productOptions(row);
  const option = selectedOption(row);
  const problem = rowProblem(row);
  const status = statusLabel(row);
  const note = parserNote(line);
  const canEditQuantity = supportsCaseEntry(line);
  const conversion = pieceConversionNote(line, option, row.quantity);
  const manualPieceEntry =
    line.unitKind === "PIECE" &&
    line.quantity !== null &&
    row.quantity !== null &&
    conversion === null;

  return (
    <Card
      size="sm"
      className={cn(
        "border-border/80",
        row.include && "border-primary/40 bg-primary/[0.03]",
      )}
    >
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span>{line.description || line.originalText}</span>
              <Badge variant={status.variant}>{status.label}</Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              Captured as{" "}
              <span className="font-mono text-foreground">
                {line.originalText}
              </span>
            </CardDescription>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-input px-3 text-sm font-medium has-disabled:cursor-not-allowed has-disabled:opacity-60">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={row.include}
              disabled={Boolean(problem)}
              onChange={(event) =>
                onChange({ ...row, include: event.target.checked })
              }
            />
            Confirm line
          </label>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_14rem] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor={`product-${line.id}`}>Product</Label>
            <Select
              id={`product-${line.id}`}
              value={row.selectedSku}
              onChange={(event) => {
                const nextSku = event.target.value;
                const nextProduct =
                  options.find((item) => item.sku === nextSku) ?? null;

                onChange({
                  ...row,
                  selectedSku: nextSku,
                  quantity: quantityForSelection(line, nextProduct),
                  include: false,
                });
              }}
            >
              <option value="">Choose a product</option>
              {options.map((product) => (
                <option key={product.sku} value={product.sku}>
                  {product.name} — {product.unitLabel}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`quantity-${line.id}`}>Cases</Label>
            <Input
              id={`quantity-${line.id}`}
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_LINE_QUANTITY}
              step={1}
              value={row.quantity ?? ""}
              readOnly={!canEditQuantity}
              disabled={!supportsCaseEntry(line)}
              onChange={(event) => {
                const next = event.target.value;
                onChange({
                  ...row,
                  quantity: next === "" ? null : Number(next),
                  include: false,
                });
              }}
            />
          </div>
          <div className="space-y-1.5 text-sm">
            <span className="font-medium">Availability</span>
            <p className="min-h-11 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-muted-foreground">
              {option
                ? option.availableCases === null
                  ? "Stock unavailable"
                  : `${option.availableCases} ${option.availableCases === 1 ? "case" : "cases"} available`
                : "No product selected"}
            </p>
          </div>
        </div>

        {option ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{option.sku}</span>
            {option.brand ? <span>{option.brand}</span> : null}
            <span>{option.unitLabel}</span>
            {conversion ? <span>{conversion}</span> : null}
            {manualPieceEntry ? (
              <span>
                Case count entered explicitly; the piece count was not
                converted automatically.
              </span>
            ) : null}
          </div>
        ) : null}

        {note ? (
          <p className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0"
            />
            {note}
          </p>
        ) : null}

        {problem ? (
          <p className="text-xs font-medium text-destructive">{problem}</p>
        ) : null}

        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10"
            onClick={() =>
              onChange({ ...row, searchOpen: !row.searchOpen })
            }
          >
            <Search aria-hidden="true" data-icon="inline-start" />
            {row.searchOpen ? "Close catalogue search" : "Search catalogue"}
          </Button>

          {row.searchOpen ? (
            <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor={`search-${line.id}`}>
                    Search by product name
                  </Label>
                  <Input
                    id={`search-${line.id}`}
                    value={row.searchQuery}
                    placeholder="e.g. glucose biscuit"
                    onChange={(event) =>
                      onChange({ ...row, searchQuery: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onSearch();
                      }
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-11"
                  disabled={row.searchPending}
                  onClick={onSearch}
                >
                  {row.searchPending ? (
                    <LoaderCircle
                      aria-hidden="true"
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <Search aria-hidden="true" data-icon="inline-start" />
                  )}
                  Search
                </Button>
              </div>

              {row.searchError ? (
                <p className="text-xs text-destructive">{row.searchError}</p>
              ) : null}

              {row.searchResults.length > 0 ? (
                <ul className="space-y-2">
                  {row.searchResults.map((product) => {
                    const disabled =
                      !product.hasRetailerPrice ||
                      product.availableCases === null ||
                      product.availableCases <= 0;

                    return (
                      <li key={product.sku}>
                        <button
                          type="button"
                          disabled={disabled}
                          className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => {
                            onChange({
                              ...row,
                              selectedSku: product.sku,
                              customProduct: product,
                              quantity: quantityForSelection(line, product),
                              include: false,
                              searchOpen: false,
                              searchResults: [],
                              searchError: null,
                            });
                          }}
                        >
                          <span>
                            <span className="font-medium">{product.name}</span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {product.unitLabel}
                            </span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {!product.hasRetailerPrice
                              ? "No price"
                              : product.availableCases === null
                                ? "Stock unavailable"
                                : product.availableCases <= 0
                                  ? "Out of stock"
                                  : `${product.availableCases} cases`}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {!row.searchPending &&
              row.searchQuery.trim().length >= 2 &&
              row.searchResults.length === 0 &&
              !row.searchError ? (
                <p className="text-xs text-muted-foreground">
                  No matching products yet. Run a search to check the
                  retailer&apos;s catalogue.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function CaptureReview({ lines }: { lines: readonly CaptureLine[] }) {
  const [rows, setRows] = useState<ReviewRow[]>(() => makeRows(lines));
  const [confirmState, confirmFormAction, confirming] = useActionState(
    confirmCaptureAction,
    INITIAL_CAPTURE_ACTION_STATE,
  );

  const includedRows = rows.filter(
    (row) =>
      row.include &&
      row.selectedSku.length > 0 &&
      row.quantity !== null &&
      Number.isSafeInteger(row.quantity) &&
      rowProblem(row) === null,
  );
  const payload = JSON.stringify({
    lines: includedRows.map((row) => ({
      phrase: row.line.description,
      selectedSku: row.selectedSku,
      quantity: row.quantity,
      confirmed: true,
    })),
  });
  const totalCases = includedRows.reduce(
    (total, row) => total + (row.quantity ?? 0),
    0,
  );

  function updateRow(index: number, next: ReviewRow) {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? next : row)),
    );
  }

  function patchRow(index: number, patch: Partial<ReviewRow>) {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  }

  async function searchRow(index: number) {
    const query = rows[index]?.searchQuery.trim() ?? "";

    if (query.length < 2) {
      patchRow(index, { searchError: "Enter at least two characters." });
      return;
    }

    patchRow(index, { searchPending: true, searchError: null });

    let result: CaptureSearchResult;

    try {
      result = await searchCaptureProductsAction(query);
    } catch {
      patchRow(index, {
        searchPending: false,
        searchResults: [],
        searchError: "Catalogue search failed. Try again.",
      });
      return;
    }

    if (!result.ok) {
      patchRow(index, {
        searchPending: false,
        searchResults: [],
        searchError: result.message,
      });
      return;
    }

    patchRow(index, {
      searchPending: false,
      searchResults: result.products,
      searchError: null,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <div>
          <p className="text-sm font-medium">
            {rows.length} captured {rows.length === 1 ? "line" : "lines"}
          </p>
          <p className="text-xs text-muted-foreground">
            Nothing is added until you confirm each line. The cart is not
            submitted automatically.
          </p>
        </div>
        <Badge variant="outline" className="h-7 px-3">
          <CheckCircle2 aria-hidden="true" className="size-3.5" />
          {includedRows.length} confirmed
        </Badge>
      </div>

      <div className="space-y-3">
        {rows.map((row, index) => (
          <ReviewLine
            key={row.line.id}
            row={row}
            onChange={(next) => updateRow(index, next)}
            onSearch={() => void searchRow(index)}
          />
        ))}
      </div>

      <form action={confirmFormAction} className="space-y-3">
        <input type="hidden" name="payload" value={payload} />
        {confirmState.status === "error" ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <p className="font-medium">{confirmState.message}</p>
            {confirmState.issues && confirmState.issues.length > 0 ? (
              <ul className="mt-1 list-inside list-disc text-xs">
                {confirmState.issues.map((issue) => (
                  <li key={`${issue.sku}-${issue.code}`}>
                    {issue.sku}: {ISSUE_LABELS[issue.code] ?? issue.code}
                    {issue.availableCases !== undefined
                      ? ` (${issue.availableCases} available)`
                      : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {includedRows.length > 0
              ? `${totalCases} ${totalCases === 1 ? "case" : "cases"} selected. The cart will show trusted prices, schemes, stock and GST before checkout.`
              : "Tick “Confirm line” for each line you want to add."}
          </p>
          <Button
            type="submit"
            className="min-h-11"
            disabled={confirming || includedRows.length === 0}
          >
            {confirming ? (
              <LoaderCircle
                aria-hidden="true"
                data-icon="inline-start"
                className="animate-spin"
              />
            ) : (
              <ShoppingCart aria-hidden="true" data-icon="inline-start" />
            )}
            Add confirmed lines to cart
          </Button>
        </div>
      </form>
    </div>
  );
}

export function CaptureWorkbench() {
  const [text, setText] = useState("");
  const [state, formAction, pending] = useActionState(
    parseCaptureTextAction,
    INITIAL_CAPTURE_ACTION_STATE,
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles aria-hidden="true" className="size-4 text-primary" />
            Describe the order
          </CardTitle>
          <CardDescription>
            Hindi, Hinglish and English text are supported. The deterministic
            matcher uses this retailer&apos;s catalogue, aliases and order
            history. No external AI service receives the text.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="capture-text">Order text</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setText(EXAMPLE)}
                >
                  Use the example
                </Button>
              </div>
              <textarea
                id="capture-text"
                name="text"
                rows={5}
                maxLength={MAX_CAPTURE_TEXT_LENGTH}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="e.g. bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo"
                className="min-h-32 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-base shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {text.length}/{MAX_CAPTURE_TEXT_LENGTH} characters. Raw order
                text is not saved.
              </p>
            </div>

            {state.status === "error" && state.code !== "NO_CONFIRMED_LINES" ? (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                {state.message}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Every captured line must be reviewed and confirmed. Cases and
                pieces are never converted silently.
              </p>
              <Button
                type="submit"
                className="min-h-11"
                disabled={pending || text.trim().length === 0}
              >
                {pending ? (
                  <LoaderCircle
                    aria-hidden="true"
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                ) : (
                  <Sparkles aria-hidden="true" data-icon="inline-start" />
                )}
                Capture order text
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {state.lines && state.lines.length > 0 ? (
        <section aria-label="Captured line review" className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Check aria-hidden="true" className="size-4 text-primary" />
            Review captured lines
          </div>
          <CaptureReview
            key={state.captureId ?? "captured-lines"}
            lines={state.lines}
          />
        </section>
      ) : null}

      {state.status === "success" && state.lines && state.lines.length > 0 ? (
        <p className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs leading-5 text-muted-foreground">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          After the cart is updated, use the normal cart page to review totals
          and place the order. AI capture never submits an order.
        </p>
      ) : null}
    </div>
  );
}
