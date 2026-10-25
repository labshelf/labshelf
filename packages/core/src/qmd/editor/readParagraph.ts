// Reads the lines up to the next blank line as a paragraph, a display math block, or raw Markdown outside the subset.
// CONTRACT: documents/contracts/qmd-items.md#format
import { qmdSchema } from "./schema/index.js";
import { isBlank, rawText, type BlockSpan, type Line } from "./blockLines.js";
import { parseInline } from "./parseInline.js";
import { isListMarker } from "./readList.js";

const RAW_START = /^(?:[>|<\uFEFF]|:::| {4}|\t)/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
const MATH = /^\$\$([\s\S]*?)\$\$(?: \{#(eq-[^}\s]+)\})?$/;

/** Inside a list item a nested list marker ends the paragraph, as Pandoc reads it. */
export function readParagraph(lines: readonly Line[], start: number, nested: boolean): BlockSpan {
  let end = start + 1;
  while (end < lines.length && !isBlank(lines[end]!) && !(nested && isListMarker(lines[end]!.content))) { end++; }
  const contents = lines.slice(start, end).map((line) => line.content);
  const isRaw = RAW_START.test(contents[0]!) || RULE.test(contents[0]!) || contents.slice(1).some((line) => SETEXT.test(line));
  if (isRaw) {
    const text = rawText(lines, start, end);
    return { end, build: (gap) => qmdSchema.nodes.raw_block!.createChecked({ text, gap }) };
  }
  const joined = contents.join("\n");
  const math = MATH.exec(joined);
  if (math) {
    const attrs = { tex: math[1]!, label: math[2] ?? null };
    return { end, build: (gap) => qmdSchema.nodes.math_display!.createChecked({ ...attrs, gap }) };
  }
  return { end, build: (gap) => qmdSchema.nodes.paragraph!.createChecked({ gap }, parseInline(joined)) };
}
