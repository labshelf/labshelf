/** Finds the `\lsvalue` key under or before the cursor in LaTeX text. */

export interface LatexProjectValueReference {
  key: string;
  /** Character offsets of the key in the text. */
  start: number;
  end: number;
}

const OPEN_LSVALUE = /\\lsvalue\{([^{}\s]*)$/;
const LSVALUE = /\\lsvalue\{([^{}\s]*)\}/g;

/** Column where the partial key before the cursor starts, or undefined when the cursor is not inside `\lsvalue{`. */
export function findLatexProjectValueStart(linePrefix: string): number | undefined {
  const open = OPEN_LSVALUE.exec(linePrefix);
  return open ? open.index + open[0].length - open[1]!.length : undefined;
}

/** The `\lsvalue{key}` whose key contains the offset. */
export function findLatexProjectValue(text: string, offset: number): LatexProjectValueReference | undefined {
  for (const match of text.matchAll(LSVALUE)) {
    const key = match[1]!;
    const start = match.index + match[0].length - 1 - key.length;
    if (start <= offset && offset <= start + key.length) { return { key, start, end: start + key.length }; }
  }
  return undefined;
}
