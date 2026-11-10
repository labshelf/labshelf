/**
 * Finds the prose of a LaTeX or Typst source as document-offset ranges, so proofing
 * checks text and not markup, math, code, references or text in another language.
 */
import { scanLatex } from "./latexProse.js";
import { clip, type ProseRange, RangeCollector } from "./proseRanges.js";
import { TypstScanner } from "./typstProse.js";

export type { ProseRange } from "./proseRanges.js";

/**
 * Returns the sorted, non-overlapping prose ranges of `text`; `from`/`to` restrict
 * the result to a window and give the same ranges as a full scan cut to it.
 */
export function findProseRanges(format: "latex" | "typst", text: string, from = 0, to = text.length): ProseRange[] {
  const start = Math.max(0, from);
  const end = Math.min(text.length, to);
  if (end <= start) return [];
  const collector = new RangeCollector();
  if (format === "latex") scanLatex(text, end, collector);
  else new TypstScanner(text, end, collector).run();
  return clip(collector.ranges, start, end);
}
