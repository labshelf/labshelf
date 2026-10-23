// Reads the marker before a line ending and turns it into a hard_break node.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Node } from "prosemirror-model";
import { qmdSchema } from "../../schema/index.js";

/** Splits `line` into the text kept and the break marker: an odd trailing `\`, two or more trailing spaces, or "". */
export function splitBreakMarker(line: string): { text: string; marker: string } {
  const backslashes = /\\*$/.exec(line)?.[0].length ?? 0;
  if (backslashes % 2 === 1) return { text: line.slice(0, -1), marker: "\\" };
  const spaces = / *$/.exec(line)?.[0].length ?? 0;
  if (spaces >= 2) return { text: line.slice(0, -spaces), marker: line.slice(-spaces) };
  return { text: line, marker: "" };
}

export function hardBreak(marker: string): Node {
  return qmdSchema.node("hard_break", { marker });
}

/** Reads `text` with line breaks only, every other byte literal. */
export function plainInline(text: string): Node[] {
  const lines = text.split("\n");
  return lines.flatMap((line, index) => {
    if (index === lines.length - 1) return line ? [qmdSchema.text(line)] : [];
    const { text: kept, marker } = splitBreakMarker(line);
    return kept ? [qmdSchema.text(kept), hardBreak(marker)] : [hardBreak(marker)];
  });
}
