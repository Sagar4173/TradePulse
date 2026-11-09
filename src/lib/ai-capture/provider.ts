import { parseCaptureText } from "./parse";
import type { CaptureParseInput, CaptureParseResult } from "./types";

/**
 * Seam for future extraction providers.
 *
 * The deterministic provider is the default and only active implementation in
 * M5. A Gemini/LLM adapter can be added later, but its output must pass
 * `validateProviderCaptureOutput` and every selected line must still be
 * confirmed and validated by the server before it reaches a cart.
 */
export type CaptureProvider = {
  id: string;
  extract(input: CaptureParseInput): Promise<CaptureParseResult>;
};

export const deterministicCaptureProvider: CaptureProvider = {
  id: "deterministic",
  async extract(input) {
    return parseCaptureText(input);
  },
};
