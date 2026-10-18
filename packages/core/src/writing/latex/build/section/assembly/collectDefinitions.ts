/** Collects, in source order, the definitions a section typeset alone needs from the document body before it. */
import type { LatexPosition, LatexSourceFacts } from "../../../source/index.js";
import { stripComments } from "../../../source/index.js";
import { findDefinitionSpans } from "./definitionSpans.js";
import type { SourceSpan } from "./definitionSpans.js";

const BEGIN_DOCUMENT = /\\begin\s*\{document\}/;

function offsetsOf(text: string): (position: LatexPosition) => number {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") { lineStarts.push(i + 1); }
  }
  return (position) => lineStarts[position.line]! + position.character;
}

/**
 * `scan` is `scanLatexSource(text)`. Definitions before `\begin{document}` are skipped: the format holds the preamble,
 * and a second `\newcommand` of the same name stops TeX. A definition nested in another is kept once, inside its parent.
 */
export function collectDefinitions(text: string, scan: LatexSourceFacts): string[] {
  // INVARIANT: stripComments keeps offsets, so spans found in the stripped text slice the original.
  const stripped = stripComments(text);
  const body = BEGIN_DOCUMENT.exec(stripped);
  const from = body ? body.index + body[0].length : 0;
  const offset = offsetsOf(text);
  const spans: SourceSpan[] = [
    ...scan.macros.map((macro) => ({ start: offset(macro.range.start), end: offset(macro.range.end) })),
    ...findDefinitionSpans(stripped),
  ].filter((span) => span.start >= from).sort((a, b) => a.start - b.start);
  const definitions: string[] = [];
  let covered = -1;
  for (const span of spans) {
    if (span.start < covered) { continue; }
    definitions.push(text.slice(span.start, span.end));
    covered = span.end;
  }
  return definitions;
}
