import type { CaptureUnitKind } from "./types";
import { normalizeSurfaceText, normalizeToken } from "./normalize";

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  shunya: 0,
  ek: 1,
  ik: 1,
  do: 2,
  teen: 3,
  tin: 3,
  char: 4,
  chaar: 4,
  paanch: 5,
  panch: 5,
  chhe: 6,
  che: 6,
  chah: 6,
  saat: 7,
  sat: 7,
  aath: 8,
  ath: 8,
  nau: 9,
  no: 9,
  das: 10,
  dus: 10,
  gyarah: 11,
  gyara: 11,
  barah: 12,
  bara: 12,
  terah: 13,
  chaudah: 14,
  pandrah: 15,
  solah: 16,
  satrah: 17,
  atharah: 18,
  unnis: 19,
  bees: 20,
  bis: 20,
  iktis: 21,
  battis: 22,
  teis: 23,
  chobis: 24,
  pachees: 25,
  chhabbis: 26,
  sattais: 27,
  atthais: 28,
  untees: 29,
  tees: 30,
  chalis: 40,
  pachas: 50,
  pachchas: 50,
  saath: 60,
  sattar: 70,
  assi: 80,
  nabbe: 90,
  sau: 100,
  hazar: 1000,
  dedh: 1.5,
  dhai: 2.5,
};

const CASE_UNITS = new Set([
  "peti",
  "petti",
  "petee",
  "case",
  "cases",
  "box",
  "boxes",
  "carton",
  "cartons",
  "crate",
  "crates",
]);

const PIECE_UNITS = new Set([
  "piece",
  "pieces",
  "pcs",
  "pc",
  "packet",
  "packets",
  "pkt",
  "pack",
  "packs",
  "pouch",
  "pouches",
  "nag",
  "adad",
  "unit",
  "units",
]);

const WEIGHT_UNITS = new Set([
  "kg",
  "kilo",
  "kilos",
  "kilogram",
  "kilograms",
  "g",
  "gm",
  "gram",
  "grams",
]);

const VOLUME_UNITS = new Set([
  "l",
  "ltr",
  "litre",
  "litres",
  "liter",
  "liters",
  "ml",
]);

const UNIT_DISPLAY: Readonly<Record<string, string>> = {
  kg: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  g: "g",
  gm: "g",
  gram: "g",
  grams: "g",
  l: "l",
  ltr: "l",
  litre: "l",
  litres: "l",
  liter: "l",
  liters: "l",
  ml: "ml",
};

/**
 * Parses an ASCII or Devanagari number token, including the Hindi number words
 * used in retail ordering. Returns null for anything that is not a number.
 *
 * Signs, fractions and ranges are rejected before any punctuation cleanup.
 * A lossy cleanup would silently turn "1/2" into 12, "-2" into 2, or ".5" into
 * 5, which would change the retailer's order.
 */
export function parseNumberToken(value: string): number | null {
  const text = normalizeSurfaceText(value).trim();

  if (!text || text.startsWith(".") || /[+\-/\\]/.test(text)) {
    return null;
  }

  const token = text
    .replace(/^[^a-z0-9]+/i, "")
    .replace(/[^a-z0-9]+$/i, "")
    .toLowerCase();

  if (!token || token.startsWith(".")) {
    return null;
  }

  if (/^\d+(?:\.\d+)?$/.test(token)) {
    const number = Number(token);
    return Number.isFinite(number) ? number : null;
  }

  return NUMBER_WORDS[token] ?? null;
}

export function unitKindForToken(value: string): CaptureUnitKind | null {
  const token = normalizeToken(value);

  if (CASE_UNITS.has(token)) {
    return "CASE";
  }

  if (PIECE_UNITS.has(token)) {
    return "PIECE";
  }

  if (WEIGHT_UNITS.has(token)) {
    return "WEIGHT";
  }

  if (VOLUME_UNITS.has(token)) {
    return "VOLUME";
  }

  return null;
}

/**
 * Reads only explicit "Case of N" labels. Any other free-text unit label
 * requires the retailer to clarify, rather than guessing a pack size.
 */
export function parseCasePackSize(unitLabel: string): number | null {
  const match = /\bcase\s+of\s+(\d{1,4})(?![\d.])\b/i.exec(unitLabel.trim());

  if (!match) {
    return null;
  }

  const size = Number(match[1]);
  return Number.isSafeInteger(size) && size > 0 ? size : null;
}

function displayUnit(unit: string): string {
  return UNIT_DISPLAY[unit] ?? unit;
}

/**
 * Extracts a pack-size hint such as "1 kg", "75 g", "1 l", or "250 wala".
 * This is a hint for matching, never a quantity that can be silently turned
 * into cases.
 */
export function parsePackSizeHint(value: string): string | null {
  const text = normalizeSurfaceText(value);
  const weightOrVolume =
    /(\d+(?:\.\d+)?)\s*(kg|kilo|kilos|kilogram|kilograms|g|gm|gram|grams|ml|l|ltr|litre|litres|liter|liters)\b/.exec(
      text,
    );

  if (weightOrVolume) {
    return `${weightOrVolume[1]} ${displayUnit(weightOrVolume[2])}`;
  }

  const wala = /(\d+(?:\.\d+)?)\s*(?:wala|wali|wale)\b/.exec(text);

  if (wala) {
    return wala[1];
  }

  return null;
}
