// Reads item bodies into blocks and writes blocks back to the exact source text.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Node } from "prosemirror-model";
import { findOutputs, OUTPUT_CLASS, findTopLevelDivs, findCodeFences, findUnclosedCodeFences, isBlankLine, extractLineContent, extractLineEnding, splitLines } from "../item/index.js";
import { qmdSchema } from "./qmdSchema.js";
import { parseInline, serializeInline } from "./qmdInline.js";

/**
 * `content` is the line without its ending, relative to its container. `raw` is what the line is written back as:
 * the source bytes for blank lines and top-level lines, the dedented content plus `\n` for lines inside a list item.
 */
export interface Line { readonly content: string; readonly raw: string }

/** A block found at `start`: the index after its last line, and how to build its node once its gap is known. */
interface BodyBlock { readonly end: number; readonly build: (gap: string) => Node }

export interface BodyLines { readonly lines: Line[]; readonly eol: string; readonly unterminated: boolean }

/**
 * INVARIANT: a non-blank last line without ending gets the body's ending in `raw`, so every block's `raw` ends with a
 * line ending; a blank one stays as is, because it belongs to the doc's trailing blank lines.
 */
export function splitBodyLines(body: string): BodyLines {
  const eol = extractLineEnding(body);
  const sources = splitLines(body);
  const last = sources.at(-1);
  const unterminated = last !== undefined && extractLineContent(last) === last && !isBlankLine(last);
  const lines = sources.map((raw) => ({ content: extractLineContent(raw), raw: unterminated && raw === last ? raw + eol : raw }));
  return { lines, eol, unterminated };
}

function isBlank(line: Line): boolean {
  return isBlankLine(line.content);
}

export function extractRawText(lines: readonly Line[], start: number, end: number): string {
  return lines.slice(start, end).map((line) => line.raw).join("");
}

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
function parseBlocks(lines: readonly Line[]): Node[] {
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

const BULLET = /^([-*+])([ \t]+)(?=\S)/;
const ORDERED = /^(\d{1,9})([.)])([ \t]+)(?=\S)/;
const TASK = /^\[([ xX])\]([ \t]+)(?=\S)/;

interface Marker { readonly prefix: string; readonly kind: string; readonly order: number; readonly bullet: boolean }

function marker(content: string): Marker | undefined {
  const bullet = BULLET.exec(content);
  if (bullet) { return { prefix: bullet[0], kind: bullet[1]!, order: 0, bullet: true }; }
  const ordered = ORDERED.exec(content);
  return ordered ? { prefix: ordered[0], kind: ordered[2]!, order: Number(ordered[1]), bullet: false } : undefined;
}

function isListMarker(content: string): boolean {
  return marker(content) !== undefined;
}

function dedent(line: Line, width: number): Line {
  const indent = /^ */.exec(line.content)![0].length;
  const content = line.content.slice(Math.min(indent, width));
  return { content, raw: content + "\n" };
}

/** The lines of the item whose marker is on `start`, dedented under the marker, and the index after them. */
function itemLines(lines: readonly Line[], start: number, width: number): { body: Line[]; end: number } {
  const content = lines[start]!.content.slice(width);
  const body = [{ content, raw: content + "\n" }];
  const indented = (line: Line | undefined) => line !== undefined && !isBlank(line) && line.content.startsWith(" ".repeat(width));
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end]!;
    if (indented(line)) { body.push(dedent(line, width)); end++; continue; }
    if (isBlank(line)) {
      let next = end;
      while (next < lines.length && isBlank(lines[next]!)) { next++; }
      if (!indented(lines[next])) { break; }
      while (end < next) { body.push(dedent(lines[end++]!, width)); }
      continue;
    }
    // A lazy line continues the item's text, as in Pandoc.
    if (isListMarker(line.content)) { break; }
    body.push(dedent(line, 0));
    end++;
  }
  return { body, end };
}

function buildItem(body: Line[], prefix: string, isBullet: boolean, gap: string | null): Node {
  const task = isBullet ? TASK.exec(body[0]!.content) : null;
  if (!task) { return qmdSchema.nodes.list_item!.createChecked({ prefix, gap }, parseBlocks(body)); }
  const content = body[0]!.content.slice(task[0].length);
  const rest = [{ content, raw: content + "\n" }, ...body.slice(1)];
  const checked = task[1] !== " ";
  const attrs = { checked, mark: checked ? task[1]! : "x", prefix, space: task[2]!, gap };
  return qmdSchema.nodes.task_item!.createChecked(attrs, parseBlocks(rest));
}

/** Only the same bullet character or ordered delimiter continues a list. */
function readList(lines: readonly Line[], start: number): BodyBlock | undefined {
  const first = marker(lines[start]!.content);
  if (!first) { return undefined; }
  const items: { body: Line[]; prefix: string; gap: string | null }[] = [];
  let gap: string | null = null;
  let i = start;
  let end = start;
  for (;;) {
    const item = marker(lines[i]?.content ?? "");
    if (!item || item.kind !== first.kind) { break; }
    const read = itemLines(lines, i, item.prefix.length);
    items.push({ body: read.body, prefix: item.prefix, gap });
    end = read.end;
    i = end;
    while (i < lines.length && isBlank(lines[i]!)) { i++; }
    gap = lines.slice(end, i).map((line) => line.content + "\n").join("");
  }
  const build = (blockGap: string) => {
    const nodes = items.map((item) => buildItem(item.body, item.prefix, first.bullet, item.gap));
    return first.bullet
      ? qmdSchema.nodes.bullet_list!.createChecked({ marker: first.kind, gap: blockGap }, nodes)
      : qmdSchema.nodes.ordered_list!.createChecked({ order: first.order, delimiter: first.kind, gap: blockGap }, nodes);
  };
  return { end, build };
}

/** Serializes one block inside an item to lines ended with "\n". */
type BlockText = (node: Node) => string;

function itemContent(item: Node, blockText: BlockText): string {
  let content = "";
  item.forEach((child, _offset, index) => {
    const gap = child.attrs.gap as string | null;
    const isList = child.type.name === "bullet_list" || child.type.name === "ordered_list";
    content += (gap ?? (index === 0 || isList ? "" : "\n")) + blockText(child);
  });
  return content;
}

function canonicalPrefix(list: Node, index: number): string {
  if (list.type.name === "ordered_list") { return `${(list.attrs.order as number) + index}${list.attrs.delimiter as string} `; }
  return `${list.attrs.marker as string} `;
}

function serializeItem(item: Node, list: Node, index: number, blockText: BlockText): string {
  const prefix = (item.attrs.prefix as string | null) ?? canonicalPrefix(list, index);
  let head = prefix;
  if (item.type.name === "task_item") {
    const mark = item.attrs.checked ? (item.attrs.mark as string) : " ";
    head += `[${mark}]${(item.attrs.space as string | null) ?? " "}`;
  }
  const lines = itemContent(item, blockText).split("\n");
  lines.pop();
  const indent = " ".repeat(prefix.length);
  const [first = "", ...rest] = lines;
  return [head + first, ...rest.map((line) => (line ? indent + line : line))].join("\n") + "\n";
}

/** Returns the list's lines joined and ended with "\n"; item gaps use "\n". */
function serializeList(list: Node, blockText: BlockText): string {
  let text = "";
  list.forEach((item, _offset, index) => {
    text += ((item.attrs.gap as string | null) ?? "") + serializeItem(item, list, index, blockText);
  });
  return text;
}

function longestClosingRun(lines: string, fence: string): number {
  const char = fence[0] ?? "`";
  let longest = 0;
  for (const line of lines.split("\n")) {
    const run = /^(\S+) *$/.exec(line)?.[1];
    if (run && run.length >= fence.length && [...run].every((c) => c === char)) { longest = Math.max(longest, run.length); }
  }
  return longest;
}

/** Returns the cell's lines joined and ended with "\n". */
function serializeCodeCell(node: Node): string {
  const { lang, options, code, fence, info, close } = node.attrs as {
    lang: string | null; options: string; code: string; fence: string; info: string | null; close: string | null;
  };
  const run = longestClosingRun(options + code, fence);
  const langInfo = lang ? `{${lang}}` : "";
  if (run > 0) {
    const longer = (fence[0] ?? "`").repeat(run + 1);
    return `${longer}${langInfo}\n${options}${code}${longer}\n`;
  }
  return `${fence}${info ?? langInfo}\n${options}${code}${close ?? fence}\n`;
}

const VERBATIM: Record<string, string> = { output: "raw", raw_block: "text" };

function serializeHeading(node: Node): string {
  const inline = serializeInline(node.content);
  const space = node.attrs.space as string | null;
  const hashes = "#".repeat(node.attrs.level as number);
  return (inline === "" && space === null ? hashes : hashes + (space ?? " ") + inline) + "\n";
}

/** Returns the block's lines joined and ended with "\n"; verbatim blocks return their stored bytes. */
function blockText(node: Node): string {
  const verbatim = VERBATIM[node.type.name];
  if (verbatim) { return node.attrs[verbatim] as string; }
  switch (node.type.name) {
    case "paragraph": {
      const inline = serializeInline(node.content);
      return inline === "" ? "" : inline + "\n";
    }
    case "heading": return serializeHeading(node);
    case "math_display": {
      const label = node.attrs.label as string | null;
      return `$$${node.attrs.tex as string}$$${label ? ` {#${label}}` : ""}\n`;
    }
    case "code_cell": return serializeCodeCell(node);
    case "bullet_list":
    case "ordered_list": return serializeList(node, blockText);
    default: throw new RangeError(`cannot serialize block node "${node.type.name}"`);
  }
}

/** Returns one top-level block without its leading gap, every line ending with `eol`. */
export function serializeBlock(node: Node, eol: string): string {
  const text = blockText(node);
  // INVARIANT: top-level verbatim blocks already hold the source line endings.
  return node.type.name in VERBATIM || eol === "\n" ? text : text.replace(/\n/g, eol);
}
