import { normalizeSurfaceText, normalizeToken } from "./normalize";
import { parseNumberToken, parsePackSizeHint, unitKindForToken } from "./quantity";
import type {
  CaptureUnitKind,
  RawCaptureLine,
} from "./types";

const STOP_WORDS = new Set([
  "bhaiya",
  "bhai",
  "ji",
  "please",
  "kripya",
  "mujhe",
  "chahiye",
  "dena",
  "dijiye",
  "order",
  "karna",
  "kar",
  "hai",
  "he",
  "ka",
  "ki",
  "ke",
  "ko",
  "se",
  "mein",
  "me",
  "for",
  "of",
  "the",
  "a",
  "an",
  "to",
]);

const CLAUSE_SEPARATOR = /([,;\n]|\+|\b(?:aur|and|plus)\b)/gi;

type Token = {
  raw: string;
  start: number;
  end: number;
  surface: string;
  normalized: string;
  number: number | null;
  unitKind: CaptureUnitKind | null;
};

type Anchor = {
  numberIndex: number;
  unitIndex: number;
  quantity: number;
  unitKind: CaptureUnitKind;
  unitText: string;
};

type ClauseOrientation = "QUANTITY_FIRST" | "PRODUCT_FIRST";

function tokenizeClause(clause: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(clause)) !== null) {
    const raw = match[0];
    const surface = normalizeSurfaceText(raw).replace(/[^a-z0-9.]+/g, "");
    const normalized = normalizeToken(raw);
    const start = match.index;
    const end = start + raw.length;

    if (!surface && !normalized) {
      continue;
    }

    tokens.push({
      raw,
      start,
      end,
      surface,
      normalized,
      number: parseNumberToken(raw),
      unitKind: unitKindForToken(raw),
    });
  }

  return tokens;
}

function splitClauses(text: string): Array<{ text: string; start: number }> {
  const clauses: Array<{ text: string; start: number }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const pattern = new RegExp(CLAUSE_SEPARATOR.source, CLAUSE_SEPARATOR.flags);
  while ((match = pattern.exec(text)) !== null) {
    const clause = text.slice(lastIndex, match.index);
    if (clause.trim()) {
      clauses.push({ text: clause, start: lastIndex });
    }
    lastIndex = pattern.lastIndex;
  }

  const tail = text.slice(lastIndex);
  if (tail.trim()) {
    clauses.push({ text: tail, start: lastIndex });
  }

  return clauses;
}

function isStopWord(token: Token): boolean {
  return STOP_WORDS.has(token.normalized);
}

function findAnchors(
  tokens: readonly Token[],
  allowed: ReadonlySet<CaptureUnitKind>,
): Anchor[] {
  const anchors: Anchor[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const number = tokens[index].number;
    if (number === null) {
      continue;
    }

    let unitIndex = index + 1;
    if (
      tokens[unitIndex] &&
      ["ka", "ki", "ke"].includes(tokens[unitIndex].normalized)
    ) {
      unitIndex += 1;
    }

    const unit = tokens[unitIndex];
    if (!unit?.unitKind || !allowed.has(unit.unitKind)) {
      continue;
    }

    anchors.push({
      numberIndex: index,
      unitIndex,
      quantity: number,
      unitKind: unit.unitKind,
      unitText: unit.surface,
    });
  }

  return anchors;
}

function firstMeaningfulIndex(
  tokens: readonly Token[],
  before: number,
): number {
  for (let index = 0; index < before; index += 1) {
    if (!isStopWord(tokens[index])) {
      return index;
    }
  }

  return before;
}

function buildDescription(
  tokens: readonly Token[],
  from: number,
  to: number,
  anchor: Anchor,
): string {
  return tokens
    .slice(from, to)
    .filter(
      (token) =>
        token !== tokens[anchor.numberIndex] &&
        token !== tokens[anchor.unitIndex] &&
        !isStopWord(token) &&
        token.surface.length > 0,
    )
    .map((token) => token.surface)
    .join(" ");
}

function lineFromAnchor(
  id: string,
  text: string,
  tokens: readonly Token[],
  anchor: Anchor,
  anchorIndex: number,
  anchors: readonly Anchor[],
  orientation: ClauseOrientation,
): RawCaptureLine | null {
  const next = anchors[anchorIndex + 1];
  const previous = anchors[anchorIndex - 1];
  let segmentStart: number;
  let segmentEnd: number;

  if (orientation === "QUANTITY_FIRST") {
    segmentEnd = next ? next.numberIndex : tokens.length;
    segmentStart =
      anchorIndex === 0
        ? firstMeaningfulIndex(tokens, anchor.numberIndex)
        : anchor.numberIndex;
  } else {
    segmentStart =
      anchorIndex === 0
        ? firstMeaningfulIndex(tokens, anchor.numberIndex)
        : previous.unitIndex + 1;
    segmentEnd = next ? anchor.unitIndex + 1 : tokens.length;
  }

  if (segmentStart >= segmentEnd) {
    return null;
  }

  const description = buildDescription(
    tokens,
    segmentStart,
    segmentEnd,
    anchor,
  );
  const originalText = text
    .slice(tokens[segmentStart].start, tokens[segmentEnd - 1].end)
    .replace(/\s+/g, " ")
    .trim();

  if (!originalText) {
    return null;
  }

  return {
    id,
    originalText,
    description,
    quantity: anchor.quantity,
    unitKind: anchor.unitKind,
    unitText: anchor.unitText,
    packSizeHint: parsePackSizeHint(description),
  };
}

function lineWithoutAnchor(
  id: string,
  text: string,
  tokens: readonly Token[],
): RawCaptureLine | null {
  const start = firstMeaningfulIndex(tokens, tokens.length);
  const meaningful = tokens
    .slice(start)
    .filter((token) => !isStopWord(token) && token.surface.length > 0);

  if (meaningful.length === 0) {
    return null;
  }

  // A bare number is still a quantity. Without a unit it must be clarified,
  // but dropping the number would silently change the retailer's request.
  let quantityIndex = -1;
  for (let index = 0; index < meaningful.length; index += 1) {
    const token = meaningful[index];
    const next = meaningful[index + 1];

    if (token.number === null || token.number < 0) {
      continue;
    }

    if (next && ["wala", "wali", "wale"].includes(next.normalized)) {
      continue;
    }

    quantityIndex = index;
    break;
  }

  const description = meaningful
    .filter((_, index) => index !== quantityIndex)
    .map((token) => token.surface)
    .join(" ");
  const originalText = text
    .slice(meaningful[0].start, meaningful[meaningful.length - 1].end)
    .replace(/\s+/g, " ")
    .trim();

  return {
    id,
    originalText,
    description,
    quantity: quantityIndex === -1 ? null : meaningful[quantityIndex].number,
    unitKind: "UNKNOWN",
    unitText: null,
    packSizeHint: parsePackSizeHint(description),
  };
}

/**
 * Splits free-form order text into candidate lines. It only recognises
 * quantity/unit patterns that are present in the text; it never invents a
 * missing unit. Case and piece anchors split items; weight and volume anchors
 * are used only when no case/piece anchor exists, because in phrases such as
 * "2 peti washing powder 1 kilo" the weight describes the pack, not a second
 * order line.
 */
export function segmentCaptureText(text: string): RawCaptureLine[] {
  const clauses = splitClauses(text);
  const lines: RawCaptureLine[] = [];
  let lineNumber = 1;

  for (const clause of clauses) {
    const tokens = tokenizeClause(clause.text);
    if (tokens.length === 0) {
      continue;
    }

    let anchors = findAnchors(
      tokens,
      new Set<CaptureUnitKind>(["CASE", "PIECE"]),
    );

    if (anchors.length === 0) {
      anchors = findAnchors(
        tokens,
        new Set<CaptureUnitKind>(["WEIGHT", "VOLUME"]),
      );
    }

    if (anchors.length === 0) {
      const line = lineWithoutAnchor(
        `line-${lineNumber}`,
        clause.text,
        tokens,
      );

      if (line) {
        lines.push(line);
        lineNumber += 1;
      }
      continue;
    }

    const seen = new Set<number>();
    const firstMeaningful = firstMeaningfulIndex(tokens, tokens.length);
    const orientation: ClauseOrientation =
      firstMeaningful < anchors[0].numberIndex
        ? "PRODUCT_FIRST"
        : "QUANTITY_FIRST";

    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index];
      if (seen.has(anchor.numberIndex)) {
        continue;
      }
      seen.add(anchor.numberIndex);

      const line = lineFromAnchor(
        `line-${lineNumber}`,
        clause.text,
        tokens,
        anchor,
        index,
        anchors,
        orientation,
      );

      if (line) {
        lines.push(line);
        lineNumber += 1;
      }
    }
  }

  return lines;
}
