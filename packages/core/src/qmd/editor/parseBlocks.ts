// Cuts the lines of a container into blocks, each with the exact blank lines before it.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Node } from "prosemirror-model";
import { findOutputs, OUTPUT_CLASS } from "../cellOutput/index.js";
import { findTopLevelDivs, findCodeFences, findUnclosedCodeFences } from "../items/index.js";
import { qmdSchema } from "./schema/index.js";
import { isBlank, extractRawText, type BodyBlock, type Line } from "./blockLines.js";
import { parseInline } from "./parseInline.js";
import { readList, isListMarker } from "./readList.js";

const RAW_START = /^(?:[>|<\uFEFF]|:::| {4}|\t)/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
const MATH = /^\$\$([\s\S]*?)\$\$(?: \{#(eq-[^}\s]+)\})?$/;

/** Inside a list item a nested list marker ends the paragraph, as Pandoc reads it. */
function readParagraph(lines: readonly Line[], start: number, nested: boolean): BodyBlock {
  let end = start + 1;
  while (end < lines.length && !isBlank(lines[end]!) && !(nested && isListMarker(lines[end]!.content))) { end++; }
  const contents = lines.slice(start, end).map((line) => line.content);
  const isRaw = RAW_START.test(contents[0]!) || RULE.test(contents[0]!) || contents.slice(1).some((line) => SETEXT.test(line));
  if (isRaw) {
    const text = extractRawText(lines, start, end);
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

const FENCE_START = /^ {0,3}(?:`{3}|~{3})/;
const OPENER = /^(`{3,}|~{3,})(.*)$/;
const LANG = /^[ \t]*(?:\{([^\s{}.#=]+)[^}]*\}|([^\s{`]+))/;

/** A closed fence becomes a code cell; an indented one stays raw; an unclosed one turns the rest of its container raw. */
function readCodeCell(lines: readonly Line[], start: number): BodyBlock | undefined {
  const first = lines[start]!.content;
  if (!FENCE_START.test(first)) { return undefined; }
  const contents = lines.slice(start).map((line) => line.content);
  const close = findCodeFences(contents).get(0);
  if (close === undefined && findUnclosedCodeFences(contents)[0] !== 0) { return undefined; }
  // TRAP: Pandoc runs an unclosed fence to the end of its container, so nothing after it can be read as blocks.
  const end = close === undefined ? lines.length : start + close + 1;
  const opener = OPENER.exec(first);
  if (close === undefined || !opener) {
    const text = extractRawText(lines, start, end);
    return { end, build: (gap) => qmdSchema.nodes.raw_block!.createChecked({ text, gap }) };
  }
  const body = contents.slice(1, close);
  const optionCount = body.findIndex((line) => !line.startsWith("#|"));
  const split = optionCount === -1 ? body.length : optionCount;
  const join = (part: string[]) => part.map((line) => line + "\n").join("");
  const lang = LANG.exec(opener[2]!);
  const attrs = {
    lang: lang?.[1] ?? lang?.[2] ?? null,
    options: join(body.slice(0, split)),
    code: join(body.slice(split)),
    fence: opener[1]!,
    info: opener[2]!,
    close: contents[close]!,
  };
  return { end, build: (gap) => qmdSchema.nodes.code_cell!.createChecked({ ...attrs, gap }) };
}

export interface BodySlice extends BodyBlock { readonly gap: string; readonly start: number }

const HEADING = /^(#{1,6})(?:([ \t]+)(.*))?$/;

/** The blocks of `lines` and the blank lines after the last one; `nested` marks the lines of a list item. */
export function splitBlocks(lines: readonly Line[], nested = false): { blocks: BodySlice[]; trailing: string } {
  const blocks: BodySlice[] = [];
  let i = 0;
  for (;;) {
    let start = i;
    while (start < lines.length && isBlank(lines[start]!)) { start++; }
    const gap = extractRawText(lines, i, start);
    if (start === lines.length) { return { blocks, trailing: gap }; }
    const span = readBlock(lines, start, nested);
    blocks.push({ ...span, gap, start });
    i = span.end;
  }
}

/** The block nodes of a container inside a list item. */
export function parseBlocks(lines: readonly Line[]): Node[] {
  return splitBlocks(lines, true).blocks.map((block) => block.build(block.gap));
}

function readBlock(lines: readonly Line[], start: number, nested: boolean): BodyBlock {
  return readCodeCell(lines, start) ?? readDiv(lines, start) ?? readHeading(lines, start) ?? readList(lines, start)
    ?? readParagraph(lines, start, nested);
}

function readHeading(lines: readonly Line[], start: number): BodyBlock | undefined {
  const match = HEADING.exec(lines[start]!.content);
  if (!match) { return undefined; }
  const attrs = { level: match[1]!.length, space: match[2] ?? "" };
  return { end: start + 1, build: (gap) => qmdSchema.nodes.heading!.createChecked({ ...attrs, gap }, parseInline(match[3] ?? "")) };
}

/** A valid output div becomes an output node; any other div is kept as a raw block. */
function readDiv(lines: readonly Line[], start: number): BodyBlock | undefined {
  const div = findTopLevelDivs(lines.slice(start).map((line) => line.content))[0];
  if (div?.open !== 0) { return undefined; }
  const end = start + div.close + 1;
  const raw = extractRawText(lines, start, end);
  const output = lines[start]!.content.includes(OUTPUT_CLASS) ? findOutputs(raw)[0] : undefined;
  return {
    end,
    build: (gap) => output
      ? qmdSchema.nodes.output!.createChecked({ cell: output.cell, source: output.source, engine: output.engine ?? null, ran: output.ran ?? null, raw, gap })
      : qmdSchema.nodes.raw_block!.createChecked({ text: raw, gap }),
  };
}
