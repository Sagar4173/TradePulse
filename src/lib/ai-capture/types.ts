export const CAPTURE_UNIT_KINDS = [
  "CASE",
  "PIECE",
  "WEIGHT",
  "VOLUME",
  "UNKNOWN",
] as const;

export type CaptureUnitKind = (typeof CAPTURE_UNIT_KINDS)[number];

export const CAPTURE_LINE_STATUSES = [
  "READY",
  "NEEDS_PRODUCT_CLARIFICATION",
  "NEEDS_UNIT_CLARIFICATION",
  "UNMATCHED",
  "OUT_OF_STOCK",
  "PRICE_UNAVAILABLE",
] as const;

export type CaptureLineStatus = (typeof CAPTURE_LINE_STATUSES)[number];

export const CAPTURE_CLARIFICATION_CODES = [
  "PRODUCT_AMBIGUOUS",
  "PRODUCT_NOT_FOUND",
  "QUANTITY_MISSING",
  "QUANTITY_OUT_OF_RANGE",
  "UNIT_MISSING",
  "WHOLE_CASES_ONLY",
  "PIECE_NOT_CASE_MULTIPLE",
  "CASE_PACK_UNKNOWN",
  "WEIGHT_NOT_CASE",
  "PRICE_UNAVAILABLE",
] as const;

export type CaptureClarificationCode =
  (typeof CAPTURE_CLARIFICATION_CODES)[number];

export type CaptureConfidenceBand = "HIGH" | "MEDIUM" | "LOW";

/** A product row loaded for deterministic matching. No dealer price is used. */
export type MatchProduct = {
  sku: string;
  name: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  unitLabel: string;
  availableCases: number | null;
  hasRetailerPrice: boolean;
};

/** A retailer-confirmed shorthand phrase. */
export type MatchAlias = {
  normalizedPhrase: string;
  productSku: string;
  confirmationCount: number;
};

/** Aggregated retailer order history used only as a ranking signal. */
export type MatchHistoryEntry = {
  productSku: string;
  orderCount: number;
  totalQuantity: number;
};

export type RankedCandidate = {
  sku: string;
  name: string;
  brand: string | null;
  category: string | null;
  unitLabel: string;
  availableCases: number | null;
  hasRetailerPrice: boolean;
  score: number;
};

export type RawCaptureLine = {
  id: string;
  originalText: string;
  description: string;
  quantity: number | null;
  unitKind: CaptureUnitKind;
  unitText: string | null;
  packSizeHint: string | null;
};

export type CaptureLine = {
  id: string;
  originalText: string;
  description: string;
  quantity: number | null;
  unitKind: CaptureUnitKind;
  unitText: string | null;
  packSizeHint: string | null;
  candidate: RankedCandidate | null;
  alternatives: RankedCandidate[];
  productConfidence: number;
  confidenceBand: CaptureConfidenceBand;
  status: CaptureLineStatus;
  clarificationCode: CaptureClarificationCode | null;
  casePackSize: number | null;
  proposedCaseQuantity: number | null;
  conversionNote: string | null;
  outOfStock: boolean;
};

export type CaptureParseInput = {
  text: string;
  products: readonly MatchProduct[];
  aliases?: readonly MatchAlias[];
  history?: readonly MatchHistoryEntry[];
};

export type CaptureParseResult = {
  lines: CaptureLine[];
};
