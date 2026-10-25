/** Reads brace and bracket groups of LaTeX arguments, balancing nested braces and skipping escapes. */

export interface Delimited {
  /** Offset of the first content character. */
  start: number;
  /** Offset just past the last content character. */
  end: number;
  /** Offset just past the closing delimiter. */
  next: number;
}

/** Reads the group opened by `{` or `[` at `at`; undefined when `at` is not that opener or the group never closes. */
export function readDelimited(text: string, at: number, open: "{" | "["): Delimited | undefined {
  if (text[at] !== open) { return undefined; }
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") { i++; continue; }
    if (char === "{") { depth++; }
    else if (char === "}") {
      depth--;
      if (open === "{" && depth === 0) { return { start: at + 1, end: i, next: i + 1 }; }
    } else if (char === "]" && open === "[" && depth === 0) {
      return { start: at + 1, end: i, next: i + 1 };
    }
  }
  return undefined;
}

export function skipSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i]!)) { i++; }
  return i;
}
