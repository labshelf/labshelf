// Cuts a text at its first sentence end, or keeps all of it when none ends.
// A terminator counts only before whitespace or the end, so "3.5" stays whole; abbreviations are not special-cased.
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  return /^[\s\S]*?[.!?](?=\s|$)/.exec(trimmed)?.[0] ?? trimmed;
}
