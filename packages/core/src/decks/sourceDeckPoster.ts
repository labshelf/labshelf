// The layout of a compiled poster (tikzposter, beamerposter, Typst): its column ratios, outer margin, section gap and orientation read
// from the source, block moves to any column and index, and each layout change written as one SourceDeckChange that keeps the content.
import { round2 } from "./posterSections.js";
import { moveSourceDeckNodeTo } from "./sourceDeckArrange.js";
import { readSourceDeckBlocks, type SourceDeckNode, type SourceDeckRange } from "./sourceDeckBlocks.js";
import { BEAMERPOSTER, DOCUMENT_CLASS, type SourceDeckChange } from "./sourceDeckEdit.js";
import { sameSourcePath } from "./sourceDeckFiles.js";
import { balancedGroup, lineStart } from "./sourceDeckOutline.js";
import type { DeckOverflowMark } from "./sourceDeckOverflow.js";
import { addArg, formatSourceLength, named, optionsOf, optionValue, parseSourceLength, setOption, slice, splice, splitArgs, typstPage, type Arg, type Options } from "./sourceDeckPosterLengths.js";
import { blank, readSourceDeckColumnWidth } from "./sourceDeckScan.js";
import { detectSourceDeckKind, type SourceDeckFormat } from "./sourceDecks.js";

/** The layout of a compiled poster; lengths in mm, null where the source does not say it in a form LabShelf reads. */
export interface SourcePosterLayout { format: SourceDeckFormat; template: "tikzposter" | "beamerposter" | "typst"; ratios: number[] | null; columnsCall: "columns" | "grid" | null; margin: number | null; gap: number | null; landscape: boolean | null }

type Range = SourceDeckRange;
interface TypstCall { name: "columns" | "grid"; start: number; args: Range; end: number }

// tikzposter's own defaults for its spacing options, in mm.
const TIKZ_DEFAULT = { margin: 0, colspace: 15 };
// ISO A paper sizes, portrait width and height in mm.
const ISO_A: Record<string, [number, number]> = { a0: [841, 1189], a1: [594, 841], a2: [420, 594], a3: [297, 420], a4: [210, 297] };
const COLUMN_HEADER = /\\column\b|\\begin\s*\{column\}/y;
const FR_TRACK = /^(\d+(?:\.\d+)?|\.\d+)fr$/;

const validLength = (value: number | undefined): boolean => value === undefined || (Number.isFinite(value) && value >= 0);

/** The poster columns of the tree. */
const posterColumns = (format: SourceDeckFormat, text: string): SourceDeckNode[] => readSourceDeckBlocks(format, "poster", text).filter((node) => node.kind === "column");
const blocksOf = (column: SourceDeckNode): SourceDeckNode[] => (column.children ?? []).filter((child) => child.kind === "block");

/** The `#columns(…)[…]` or `#grid(…)` call that holds the poster's first column. */
function typstCall(text: string, columns: readonly SourceDeckNode[]): TypstCall | null {
  const first = columns[0]?.range[0];
  if (first === undefined) return null;
  const code = blank("typst", text); let found: TypstCall | null = null;
  for (const m of code.matchAll(/#(columns|grid)\(/g)) {
    if (m.index >= first) break;
    const group = balancedGroup(code, m.index + m[0].length - 1);
    if (!group) continue;
    const content = code[group[1]] === "[" ? balancedGroup(code, group[1]) : null;
    const end = content ? content[1] : group[1];
    if (end > first) found = { name: m[1] as "columns" | "grid", start: m.index, args: [group[0], group[1] - 1], end };
  }
  return found;
}

/** The ratios a Typst call says: fr tracks or a track count of a grid, the column count of #columns; null for anything else. */
function typstRatios(text: string, call: TypstCall, args: readonly Arg[]): number[] | null {
  if (call.name === "columns") {
    const count = named(args, "count") ?? args.find((arg) => arg.name === null && /^\d+$/.test(slice(text, arg.range)));
    const n = count ? Number(slice(text, count.value)) : 2;
    return n > 0 ? Array.from({ length: n }, () => 1) : null;
  }
  const tracks = named(args, "columns");
  if (!tracks) return null;
  const value = slice(text, tracks.value);
  if (/^\d+$/.test(value)) return Number(value) > 0 ? Array.from({ length: Number(value) }, () => 1) : null;
  if (!value.startsWith("(") || !value.endsWith(")")) return null;
  const items = splitArgs(blank("typst", text), tracks.value[0] + 1, tracks.value[1] - 1).map((arg) => FR_TRACK.exec(slice(text, arg.range)));
  return items.length && items.every(Boolean) ? items.map((m) => Number(m![1])) : null;
}

/** A Typst page's orientation: width against height, else `flipped` of a named paper; null when the page says neither. */
function typstLandscape(text: string, args: readonly Arg[]): boolean | null {
  const width = named(args, "width"); const height = named(args, "height");
  const w = width && parseSourceLength(slice(text, width.value)); const h = height && parseSourceLength(slice(text, height.value));
  if (typeof w === "number" && typeof h === "number") return w > h;
  if (!paperOf(text, args)) return null;
  const flipped = named(args, "flipped");
  return flipped ? slice(text, flipped.value) === "true" : false;
}

const paperOf = (text: string, args: readonly Arg[]): string | null => {
  const paper = named(args, "paper") ?? args.find((arg) => arg.name === null && text[arg.range[0]] === '"');
  return paper ? slice(text, paper.value).replace(/^"|"$/g, "") : null;
};

const lengthOption = (options: Options | null, key: string, fallback: number): number | null => {
  const value = optionValue(options, key);
  return value === undefined ? fallback : parseSourceLength(value);
};

function latexTemplate(text: string): "tikzposter" | "beamerposter" | null {
  const code = blank("latex", text);
  if (DOCUMENT_CLASS.exec(code)?.[2] === "tikzposter") return "tikzposter";
  return BEAMERPOSTER.test(code) ? "beamerposter" : null;
}

function readLayout(format: SourceDeckFormat, text: string): SourcePosterLayout | null {
  if (detectSourceDeckKind(format, text) === "talk") return null;
  const columns = posterColumns(format, text);
  if (format === "latex") {
    const template = latexTemplate(text);
    if (!template || !columns.some((column) => { COLUMN_HEADER.lastIndex = column.range[0]; return COLUMN_HEADER.test(text); })) return null;
    const widths = columns.map((column) => column.props.columnWidth);
    const ratios = widths.every((width): width is number => width !== undefined) ? widths : null;
    if (template === "beamerposter") {
      const orientation = optionValue(optionsOf(text, BEAMERPOSTER), "orientation");
      return { format, template, ratios, columnsCall: null, margin: null, gap: null, landscape: orientation?.trim() === "landscape" };
    }
    const options = optionsOf(text, DOCUMENT_CLASS);
    const landscape = options?.items.some((item) => item.value === "landscape") ?? false;
    return { format, template, ratios, columnsCall: null, margin: lengthOption(options, "margin", TIKZ_DEFAULT.margin), gap: lengthOption(options, "colspace", TIKZ_DEFAULT.colspace), landscape };
  }
  const call = typstCall(text, columns);
  if (!call) return null;
  const args = splitArgs(blank("typst", text), call.args[0], call.args[1]);
  const gutter = named(args, "gutter");
  const page = typstPage(text);
  const margin = page && named(page.args, "margin");
  return {
    format, template: "typst", ratios: typstRatios(text, call, args), columnsCall: call.name,
    margin: margin ? parseSourceLength(slice(text, margin.value)) : null,
    gap: gutter ? parseSourceLength(slice(text, gutter.value)) : call.name === "grid" ? 0 : null,
    landscape: page ? typstLandscape(text, page.args) : null,
  };
}

/** The layout of a LaTeX or Typst poster; null for a talk, an unknown template or a poster with no column structure. Never throws. */
export function readSourcePosterLayout(format: SourceDeckFormat, text: string): SourcePosterLayout | null {
  try { return readLayout(format, text); } catch { return null; }
}

/** A node's whole lines when it stands alone on them: [start, end after its line break), and the indentation before it. */
function slotOf(text: string, range: Range): { start: number; end: number; indent: string; alone: boolean } {
  const ls = lineStart(text, range[0]); const alone = /^[ \t]*$/.test(text.slice(ls, range[0]));
  const after = alone ? /^[ \t]*(?:\r?\n|$)/.exec(text.slice(range[1])) : null;
  return { start: alone ? ls : range[0], end: range[1] + (after?.[0].length ?? 0), indent: alone ? text.slice(ls, range[0]) : "", alone };
}

/** The node's text with its indentation `from` re-based to `to` on every line. */
const reindent = (body: string, from: string, to: string): string =>
  body.split("\n").map((line, n) => (n === 0 ? to + line : line && line.startsWith(from) ? to + line.slice(from.length) : line)).join("\n");

/**
 * The text with the block at `from` moved to before the `to.index`-th block of column `to.column` (clamped: past the end goes after the
 * last block); within one column `to.index` is the block's final index. Whole lines move, re-indented to the target's. Null when an
 * index is out of range or the block would stay where it is.
 */
export function moveSourcePosterBlock(format: SourceDeckFormat, text: string, from: { column: number; index: number }, to: { column: number; index: number }): SourceDeckChange | null {
  if (![from.column, from.index, to.column, to.index].every(Number.isInteger)) return null;
  const columns = posterColumns(format, text);
  const source = columns[from.column]; const target = columns[to.column];
  if (!source || !target || from.column < 0 || to.column < 0) return null;
  const blocks = blocksOf(source); const node = blocks[from.index];
  if (!node || from.index < 0) return null;
  const targets = blocksOf(target);
  const k = Math.max(0, Math.min(to.index, targets.length));
  if (source === target) return moveSourceDeckNodeTo(text, blocks, from.index, Math.min(k, blocks.length - 1));
  const slot = slotOf(text, node.range);
  const anchor = targets[Math.min(k, targets.length - 1)];
  const indent = anchor ? slotOf(text, anchor.range).indent : slot.indent;
  const moved = reindent(text.slice(node.range[0], node.range[1]), slot.indent, indent);
  let p: number; let insert: string; let lead: number;
  if (anchor && k < targets.length) {
    const at = slotOf(text, anchor.range);
    [p, insert, lead] = at.alone ? [at.start, `${moved}\n`, 0] : [anchor.range[0], `\n${moved}\n`, 1];
  } else if (anchor) [p, insert, lead] = [anchor.range[1], `\n${moved}`, 1];
  else {
    p = target.bodyRange?.[0] ?? target.range[0];
    const ls = lineStart(text, p); const restBlank = /^[ \t]*(?:\r?\n|$)/.test(text.slice(p));
    if (restBlank) [insert, lead] = [`\n${moved}`, 1];
    else if (/^[ \t]*$/.test(text.slice(ls, p))) [p, insert, lead] = [ls, `${moved}\n`, 0];
    else [insert, lead] = [`\n${moved}\n`, 1];
  }
  if (p > slot.start && p < slot.end) return null;
  if (p >= slot.end) return { text: text.slice(0, slot.start) + text.slice(slot.end, p) + insert + text.slice(p), cursor: p - (slot.end - slot.start) + lead };
  return { text: text.slice(0, p) + insert + text.slice(p, slot.start) + text.slice(slot.end), cursor: p + lead };
}

/** A number written with at most 2 decimals and no trailing zeros. */
const decimal = (value: number): string => String(round2(value));

/**
 * The text with one positive ratio per column written: LaTeX fractions summing to 1 (the last column takes the remainder), Typst
 * grid fr tracks summing to the column count. A Typst `#columns` call is rewritten as a `#grid` with one cell per column. Null when
 * the count or a ratio is wrong or the poster has no column structure.
 */
export function setSourcePosterRatios(format: SourceDeckFormat, text: string, ratios: readonly number[]): SourceDeckChange | null {
  const layout = readSourcePosterLayout(format, text);
  const columns = posterColumns(format, text);
  if (!layout || ratios.length !== columns.length || !ratios.every((ratio) => Number.isFinite(ratio) && ratio > 0)) return null;
  const sum = ratios.reduce((total, ratio) => total + ratio, 0);
  if (format === "latex") {
    const forms = columns.map((column) => readSourceDeckColumnWidth("latex", text, column.range));
    if (forms.some((form) => !form)) return null;
    const fractions = ratios.map((ratio) => round2(ratio / sum));
    fractions[fractions.length - 1] = round2(1 - fractions.slice(0, -1).reduce((total, value) => total + value, 0));
    let out = text;
    for (let n = forms.length - 1; n >= 0; n--) out = splice(out, forms[n]!.range, decimal(fractions[n]!)).text;
    return { text: out, cursor: forms[0]!.range[0] };
  }
  const call = typstCall(text, columns)!;
  const tracks = ratios.map((ratio) => `${decimal((ratio * ratios.length) / sum)}fr`);
  const tuple = tracks.length === 1 ? `(${tracks[0]},)` : `(${tracks.join(", ")})`;
  const args = splitArgs(blank("typst", text), call.args[0], call.args[1]);
  if (call.name === "grid") {
    const current = named(args, "columns");
    return current ? splice(text, current.value, tuple) : addArg(text, call.args, args, "columns", tuple);
  }
  const gutter = named(args, "gutter");
  const kept = args.filter((arg) => arg.name !== null && arg.name !== "gutter" && arg.name !== "count").map((arg) => slice(text, arg.range));
  // Without a gutter #columns leaves 4% between its columns, so the grid keeps that.
  const head = [`columns: ${tuple}`, `gutter: ${gutter ? slice(text, gutter.value) : "4%"}`, ...kept].join(", ");
  const cells = columns.map((column) => {
    const [s, e] = column.bodyRange ?? column.range;
    const body = s < e ? text.slice(slotOf(text, [s, e]).start, e) : "";
    return `  [\n${body ? `${body}\n` : ""}  ],\n`;
  });
  return splice(text, [call.start, call.end], `#grid(${head},\n${cells.join("")})`);
}

/** The page width in mm: Typst `#set page` width or named paper, LaTeX tikzposter paper option or beamerposter size. */
function pageWidth(format: SourceDeckFormat, text: string, layout: SourcePosterLayout): number | null {
  const iso = (paper: string | null | undefined, landscape: boolean): number | null => {
    const size = paper ? ISO_A[paper.trim().toLowerCase()] : undefined;
    return size ? (landscape ? size[1] : size[0]) : null;
  };
  if (format === "typst") {
    const page = typstPage(text);
    if (!page) return null;
    const width = named(page.args, "width");
    if (width) return parseSourceLength(slice(text, width.value));
    return iso(paperOf(text, page.args), layout.landscape === true);
  }
  if (layout.template === "beamerposter") return iso(optionValue(optionsOf(text, BEAMERPOSTER), "size"), layout.landscape === true);
  const paper = optionsOf(text, DOCUMENT_CLASS)?.items.map((item) => /^(a\d)paper$/.exec(item.value)?.[1]).find(Boolean);
  return iso(paper, layout.landscape === true);
}

/**
 * The text with `delta` mm of width moved from column `gap + 1` to column `gap` over the column area (page width minus twice the
 * margin and the gaps); each column keeps at least 10% of the area. Null when the gap is out of range or the page width is unknown.
 */
export function resizeSourcePosterGap(format: SourceDeckFormat, text: string, gap: number, delta: number): SourceDeckChange | null {
  const layout = readSourcePosterLayout(format, text);
  const ratios = layout?.ratios;
  if (!layout || !ratios || !Number.isInteger(gap) || gap < 0 || gap >= ratios.length - 1 || !Number.isFinite(delta)) return null;
  const width = pageWidth(format, text, layout);
  if (width === null) return null;
  const area = width - 2 * (layout.margin ?? 0) - (ratios.length - 1) * (layout.gap ?? 0);
  if (!(area > 0)) return null;
  const sum = ratios.reduce((total, ratio) => total + ratio, 0);
  const widths = ratios.map((ratio) => (ratio / sum) * area);
  const pair = widths[gap]! + widths[gap + 1]!; const floor = 0.1 * area;
  widths[gap] = Math.max(floor, Math.min(pair - floor, widths[gap]! + delta));
  widths[gap + 1] = pair - widths[gap]!;
  return setSourcePosterRatios(format, text, widths);
}

/** The Typst text with argument `name` of the group `inner` set to a length in the unit it had (else `unit`); null for a non-length value. */
function setTypstLength(text: string, inner: Range, args: readonly Arg[], name: string, mm: number, unit: "mm" | "cm"): SourceDeckChange | null {
  const arg = named(args, name);
  if (!arg) return addArg(text, inner, args, name, formatSourceLength(mm, unit));
  const value = slice(text, arg.value);
  if (value.startsWith("(")) return null;
  return splice(text, arg.value, formatSourceLength(mm, /cm$/.test(value) ? "cm" : "mm"));
}

/**
 * The text with the outer margin and/or section gap (mm) written: tikzposter `margin`, `colspace` and `blockverticalspace` options,
 * Typst `margin:` of `#set page` and `gutter:` of the columns call. Null for beamerposter, a value that is negative or not finite,
 * a Typst dictionary margin, or a poster with no column structure.
 */
export function setSourcePosterSpacing(format: SourceDeckFormat, text: string, change: { margin?: number; gap?: number }): SourceDeckChange | null {
  const { margin, gap } = change;
  if ((margin === undefined && gap === undefined) || !validLength(margin) || !validLength(gap)) return null;
  const layout = readSourcePosterLayout(format, text);
  if (!layout || layout.template === "beamerposter") return null;
  let result: SourceDeckChange | null = { text, cursor: 0 };
  if (format === "latex") {
    const edits: Array<[RegExp, string]> = [];
    if (margin !== undefined) edits.push([/^margin\s*=/, `margin=${formatSourceLength(margin, "mm")}`]);
    if (gap !== undefined) edits.push([/^colspace\s*=/, `colspace=${formatSourceLength(gap, "mm")}`], [/^blockverticalspace\s*=/, `blockverticalspace=${formatSourceLength(gap, "mm")}`]);
    for (const [test, value] of edits) result = result && setOption(result.text, DOCUMENT_CLASS, test, value);
    return result;
  }
  const page = typstPage(text);
  const pageMargin = page && named(page.args, "margin");
  const unit = pageMargin && /cm$/.test(slice(text, pageMargin.value)) ? "cm" : "mm";
  if (margin !== undefined) {
    result = page ? setTypstLength(text, page.inner, page.args, "margin", margin, unit) : splice(text, [0, 0], `#set page(margin: ${formatSourceLength(margin, "mm")})\n`);
    if (!result) return null;
  }
  if (gap !== undefined) {
    const call = typstCall(result.text, posterColumns(format, result.text));
    if (!call) return null;
    result = setTypstLength(result.text, call.args, splitArgs(blank("typst", result.text), call.args[0], call.args[1]), "gutter", gap, unit);
  }
  return result;
}

/**
 * The text with the poster's orientation switched: the tikzposter `portrait`/`landscape` option, the beamerposter `orientation=`,
 * or the Typst page's width and height swapped (`flipped:` toggled for a named paper). Ratios, spacing and content stay.
 */
export function switchSourcePosterOrientation(format: SourceDeckFormat, text: string): SourceDeckChange | null {
  const layout = readSourcePosterLayout(format, text);
  if (!layout) return null;
  const next = layout.landscape ? "portrait" : "landscape";
  if (layout.template === "tikzposter") return setOption(text, DOCUMENT_CLASS, /^(?:portrait|landscape)$/, next);
  if (layout.template === "beamerposter") return setOption(text, BEAMERPOSTER, /^orientation\s*=/, `orientation=${next}`);
  const page = typstPage(text);
  if (!page) return null;
  const width = named(page.args, "width"); const height = named(page.args, "height");
  if (width && height) {
    const [first, second] = width.value[0] < height.value[0] ? [width, height] : [height, width];
    const a = slice(text, first.value); const b = slice(text, second.value);
    const swapped = splice(text, second.value, a).text;
    return splice(swapped, first.value, b);
  }
  if (!paperOf(text, page.args)) return null;
  const flipped = named(page.args, "flipped");
  return flipped ? splice(text, flipped.value, layout.landscape ? "false" : "true") : addArg(text, page.inner, page.args, "flipped", "true");
}

/**
 * The `c.b` keys (column and child index, 0-based, as the linked view keys poster blocks) of the blocks that overflow: for LaTeX those
 * holding an Overfull \vbox mark of their file; for Typst (mainPath ending in .typ) every block of the last column when the build
 * took more than one page.
 */
export function overflowingPosterBlocks(tree: readonly SourceDeckNode[], marks: readonly DeckOverflowMark[], mainPath: string, pages: number): string[] {
  const columns = tree.filter((node) => node.kind === "column");
  const keys: string[] = [];
  const typst = mainPath.endsWith(".typ");
  columns.forEach((column, c) => {
    if (typst && (pages <= 1 || c !== columns.length - 1)) return;
    (column.children ?? []).forEach((child, b) => {
      if (child.kind !== "block") return;
      const file = child.file ?? mainPath;
      if (typst || marks.some((mark) => child.line <= mark.line && mark.line <= child.endLine && sameSourcePath(mark.file, file, "/"))) keys.push(`${c}.${b}`);
    });
  });
  return keys;
}
