// Turns the markdown a hover answers in into the plain text an editor tooltip shows.

const FENCE = /^```.*$/gm;

/** Drops the code fence lines and trims; empty when nothing is left to show. */
export function derivePlainHoverText(markdown: string): string {
  return markdown.replace(FENCE, "").trim();
}
