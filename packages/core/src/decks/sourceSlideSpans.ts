// How a talk's or poster's main file splits into what its code shows at a time: the preamble, then one span of whole lines per slide or block.
import { lineEnd as nextLineStart, lineStart } from "../text/lines.js";
import type { DeckKind } from "./deckSizes.js";
import type { SourceDeckNode, SourceDeckRange } from "./sourceDeckBlocks.js";
import type { SourceDeckPath } from "./sourceDeckSelect.js";
import type { SourceDeckFormat } from "./sourceDecks.js";

/** The preamble's span and each unit's span by its path, in document order; together they cover the whole text without overlapping. */
export interface SourceDeckSpans { preamble: SourceDeckRange; units: Array<{ path: SourceDeckPath; range: SourceDeckRange }> }

/** A talk's spans with each slide's span by tree index. */
export interface SourceSlideSpans { preamble: SourceDeckRange; slides: Map<number, SourceDeckRange> }

/**
 * The units the code shows one at a time, in document order and in the main file only: a talk's slides, or the blocks of a poster's
 * columns (each by its [column, block] path).
 */
export function sourceDeckUnits(kind: DeckKind, tree: readonly SourceDeckNode[]): Array<{ path: SourceDeckPath; node: SourceDeckNode }> {
  const units = kind === "talk"
    ? tree.map((node, index) => ({ path: [index], node }))
    : tree.flatMap((column, c) => (column.kind !== "column" ? [] : (column.children ?? []).map((node, b) => ({ path: [c, b], node }))));
  return units.filter(({ node }) => node.kind === (kind === "talk" ? "slide" : "block") && node.file === undefined);
}

/** The offset of the line break that ends the line holding `at`, or the text's end. */
const lineBreakAt = (text: string, at: number): number => { const br = text.indexOf("\n", at); return br === -1 ? text.length : br; };

/**
 * The spans of a main file's `units` (from `sourceDeckUnits`), or null without one. The preamble runs to the end of the line of
 * `\begin{document}` (LaTeX) or to the line before the first unit. Each unit's span starts on the line after the previous unit (so lines
 * between them, such as a `\section` or a column marker, go with the unit after them) and ends at the end of its own last line; the last
 * unit's runs to the end of the text.
 */
export function sourceDeckSpans(format: SourceDeckFormat, text: string, units: ReadonlyArray<{ path: SourceDeckPath; node: SourceDeckNode }>): SourceDeckSpans | null {
  const first = units[0];
  if (!first) return null;
  const firstStart = lineStart(text, first.node.range[0]);
  const begin = format === "latex" ? /^[^%\n]*\\begin\s*\{document\}/m.exec(text) : null;
  const bodyStart = begin && begin.index + begin[0].length <= firstStart ? nextLineStart(text, begin.index + begin[0].length) : firstStart;
  let from = bodyStart;
  const spans = units.map(({ path, node }, i) => {
    const to = i === units.length - 1 ? text.length : lineBreakAt(text, Math.max(node.range[0], node.range[1] - 1));
    const range: SourceDeckRange = [from, to];
    from = nextLineStart(text, to);
    return { path, range };
  });
  return { preamble: [0, Math.max(0, bodyStart > 0 && text[bodyStart - 1] === "\n" ? bodyStart - 1 : bodyStart)], units: spans };
}

/** The span holding `offset`: "preamble", a unit's path (a line break between two spans goes with the unit after it), or undefined without spans. */
export function sourceDeckSpanAt(spans: SourceDeckSpans | null, offset: number): "preamble" | SourceDeckPath | undefined {
  if (!spans) return undefined;
  let found: "preamble" | SourceDeckPath = "preamble";
  for (const { path, range } of spans.units) if (offset >= range[0]) found = path;
  return found;
}

/** A talk's spans, or null when its main file has no slide of its own. */
export function sourceSlideSpans(format: SourceDeckFormat, text: string, tree: readonly SourceDeckNode[]): SourceSlideSpans | null {
  const spans = sourceDeckSpans(format, text, sourceDeckUnits("talk", tree));
  return spans && { preamble: spans.preamble, slides: new Map(spans.units.map(({ path, range }) => [path[0]!, range])) };
}

/** The talk span holding `offset`: "preamble", a slide's tree index, or undefined without spans. */
export function sourceSlideSpanAt(spans: SourceSlideSpans | null, offset: number): "preamble" | number | undefined {
  const at = sourceDeckSpanAt(spans && { preamble: spans.preamble, units: [...spans.slides].map(([index, range]) => ({ path: [index], range })) }, offset);
  return typeof at === "object" ? at[0] : at;
}
