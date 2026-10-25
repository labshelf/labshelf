/** Reads the abstract printed in a paper's front matter. */
import { collapseWhitespace } from "../metadata/index.js";
import { ABSTRACT_STOP, stopIndex } from "./headings.js";

// The separator after the heading is unpredictable ("Abstract", "Abstract.",
// "Abstract:", "Abstract—") and the text layer sometimes swallows the space
// that followed it, so every delimiter is optional.
const ABSTRACT_HEADING = /(?:^|\n|\s)(?:abstract|summary|resumo|resumen)\b\s*[.:–—-]*\s*/gi;
// An abstract runs a few hundred words; anything shorter than the floor is a
// cross-reference ("see abstract") rather than the abstract itself.
const ABSTRACT_MAX_CHARS = 2500;
const ABSTRACT_MIN_CHARS = 120;
/**
 * Reads the abstract printed in a paper's front matter, for use as the summary
 * when no registry returned one.
 * @returns The abstract with whitespace collapsed, or undefined when absent.
 */
export function abstractFromText(text: string): string | undefined {
  if (!text) {
    return undefined;
  }

  // The word "abstract" also occurs in prose, so every occurrence is tried and
  // the first one followed by enough text to be an abstract wins.
  const heading = new RegExp(ABSTRACT_HEADING.source, ABSTRACT_HEADING.flags);
  let match: RegExpExecArray | null;
  while ((match = heading.exec(text)) !== null) {
    const start = match.index + match[0].length;
    const window = text.slice(start, start + ABSTRACT_MAX_CHARS);
    const body = collapseWhitespace(window.slice(0, stopIndex(window, ABSTRACT_STOP)));
    if (body && body.length >= ABSTRACT_MIN_CHARS) {
      return body;
    }
  }
  return undefined;
}
