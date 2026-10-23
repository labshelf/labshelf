// Cuts the lines of a container into blocks, each with the exact blank lines before it.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Node } from "prosemirror-model";
import { findOutputs, OUTPUT_CLASS } from "../../outputs/index.js";
import { topLevelDivs } from "../../items/index.js";
import { qmdSchema } from "../schema/index.js";
import { isBlank, rawText, type BlockSpan, type Line } from "./blockLines.js";
import { parseInline } from "./parseInline.js";
import { readCodeCell } from "./readCodeCell.js";
import { readList } from "./readList.js";
import { readParagraph } from "./readParagraph.js";

export interface BlockSlice extends BlockSpan { readonly gap: string; readonly start: number }

const HEADING = /^(#{1,6})(?:([ \t]+)(.*))?$/;

/** The blocks of `lines` and the blank lines after the last one; `nested` marks the lines of a list item. */
export function sliceBlocks(lines: readonly Line[], nested = false): { blocks: BlockSlice[]; trailing: string } {
  const blocks: BlockSlice[] = [];
  let i = 0;
  for (;;) {
    let start = i;
    while (start < lines.length && isBlank(lines[start]!)) { start++; }
    const gap = rawText(lines, i, start);
    if (start === lines.length) { return { blocks, trailing: gap }; }
    const span = readBlock(lines, start, nested);
    blocks.push({ ...span, gap, start });
    i = span.end;
  }
}

/** The block nodes of a container inside a list item. */
export function parseBlocks(lines: readonly Line[]): Node[] {
  return sliceBlocks(lines, true).blocks.map((block) => block.build(block.gap));
}

function readBlock(lines: readonly Line[], start: number, nested: boolean): BlockSpan {
  return readCodeCell(lines, start) ?? readDiv(lines, start) ?? readHeading(lines, start) ?? readList(lines, start)
    ?? readParagraph(lines, start, nested);
}

function readHeading(lines: readonly Line[], start: number): BlockSpan | undefined {
  const match = HEADING.exec(lines[start]!.content);
  if (!match) { return undefined; }
  const attrs = { level: match[1]!.length, space: match[2] ?? "" };
  return { end: start + 1, build: (gap) => qmdSchema.nodes.heading!.createChecked({ ...attrs, gap }, parseInline(match[3] ?? "")) };
}

/** A valid output div becomes an output node; any other div is kept as a raw block. */
function readDiv(lines: readonly Line[], start: number): BlockSpan | undefined {
  const div = topLevelDivs(lines.slice(start).map((line) => line.content))[0];
  if (div?.open !== 0) { return undefined; }
  const end = start + div.close + 1;
  const raw = rawText(lines, start, end);
  const output = lines[start]!.content.includes(OUTPUT_CLASS) ? findOutputs(raw)[0] : undefined;
  return {
    end,
    build: (gap) => output
      ? qmdSchema.nodes.output!.createChecked({ cell: output.cell, source: output.source, engine: output.engine ?? null, ran: output.ran ?? null, raw, gap })
      : qmdSchema.nodes.raw_block!.createChecked({ text: raw, gap }),
  };
}
