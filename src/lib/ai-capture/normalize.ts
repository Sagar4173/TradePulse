/**
 * Deterministic text normalisation for Hindi, Hinglish and English order text.
 *
 * The goal is not to translate the retailer's words, but to produce a stable
 * surface form for display and a canonical form for matching. The canonical
 * form is intentionally conservative: it only applies a small, auditable set
 * of spelling and synonym rules. No external service is required.
 */

const DEVANAGARI_WORDS: Readonly<Record<string, string>> = {
  "पेटी": "peti",
  "पेटि": "peti",
  "बिस्किट": "biscuit",
  "बिस्कुट": "biscuit",
  "ग्लूकोज": "glucose",
  "ग्लूकोज़": "glucose",
  "वाशिंग": "washing",
  "वॉशिंग": "washing",
  "डिटर्जेंट": "detergent",
  "डिटर्जन्ट": "detergent",
  "सर्फ": "detergent",
  "पाउडर": "powder",
  "चाय": "chai",
  "पत्ती": "patti",
  "टी": "tea",
  "लीफ": "leaf",
  "साबुन": "sabun",
  "तेल": "tel",
  "आटा": "aata",
  "चावल": "chawal",
  "चीनी": "cheeni",
  "नमक": "namak",
  "दूध": "doodh",
  "मसाला": "masala",
  "केस": "case",
  "पैकेट": "packet",
  "पीस": "piece",
  "किलो": "kilo",
  "ग्राम": "gram",
  "लीटर": "litre",
  "एक": "ek",
  "दो": "do",
  "तीन": "teen",
  "चार": "char",
  "पांच": "paanch",
  "पाँच": "paanch",
  "छह": "chhe",
  "सात": "saat",
  "आठ": "aath",
  "नौ": "nau",
  "दस": "das",
  "बीस": "bees",
  "पचास": "pachas",
  "सौ": "sau",
  "डेढ़": "dedh",
  "ढाई": "dhai",
  "भैया": "bhaiya",
  "भाई": "bhai",
  "जी": "ji",
  "छोटा": "chhota",
  "बड़ा": "bada",
};

const DEVANAGARI_VOWELS: Readonly<Record<string, string>> = {
  "अ": "a",
  "आ": "a",
  "इ": "i",
  "ई": "i",
  "उ": "u",
  "ऊ": "u",
  "ऋ": "ri",
  "ए": "e",
  "ऐ": "ai",
  "ओ": "o",
  "औ": "au",
};

const DEVANAGARI_CONSONANTS: Readonly<Record<string, string>> = {
  "क": "k",
  "ख": "kh",
  "ग": "g",
  "घ": "gh",
  "ङ": "ng",
  "च": "ch",
  "छ": "chh",
  "ज": "j",
  "झ": "jh",
  "ञ": "ny",
  "ट": "t",
  "ठ": "th",
  "ड": "d",
  "ढ": "dh",
  "ण": "n",
  "त": "t",
  "थ": "th",
  "द": "d",
  "ध": "dh",
  "न": "n",
  "प": "p",
  "फ": "ph",
  "ब": "b",
  "भ": "bh",
  "म": "m",
  "य": "y",
  "र": "r",
  "ल": "l",
  "व": "v",
  "श": "sh",
  "ष": "sh",
  "स": "s",
  "ह": "h",
  "ळ": "l",
  "क़": "q",
  "ख़": "kh",
  "ग़": "g",
  "ज़": "z",
  "ड़": "r",
  "ढ़": "rh",
  "फ़": "f",
  "य़": "y",
};

const DEVANAGARI_MATRAS: Readonly<Record<string, string>> = {
  "ा": "a",
  "ि": "i",
  "ी": "i",
  "ु": "u",
  "ू": "u",
  "ृ": "ri",
  "े": "e",
  "ै": "ai",
  "ो": "o",
  "ौ": "au",
  "ं": "n",
  "ँ": "n",
  "ः": "h",
  "्": "",
  "़": "",
};

const DEVANAGARI_DIGITS: Readonly<Record<string, string>> = {
  "०": "0",
  "१": "1",
  "२": "2",
  "३": "3",
  "४": "4",
  "५": "5",
  "६": "6",
  "७": "7",
  "८": "8",
  "९": "9",
};

const TOKEN_VARIANTS: Readonly<Record<string, string>> = {
  biskit: "biscuit",
  biskut: "biscuit",
  biscut: "biscuit",
  biscket: "biscuit",
  biscit: "biscuit",
  petee: "peti",
  petii: "peti",
  petti: "peti",
  patti: "patti",
  chay: "chai",
  chaay: "chai",
  vashing: "washing",
  paudar: "powder",
  pauder: "powder",
  powder: "powder",
  detergent: "detergent",
  surf: "detergent",
  kilos: "kilo",
  kilogram: "kilo",
  kilograms: "kilo",
  ltr: "litre",
  liter: "litre",
  liters: "litre",
  litres: "litre",
  pkt: "packet",
  pcks: "packet",
  pcs: "piece",
  pc: "piece",
  pieces: "piece",
  boxes: "box",
  cases: "case",
  cartons: "carton",
  chota: "chhota",
  chotta: "chhota",
  bara: "bada",
  bada: "bada",
};

const CANONICAL_PHRASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bwashing\s+powder\b/g, "detergent powder"],
  [/\bchai\s+patti\b/g, "tea leaf"],
  [/\btea\s+patti\b/g, "tea leaf"],
  [/\bchai\b/g, "tea"],
];

function transliterateDevanagariWord(word: string): string {
  let output = "";
  let index = 0;

  while (index < word.length) {
    const character = word[index];

    if (DEVANAGARI_DIGITS[character]) {
      output += DEVANAGARI_DIGITS[character];
      index += 1;
      continue;
    }

    if (DEVANAGARI_VOWELS[character]) {
      output += DEVANAGARI_VOWELS[character];
      index += 1;
      continue;
    }

    if (DEVANAGARI_CONSONANTS[character]) {
      output += DEVANAGARI_CONSONANTS[character];
      index += 1;

      const next = word[index];
      if (next && DEVANAGARI_MATRAS[next]) {
        output += DEVANAGARI_MATRAS[next];
        index += 1;
      } else {
        // Inherent vowel unless the next character is a virama.
        if (next !== "्") {
          output += "a";
        }
      }
      continue;
    }

    if (DEVANAGARI_MATRAS[character]) {
      output += DEVANAGARI_MATRAS[character];
      index += 1;
      continue;
    }

    output += character;
    index += 1;
  }

  return output;
}

function transliterateDevanagari(text: string): string {
  return text.replace(/[\u0900-\u097F]+/g, (word) => {
    const known = DEVANAGARI_WORDS[word];
    if (known) {
      return known;
    }

    return transliterateDevanagariWord(word);
  });
}

function applyTokenVariants(text: string): string {
  return text.replace(/[a-z0-9]+/gi, (token) => {
    const lower = token.toLowerCase();
    return TOKEN_VARIANTS[lower] ?? lower;
  });
}

/**
 * Lowercase, Unicode-normalised display text. It keeps punctuation and does
 * not apply product synonyms, so it is safe to show to the retailer.
 */
export function normalizeSurfaceText(value: string): string {
  return transliterateDevanagari(
    value
      .normalize("NFC")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase(),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Canonical matching text. Adds the small synonym vocabulary used by the
 * matcher. This is deliberately deterministic and auditable.
 */
export function normalizeText(value: string): string {
  let text = normalizeSurfaceText(value);
  text = applyTokenVariants(text);

  for (const [pattern, replacement] of CANONICAL_PHRASES) {
    text = text.replace(pattern, replacement);
  }

  return text.replace(/\s+/g, " ").trim();
}

/** A single word reduced to the canonical matching alphabet. */
export function normalizeToken(value: string): string {
  return normalizeText(value)
    .replace(/[^a-z0-9.]+/g, "")
    .replace(/^\.+|\.+$/g, "");
}

/**
 * Alias phrases keep descriptive words such as "chhota" but still receive
 * spelling canonicalisation so the same shorthand hits the same row.
 */
export function normalizeAliasPhrase(value: string): string {
  return applyTokenVariants(normalizeSurfaceText(value))
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
