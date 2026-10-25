// Estimates token counts from character length to bound chunk size.

// ~4 chars per token approximates English academic text; real tokenizers belong to embedding providers.
const CHARS_PER_TOKEN = 4;

/**
 * Approximate token count from a UTF-16 string.
 *
 * @returns Estimated token count, rounded up.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Inverse of estimateTokens — character budget for a given token target.
 *
 * @returns Character count corresponding to maxTokens.
 */
export function deriveCharsForTokenBudget(maxTokens: number): number {
  return Math.max(1, Math.floor(maxTokens * CHARS_PER_TOKEN));
}
