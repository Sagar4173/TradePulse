import { MAX_LINE_QUANTITY } from "../cart/cookie";
import { normalizeAliasPhrase, normalizeText } from "./normalize";
import {
  parseCasePackSize,
  parsePackSizeHint,
} from "./quantity";
import { segmentCaptureText } from "./segment";
import type {
  CaptureLine,
  CaptureLineStatus,
  CaptureParseInput,
  CaptureParseResult,
  CaptureClarificationCode,
  CaptureConfidenceBand,
  MatchAlias,
  MatchHistoryEntry,
  MatchProduct,
  RankedCandidate,
  RawCaptureLine,
} from "./types";

/**
 * Deterministic order-text matcher.
 *
 * This module deliberately does not call an AI provider. It compares the
 * retailer's normalised words with the retailer's own catalogue rows, applying
 * a small alias table and order-history tie-break. Commercial values are not
 * loaded here; a confirmed line still goes through the existing trusted cart
 * and checkout calculation.
 */

const MIN_CANDIDATE_SCORE = 0.45;
const MIN_ALTERNATIVE_SCORE = 0.35;
const MAX_PIECE_QUANTITY = 100_000;

const QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "aur",
  "bhai",
  "bhaiya",
  "chahiye",
  "dena",
  "dijiye",
  "for",
  "hai",
  "he",
  "ji",
  "ka",
  "ke",
  "ki",
  "ko",
  "kripya",
  "me",
  "mein",
  "mujhe",
  "of",
  "order",
  "please",
  "plus",
  "se",
  "the",
  "to",
  "wala",
  "wali",
  "wale",
]);

type ProductPack = {
  number: number;
  unit: string | null;
  baseValue: number | null;
  baseUnit: "g" | "ml" | null;
};

type IndexedProduct = {
  product: MatchProduct;
  nameTokens: Set<string>;
  descriptionTokens: Set<string>;
  brandTokens: Set<string>;
  categoryTokens: Set<string>;
  pack: ProductPack | null;
};

type ScoredProduct = {
  indexed: IndexedProduct;
  score: number;
};

function clampScore(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function roundScore(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function stemToken(token: string): string {
  if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }

  return token;
}

function tokenizeForMatching(value: string): string[] {
  return normalizeText(value)
    .replace(/[^a-z0-9.]+/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter((token) => token.length > 0)
    .map(stemToken)
    .filter(
      (token) =>
        !QUERY_STOP_WORDS.has(token) && !/^\d+(?:\.\d+)?$/.test(token),
    );
}

function addTokens(target: Set<string>, value: string | null): void {
  if (!value) {
    return;
  }

  for (const token of tokenizeForMatching(value)) {
    target.add(token);
  }
}

function parsePackMeasure(hint: string | null): ProductPack | null {
  if (!hint) {
    return null;
  }

  const match = /^(\d+(?:\.\d+)?)\s*([a-z]+)?$/i.exec(hint.trim());

  if (!match) {
    return null;
  }

  const number = Number(match[1]);
  const unit = match[2]?.toLowerCase() ?? null;

  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  if (unit === "kg") {
    return { number, unit, baseValue: number * 1_000, baseUnit: "g" };
  }

  if (unit === "g") {
    return { number, unit, baseValue: number, baseUnit: "g" };
  }

  if (unit === "l") {
    return { number, unit, baseValue: number * 1_000, baseUnit: "ml" };
  }

  if (unit === "ml") {
    return { number, unit, baseValue: number, baseUnit: "ml" };
  }

  return { number, unit, baseValue: null, baseUnit: null };
}

function indexProduct(product: MatchProduct): IndexedProduct {
  const nameTokens = new Set<string>();
  const descriptionTokens = new Set<string>();
  const brandTokens = new Set<string>();
  const categoryTokens = new Set<string>();

  addTokens(nameTokens, product.name);
  addTokens(descriptionTokens, product.description);
  addTokens(brandTokens, product.brand);
  addTokens(categoryTokens, product.category);

  return {
    product,
    nameTokens,
    descriptionTokens,
    brandTokens,
    categoryTokens,
    pack: parsePackMeasure(parsePackSizeHint(product.name)),
  };
}

function tokenSimilarity(query: string, candidate: string): number {
  if (query === candidate) {
    return 1;
  }

  if (query.length >= 4 && candidate.startsWith(query)) {
    return 0.82;
  }

  if (candidate.length >= 4 && query.startsWith(candidate)) {
    return 0.78;
  }

  return 0;
}

function bestSetSimilarity(
  query: string,
  candidates: ReadonlySet<string>,
): number {
  let best = 0;

  for (const candidate of candidates) {
    best = Math.max(best, tokenSimilarity(query, candidate));
  }

  return best;
}

function scoreProduct(
  queryTokens: readonly string[],
  indexed: IndexedProduct,
  queryPack: ProductPack | null,
  history: ReadonlyMap<string, MatchHistoryEntry>,
): number {
  if (queryTokens.length === 0) {
    return 0;
  }

  let weightedHits = 0;
  let nameHits = 0;

  for (const token of queryTokens) {
    const name = bestSetSimilarity(token, indexed.nameTokens);
    const description = bestSetSimilarity(token, indexed.descriptionTokens);
    const brand = bestSetSimilarity(token, indexed.brandTokens);
    const category = bestSetSimilarity(token, indexed.categoryTokens);

    weightedHits += Math.max(
      name,
      description * 0.85,
      brand * 0.72,
      category * 0.65,
    );

    if (name >= 0.8) {
      nameHits += 1;
    }
  }

  const coverage = weightedHits / queryTokens.length;
  const nameCoverage = nameHits / queryTokens.length;
  let score = coverage + nameCoverage * 0.08;

  if (queryPack && indexed.pack) {
    const exactNumber =
      queryPack.number === indexed.pack.number &&
      (queryPack.unit === null ||
        indexed.pack.unit === null ||
        queryPack.unit === indexed.pack.unit);

    const exactMeasure =
      queryPack.baseValue !== null &&
      indexed.pack.baseValue !== null &&
      queryPack.baseUnit === indexed.pack.baseUnit &&
      queryPack.baseValue === indexed.pack.baseValue;

    if (exactNumber || exactMeasure) {
      score += 0.25;
    } else {
      score -= 0.2;
    }
  }

  const historyEntry = history.get(indexed.product.sku);

  if (historyEntry) {
    score +=
      Math.min(0.05, Math.log1p(Math.max(0, historyEntry.orderCount)) * 0.02) +
      Math.min(
        0.03,
        Math.log1p(Math.max(0, historyEntry.totalQuantity)) * 0.01,
      );
  }

  return clampScore(score);
}

function toCandidate(
  indexed: IndexedProduct,
  score: number,
): RankedCandidate {
  return {
    sku: indexed.product.sku,
    name: indexed.product.name,
    brand: indexed.product.brand,
    category: indexed.product.category,
    unitLabel: indexed.product.unitLabel,
    availableCases: indexed.product.availableCases,
    hasRetailerPrice: indexed.product.hasRetailerPrice,
    score: roundScore(score),
  };
}

function confidenceBand(score: number): CaptureConfidenceBand {
  if (score >= 0.8) {
    return "HIGH";
  }

  if (score >= 0.55) {
    return "MEDIUM";
  }

  return "LOW";
}

function aliasForDescription(
  description: string,
  aliases: readonly MatchAlias[],
): MatchAlias | null {
  const phrase = normalizeAliasPhrase(description);
  let best: MatchAlias | null = null;

  if (!phrase) {
    return null;
  }

  for (const alias of aliases) {
    if (normalizeAliasPhrase(alias.normalizedPhrase) !== phrase) {
      continue;
    }

    if (
      !best ||
      alias.confirmationCount > best.confirmationCount ||
      (alias.confirmationCount === best.confirmationCount &&
        alias.productSku.localeCompare(best.productSku) < 0)
    ) {
      best = alias;
    }
  }

  return best;
}

function rankProducts(
  rawLine: RawCaptureLine,
  products: readonly IndexedProduct[],
  aliases: readonly MatchAlias[],
  history: ReadonlyMap<string, MatchHistoryEntry>,
): { ranked: ScoredProduct[]; alias: MatchAlias | null } {
  const alias = aliasForDescription(rawLine.description, aliases);
  const aliasProduct = alias
    ? products.find((item) => item.product.sku === alias.productSku)
    : undefined;

  if (aliasProduct) {
    return {
      ranked: [{ indexed: aliasProduct, score: 1 }],
      alias,
    };
  }

  const queryPack = parsePackMeasure(parsePackSizeHint(rawLine.description));
  const queryTokens = tokenizeForMatching(rawLine.description);

  const ranked = products
    .map((indexed) => ({
      indexed,
      score: scoreProduct(queryTokens, indexed, queryPack, history),
    }))
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.indexed.product.sku.localeCompare(right.indexed.product.sku),
    );

  return { ranked, alias: null };
}

function unitClarification(
  rawLine: RawCaptureLine,
  casePackSize: number | null,
): {
  status: CaptureLineStatus;
  clarificationCode: CaptureClarificationCode | null;
  proposedCaseQuantity: number | null;
  conversionNote: string | null;
} | null {
  const { quantity, unitKind } = rawLine;

  if (quantity === null) {
    return {
      status: "NEEDS_UNIT_CLARIFICATION",
      clarificationCode: "QUANTITY_MISSING",
      proposedCaseQuantity: null,
      conversionNote: null,
    };
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      status: "NEEDS_UNIT_CLARIFICATION",
      clarificationCode: "QUANTITY_OUT_OF_RANGE",
      proposedCaseQuantity: null,
      conversionNote: null,
    };
  }

  if (unitKind === "UNKNOWN") {
    return {
      status: "NEEDS_UNIT_CLARIFICATION",
      clarificationCode: "UNIT_MISSING",
      proposedCaseQuantity: null,
      conversionNote: null,
    };
  }

  if (unitKind === "WEIGHT" || unitKind === "VOLUME") {
    return {
      status: "NEEDS_UNIT_CLARIFICATION",
      clarificationCode: "WEIGHT_NOT_CASE",
      proposedCaseQuantity: null,
      conversionNote: null,
    };
  }

  if (unitKind === "CASE") {
    if (!Number.isSafeInteger(quantity)) {
      return {
        status: "NEEDS_UNIT_CLARIFICATION",
        clarificationCode: "WHOLE_CASES_ONLY",
        proposedCaseQuantity: null,
        conversionNote: null,
      };
    }

    if (quantity > MAX_LINE_QUANTITY) {
      return {
        status: "NEEDS_UNIT_CLARIFICATION",
        clarificationCode: "QUANTITY_OUT_OF_RANGE",
        proposedCaseQuantity: null,
        conversionNote: null,
      };
    }

    return {
      status: "READY",
      clarificationCode: null,
      proposedCaseQuantity: quantity,
      conversionNote: null,
    };
  }

  if (!Number.isSafeInteger(quantity)) {
    return {
      status: "NEEDS_UNIT_CLARIFICATION",
      clarificationCode: "WHOLE_CASES_ONLY",
      proposedCaseQuantity: null,
      conversionNote: null,
    };
  }

  if (quantity > MAX_PIECE_QUANTITY) {
    return {
      status: "NEEDS_UNIT_CLARIFICATION",
      clarificationCode: "QUANTITY_OUT_OF_RANGE",
      proposedCaseQuantity: null,
      conversionNote: null,
    };
  }

  if (!casePackSize) {
    return {
      status: "NEEDS_UNIT_CLARIFICATION",
      clarificationCode: "CASE_PACK_UNKNOWN",
      proposedCaseQuantity: null,
      conversionNote: null,
    };
  }

  if (quantity % casePackSize !== 0) {
    return {
      status: "NEEDS_UNIT_CLARIFICATION",
      clarificationCode: "PIECE_NOT_CASE_MULTIPLE",
      proposedCaseQuantity: null,
      conversionNote: null,
    };
  }

  const cases = quantity / casePackSize;

  if (cases > MAX_LINE_QUANTITY) {
    return {
      status: "NEEDS_UNIT_CLARIFICATION",
      clarificationCode: "QUANTITY_OUT_OF_RANGE",
      proposedCaseQuantity: null,
      conversionNote: null,
    };
  }

  return {
    status: "READY",
    clarificationCode: null,
    proposedCaseQuantity: cases,
    conversionNote: `${quantity} pieces = ${cases} ${cases === 1 ? "case" : "cases"}`,
  };
}

function buildLine(
  rawLine: RawCaptureLine,
  products: readonly IndexedProduct[],
  aliases: readonly MatchAlias[],
  history: ReadonlyMap<string, MatchHistoryEntry>,
): CaptureLine {
  const { ranked, alias } = rankProducts(rawLine, products, aliases, history);
  const best = ranked[0];

  if (!best || best.score < MIN_CANDIDATE_SCORE) {
    const alternatives = ranked
      .filter((item) => item.score >= MIN_ALTERNATIVE_SCORE)
      .slice(0, 2)
      .map((item) => toCandidate(item.indexed, item.score));

    return {
      ...rawLine,
      candidate: null,
      alternatives,
      productConfidence: best ? roundScore(best.score) : 0,
      confidenceBand: "LOW",
      status: alternatives.length > 0 ? "NEEDS_PRODUCT_CLARIFICATION" : "UNMATCHED",
      clarificationCode:
        alternatives.length > 0 ? "PRODUCT_AMBIGUOUS" : "PRODUCT_NOT_FOUND",
      casePackSize: null,
      proposedCaseQuantity: null,
      conversionNote: null,
      outOfStock: false,
    };
  }

  const candidate = toCandidate(best.indexed, best.score);
  const casePackSize = parseCasePackSize(best.indexed.product.unitLabel);
  const alternatives = ranked
    .slice(1)
    .filter(
      (item) =>
        item.score >= MIN_ALTERNATIVE_SCORE &&
        item.score >= best.score - 0.3,
    )
    .slice(0, 2)
    .map((item) => toCandidate(item.indexed, item.score));

  const unitResult = unitClarification(rawLine, casePackSize);
  const confidence = alias ? 1 : best.score;
  const outOfStock =
    best.indexed.product.availableCases !== null &&
    best.indexed.product.availableCases <= 0;

  let status: CaptureLineStatus = unitResult?.status ?? "READY";
  let clarificationCode = unitResult?.clarificationCode ?? null;

  if (status === "READY" && !best.indexed.product.hasRetailerPrice) {
    status = "PRICE_UNAVAILABLE";
    clarificationCode = "PRICE_UNAVAILABLE";
  }

  if (
    status === "READY" &&
    (best.indexed.product.availableCases === null || outOfStock)
  ) {
    status = "OUT_OF_STOCK";
    clarificationCode = null;
  }

  return {
    ...rawLine,
    candidate,
    alternatives,
    productConfidence: roundScore(confidence),
    confidenceBand: confidenceBand(confidence),
    status,
    clarificationCode,
    casePackSize,
    proposedCaseQuantity: unitResult?.proposedCaseQuantity ?? null,
    conversionNote: unitResult?.conversionNote ?? null,
    outOfStock,
  };
}

export function parseCaptureText(input: CaptureParseInput): CaptureParseResult {
  const products = input.products.map(indexProduct);
  const aliases = input.aliases ?? [];
  const history = new Map(
    (input.history ?? []).map((entry) => [entry.productSku, entry]),
  );
  const rawLines = segmentCaptureText(input.text);

  return {
    lines: rawLines.map((line) =>
      buildLine(line, products, aliases, history),
    ),
  };
}
