/** Splits query text into words, keeping quoted phrases together. */

/**
 * A `-` or `key:` prefix stays in front of a quoted phrase, and an unterminated quote runs to the end.
 * @returns the tokens, quotes removed
 */
export function splitQuery(query: string): string[] {
  const tokens: string[] = [];
  const re = /(-?[\w:#.<>=-]*?)"([^"]*)"?|(\S+)/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(query)) !== null) {
    if (match[3] !== undefined) {
      tokens.push(match[3]);
    } else {
      tokens.push((match[1] ?? "") + (match[2] ?? ""));
    }
  }
  return tokens.filter((t) => t.length > 0);
}
