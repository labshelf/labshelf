/** Blanks LaTeX comments so scanning ignores them while every offset still maps to the original text. */

// INVARIANT: the result has the same length as the input; only comment characters change, to spaces.
export function removeComments(text: string): string {
  // `\\.` is matched first so an escaped `\%` is not a comment start.
  return text.replace(/\\.|%[^\n]*/g, (match) => (match.startsWith("%") ? " ".repeat(match.length) : match));
}
