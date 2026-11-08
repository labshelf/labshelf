// Source lengths of a compiled poster: `<number><unit>` (mm, cm, in, pt) read to millimetres and millimetres written back as mm or cm,
// and the argument lists they sit in: Typst call arguments (`#set page(…)`, `#grid(…)`) and LaTeX `[…]` options, read and rewritten.
import { round2 } from "./posterSections.js";
import type { SourceDeckRange } from "./sourceDeckBlocks.js";
import type { SourceDeckChange } from "./sourceDeckEdit.js";
import { balancedGroup } from "./sourceDeckOutline.js";
import { blank } from "./sourceDeckScan.js";

type Range = SourceDeckRange;
/** One argument of a call: its name when it is `name: value`, its whole range and the range of its value. */
export interface Arg { name: string | null; range: Range; value: Range }

export const splice = (text: string, [from, to]: Range, value: string): SourceDeckChange => ({ text: text.slice(0, from) + value + text.slice(to), cursor: from + value.length });
export const slice = (text: string, [from, to]: Range): string => text.slice(from, to);

const MM_PER: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72 };

/** A `<number><unit>` length in mm rounded to 2 decimals (pt is 1/72 in); null for any other unit (em, fr, %), a macro or no number. */
export function parseSourceLength(value: string): number | null {
  const m = /^\s*(\d+(?:\.\d*)?|\.\d+)\s*(mm|cm|in|pt)\s*$/.exec(value);
  if (!m) return null;
  const mm = round2(Number(m[1]) * MM_PER[m[2]!]!);
  return Number.isFinite(mm) ? mm : null;
}

/** Millimetres written as `<n>mm` or `<n>cm` with at most 2 decimals and no trailing zeros. */
export function formatSourceLength(mm: number, unit: "mm" | "cm"): string {
  return `${round2(unit === "cm" ? mm / 10 : mm)}${unit}`;
}

/** The top-level arguments between `from` and `to`, split at commas outside brackets and strings; content blocks are skipped whole. */
export function splitArgs(code: string, from: number, to: number): Arg[] {
  const args: Arg[] = []; let segment = from; let depth = 0;
  const push = (end: number): void => {
    let s = segment; let e = end;
    while (s < e && /\s/.test(code[s]!)) s++;
    while (e > s && /\s/.test(code[e - 1]!)) e--;
    if (s >= e) return;
    const named = /^([A-Za-z_][\w-]*)\s*:\s*/.exec(code.slice(s, e));
    args.push({ name: named ? named[1]! : null, range: [s, e], value: [s + (named ? named[0].length : 0), e] });
  };
  for (let k = from; k < to; k++) {
    const ch = code[k]!;
    if (ch === "\\") { k++; continue; }
    if (ch === '"') { const q = code.indexOf('"', k + 1); k = q === -1 || q > to ? to : q; continue; }
    if (ch === "[") { const group = balancedGroup(code, k); k = group ? group[1] - 1 : to; continue; }
    if (ch === "(" || ch === "{") depth++;
    else if (ch === ")" || ch === "}") depth--;
    else if (ch === "," && depth === 0) { push(k); segment = k + 1; }
  }
  push(to);
  return args;
}

export const named = (args: readonly Arg[], name: string): Arg | undefined => args.find((arg) => arg.name === name);

/** The text with `name: value` added to the arguments `args` of the group `inner`: after the last argument before the first content block. */
export function addArg(text: string, inner: Range, args: readonly Arg[], name: string, value: string): SourceDeckChange {
  const content = args.findIndex((arg) => arg.name === null && text[arg.range[0]] === "[");
  const before = content === -1 ? args[args.length - 1] : args[content - 1];
  if (before) return splice(text, [before.range[1], before.range[1]], `, ${name}: ${value}`);
  return splice(text, [inner[0], inner[0]], args.length ? `${name}: ${value}, ` : `${name}: ${value}`);
}

/** The first `#set page(…)` as the range inside its parentheses and its arguments. */
export function typstPage(text: string): { inner: Range; args: Arg[] } | null {
  const code = blank("typst", text);
  const m = /#set\s+page\s*\(/.exec(code);
  const group = m ? balancedGroup(code, m.index + m[0].length - 1) : null;
  if (!group) return null;
  const inner: Range = [group[0], group[1] - 1];
  return { inner, args: splitArgs(code, inner[0], inner[1]) };
}

/** The `[…]` options of a LaTeX command match as items with their ranges, and where a new option goes. */
export interface Options { items: Array<{ value: string; range: Range }>; group: Range | null; insertAt: number }
export function optionsOf(text: string, re: RegExp): Options | null {
  const m = re.exec(blank("latex", text));
  if (!m) return null;
  if (!m[1]) return { items: [], group: null, insertAt: m.index + m[0].indexOf("{") };
  const open = m.index + m[0].indexOf("["); const inner: Range = [open + 1, open + m[1].length - 1];
  return { items: splitArgs(text, inner[0], inner[1]).map((arg) => ({ value: slice(text, arg.range), range: arg.range })), group: inner, insertAt: inner[1] };
}

/** The text with the first option matching `test` replaced by `value`, or `value` appended. */
export function setOption(text: string, re: RegExp, test: RegExp, value: string): SourceDeckChange | null {
  const options = optionsOf(text, re);
  if (!options) return null;
  const item = options.items.find((option) => test.test(option.value));
  if (item) return splice(text, item.range, value);
  if (!options.group) return splice(text, [options.insertAt, options.insertAt], `[${value}]`);
  const last = options.items[options.items.length - 1];
  if (!last) return splice(text, [options.insertAt, options.insertAt], value);
  const sep = slice(text, options.group).includes(", ") || options.items.length < 2 ? ", " : ",";
  return splice(text, [last.range[1], last.range[1]], `${sep}${value}`);
}

export const optionValue = (options: Options | null, key: string): string | undefined =>
  options?.items.map((item) => new RegExp(`^${key}\\s*=\\s*(.*)$`).exec(item.value)?.[1]).find((value) => value !== undefined);
