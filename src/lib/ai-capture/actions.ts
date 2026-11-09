"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { PERMISSIONS, hasPermission } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import type { CartOwner } from "@/lib/cart/cookie";
import { CartCookieError } from "@/lib/cart/cookie";
import { addCartLine, validateRequestedQuantity } from "@/lib/cart/lines";
import { resolveRetailerCartOwner } from "@/lib/cart/owner";
import { fetchCartProducts } from "@/lib/cart/repository";
import {
  readCartCookieLines,
  writeCartCookieLines,
} from "@/lib/cart/store";
import {
  MAX_CAPTURE_TEXT_LENGTH,
  MAX_CONFIRMATION_PAYLOAD_LENGTH,
  type CaptureActionState,
  type CaptureLineIssue,
  type CaptureSearchResult,
} from "./action-types";
import { parseCaptureConfirmationPayload } from "./confirmation";
import { parseCaptureText } from "./parse";
import { deterministicCaptureProvider } from "./provider";
import {
  applyAliasCorrections,
  loadCaptureContext,
  searchCaptureProducts,
  type AliasCorrection,
} from "./repository";

type CaptureAuthorization =
  | { ok: true; userId: string; owner: CartOwner }
  | { ok: false; state: CaptureActionState };

async function authorizeCapture(): Promise<CaptureAuthorization> {
  const session = await getSession();

  if (!session) {
    return {
      ok: false,
      state: {
        status: "error",
        code: "UNAUTHORIZED",
        message: "Your session has expired. Sign in again.",
      },
    };
  }

  if (!hasPermission(session.user.role, PERMISSIONS.AI_CAPTURE_USE)) {
    return {
      ok: false,
      state: {
        status: "error",
        code: "FORBIDDEN",
        message: "This account cannot capture retailer orders.",
      },
    };
  }

  const owner = resolveRetailerCartOwner(session.user);

  if (!owner) {
    return {
      ok: false,
      state: {
        status: "error",
        code: "FORBIDDEN",
        message: "Only a retailer account can capture orders.",
      },
    };
  }

  return { ok: true, userId: session.user.id, owner };
}

function failure(
  code: CaptureActionState["code"],
  message: string,
  extra: Partial<CaptureActionState> = {},
): CaptureActionState {
  return { status: "error", code, message, ...extra };
}

function issueMessage(issues: readonly CaptureLineIssue[]): string {
  const first = issues[0];

  switch (first?.code) {
    case "PRODUCT_UNAVAILABLE":
      return "One selected product is no longer available. Search for a replacement.";
    case "PRICE_UNAVAILABLE":
      return "One selected product has no retailer price. It cannot be added.";
    case "STOCK_UNAVAILABLE":
      return "Stock is unavailable for one selected product.";
    case "OUT_OF_STOCK":
      return "One selected product is out of stock.";
    case "INSUFFICIENT_STOCK":
      return "One selected line exceeds the available stock.";
    case "QUANTITY_LIMIT":
      return "Adding this line would exceed the 999-case limit.";
    case "CART_FULL":
      return "The cart already has the maximum number of lines.";
    default:
      return "The confirmed lines could not be added to the cart.";
  }
}

/**
 * Parses free-form order text with the deterministic provider. It never writes
 * the cart, an alias, or an order; the retailer must review and explicitly
 * confirm each line first.
 */
export async function parseCaptureTextAction(
  _previousState: CaptureActionState,
  formData: FormData,
): Promise<CaptureActionState> {
  const authorization = await authorizeCapture();

  if (!authorization.ok) {
    return authorization.state;
  }

  const text = String(formData.get("text") ?? "").trim();

  if (!text) {
    return failure("TEXT_REQUIRED", "Describe the order before capturing it.");
  }

  if (text.length > MAX_CAPTURE_TEXT_LENGTH) {
    return failure(
      "TEXT_TOO_LONG",
      `Keep the order text to ${MAX_CAPTURE_TEXT_LENGTH} characters or fewer.`,
      { text },
    );
  }

  try {
    const context = await loadCaptureContext(authorization.owner.retailerId);
    const result = await deterministicCaptureProvider.extract({
      text,
      products: context.products,
      aliases: context.aliases,
      history: context.history,
    });

    if (result.lines.length === 0) {
      return failure(
        "NO_LINES",
        "No order lines could be read. Add a product and quantity.",
        { text },
      );
    }

    return {
      status: "success",
      code: "PARSED",
      message: `${result.lines.length} ${result.lines.length === 1 ? "line" : "lines"} captured. Review every line before adding it to the cart.`,
      text,
      captureId: randomUUID(),
      lines: result.lines,
    };
  } catch {
    return failure(
      "UNKNOWN",
      "The order text could not be captured right now. Try again.",
      { text },
    );
  }
}

/**
 * Validates every selected line against the authenticated retailer's live
 * catalogue, then adds explicit case quantities to the existing cart. Alias
 * corrections and their audit events are committed together before the cart
 * cookie is written. The order itself is never submitted here; the retailer
 * lands on the normal cart/checkout review.
 */
export async function confirmCaptureAction(
  _previousState: CaptureActionState,
  formData: FormData,
): Promise<CaptureActionState> {
  const authorization = await authorizeCapture();

  if (!authorization.ok) {
    return authorization.state;
  }

  const rawPayload = String(formData.get("payload") ?? "");

  if (!rawPayload || rawPayload.length > MAX_CONFIRMATION_PAYLOAD_LENGTH) {
    return failure(
      "INVALID_CONFIRMATION",
      "The confirmed lines could not be read. Review them again.",
    );
  }

  let decoded: unknown;

  try {
    decoded = JSON.parse(rawPayload);
  } catch {
    return failure(
      "INVALID_CONFIRMATION",
      "The confirmed lines could not be read. Review them again.",
    );
  }

  const confirmation = parseCaptureConfirmationPayload(decoded);

  if (!confirmation.ok) {
    return failure("INVALID_CONFIRMATION", confirmation.error);
  }

  if (confirmation.lines.length === 0) {
    return failure(
      "NO_CONFIRMED_LINES",
      "Select and confirm at least one line before adding it to the cart.",
    );
  }

  let nextLines: Awaited<ReturnType<typeof readCartCookieLines>>;

  try {
    const existingLines = await readCartCookieLines(authorization.owner);
    let workingLines = [...existingLines];
    const issues: CaptureLineIssue[] = [];

    for (const line of confirmation.lines) {
      const result = addCartLine(workingLines, {
        sku: line.selectedSku,
        quantity: line.quantity,
      });

      if (!result.ok) {
        if (result.code === "INVALID_SKU") {
          return failure(
            "INVALID_CONFIRMATION",
            "One confirmed product identifier is invalid.",
          );
        }

        if (result.code === "INVALID_QUANTITY") {
          return failure(
            "INVALID_CONFIRMATION",
            "Confirmed case quantities must be whole numbers from 1 to 999.",
          );
        }

        issues.push({
          sku: line.selectedSku,
          code: result.code,
        });
        break;
      }

      workingLines = result.lines;
    }

    if (issues.length > 0) {
      return failure(issues[0].code, issueMessage(issues), { issues });
    }

    const selectedSkus = [
      ...new Set(confirmation.lines.map((line) => line.selectedSku)),
    ];
    const products = await fetchCartProducts(
      authorization.owner.retailerId,
      selectedSkus,
    );
    const productsBySku = new Map(
      products.map((product) => [product.sku, product]),
    );

    for (const sku of selectedSkus) {
      const product = productsBySku.get(sku);

      if (!product) {
        issues.push({ sku, code: "PRODUCT_UNAVAILABLE" });
        continue;
      }

      if (product.unitPricePaise === null) {
        issues.push({ sku, code: "PRICE_UNAVAILABLE" });
        continue;
      }

      const mergedQuantity =
        workingLines.find((line) => line.sku === sku)?.quantity ?? 0;
      const stockCheck = validateRequestedQuantity(
        mergedQuantity,
        product.stock.availableCases,
      );

      if (!stockCheck.ok) {
        if (stockCheck.code === "INVALID_QUANTITY") {
          return failure(
            "INVALID_CONFIRMATION",
            "Confirmed case quantities must be whole numbers from 1 to 999.",
          );
        }

        issues.push({
          sku,
          code: stockCheck.code,
          availableCases: stockCheck.availableCases,
        });
      }
    }

    if (issues.length > 0) {
      return failure(issues[0].code, issueMessage(issues), { issues });
    }

    const context = await loadCaptureContext(authorization.owner.retailerId);
    const corrections: AliasCorrection[] = [];

    for (const line of confirmation.lines) {
      const parsed = parseCaptureText({
        text: line.phrase,
        products: context.products,
        aliases: context.aliases,
        history: context.history,
      });
      const parsedSku = parsed.lines[0]?.candidate?.sku ?? null;

      if (parsedSku !== line.selectedSku) {
        corrections.push({
          phrase: line.phrase,
          parsedSku,
          selectedSku: line.selectedSku,
        });
      }
    }

    if (corrections.length > 0) {
      try {
        await applyAliasCorrections({
          actorId: authorization.userId,
          retailerId: authorization.owner.retailerId,
          corrections,
        });
      } catch {
        return failure(
          "ALIAS_SAVE_FAILED",
          "The confirmed corrections could not be saved. No cart lines were added.",
        );
      }
    }

    nextLines = workingLines;
  } catch {
    return failure(
      "UNKNOWN",
      "The confirmed lines could not be added to the cart. Try again.",
    );
  }

  try {
    await writeCartCookieLines(authorization.owner, nextLines, "AI_TEXT");
  } catch (error) {
    if (error instanceof CartCookieError) {
      return failure(
        "COOKIE_TOO_LARGE",
        "The resulting cart is too large for this browser. Remove a line and try again.",
      );
    }

    return failure(
      "UNKNOWN",
      "The cart could not be saved. Try again.",
    );
  }

  revalidatePath("/", "layout");
  revalidatePath("/cart");
  revalidatePath("/ai-capture");
  redirect("/cart?captured=1");
}

/**
 * Bounded catalogue search used only for correcting a captured product. It
 * returns names and stock availability, never prices or the full catalogue.
 */
export async function searchCaptureProductsAction(
  query: unknown,
): Promise<CaptureSearchResult> {
  const authorization = await authorizeCapture();

  if (!authorization.ok) {
    return {
      ok: false,
      message: authorization.state.message ?? "Search is unavailable.",
    };
  }

  if (typeof query !== "string") {
    return { ok: false, message: "Enter a product name to search." };
  }

  const term = query.trim();

  if (term.length < 2) {
    return { ok: true, products: [] };
  }

  if (term.length > 80) {
    return { ok: false, message: "Keep the search term to 80 characters." };
  }

  try {
    return {
      ok: true,
      products: await searchCaptureProducts(
        authorization.owner.retailerId,
        term,
      ),
    };
  } catch {
    return {
      ok: false,
      message: "Catalogue search is unavailable right now.",
    };
  }
}
