// Reads a fenced code block into a code cell, splitting its `#|` option lines from its code.
// CONTRACT: documents/contracts/qmd-items.md#format
import { codeFences, unclosedCodeFences } from "../../items/index.js";
import { qmdSchema } from "../schema/index.js";
import { rawText, type BlockSpan, type Line } from "./blockLines.js";

const FENCE_START = /^ {0,3}(?:`{3}|~{3})/;
const OPENER = /^(`{3,}|~{3,})(.*)$/;
const LANG = /^[ \t]*(?:\{([^\s{}.#=]+)[^}]*\}|([^\s{`]+))/;

/** A closed fence becomes a code cell; an indented one stays raw; an unclosed one turns the rest of its container raw. */
export function readCodeCell(lines: readonly Line[], start: number): BlockSpan | undefined {
  const first = lines[start]!.content;
  if (!FENCE_START.test(first)) { return undefined; }
  const contents = lines.slice(start).map((line) => line.content);
  const close = codeFences(contents).get(0);
  if (close === undefined && unclosedCodeFences(contents)[0] !== 0) { return undefined; }
  // TRAP: Pandoc runs an unclosed fence to the end of its container, so nothing after it can be read as blocks.
  const end = close === undefined ? lines.length : start + close + 1;
  const opener = OPENER.exec(first);
  if (close === undefined || !opener) {
    const text = rawText(lines, start, end);
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
