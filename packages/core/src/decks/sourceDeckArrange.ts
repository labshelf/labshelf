// Slide structure edits that keep content: a sibling moved to any index, and a slide's items rearranged in one column, two columns or
// with its figures on one side, each item's source copied verbatim.
import { lineEnd } from "../text/index.js";
import type { SourceDeckNode, SourceDeckRange } from "./sourceDeckBlocks.js";
import type { SourceDeckChange } from "./sourceDeckEdit.js";
import { lineStart } from "./sourceDeckOutline.js";
import { blank } from "./sourceDeckScan.js";
import type { SourceDeckFormat } from "./sourceDecks.js";

/**
 * The text with sibling `from` moved so it ends up at index `to` of the reordered list. Each node takes its whole lines when it stands
 * alone on them (as deleteSourceDeckNode does); the text between siblings stays where it is. The cursor goes to the moved node's new
 * start. Null for the same index or an index out of range.
 */
export function moveSourceDeckNodeTo(text: string, siblings: readonly Pick<SourceDeckNode, "range">[], from: number, to: number): SourceDeckChange | null {
  const n = siblings.length;
  if (from === to || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= n || to >= n) return null;
  // Each slot is [line start, node end) and its line ending; the content moves, the slot's ending and the gap after it stay.
  const slots = siblings.map(({ range }) => {
    const start = lineStart(text, range[0]);
    const alone = /^[ \t]*$/.test(text.slice(start, range[0]));
    const after = alone ? /^[ \t]*(?:\r?\n|$)/.exec(text.slice(range[1])) : null;
    const begin = after ? start : range[0];
    return { begin, lead: range[0] - begin, end: range[1], close: range[1] + (after?.[0].length ?? 0) };
  });
  const order = siblings.map((_, index) => index);
  order.splice(to, 0, ...order.splice(from, 1));
  let out = text.slice(0, slots[0]!.begin); let cursor = 0;
  order.forEach((source, index) => {
    const slot = slots[index]!; const moved = slots[source]!;
    if (source === from) cursor = out.length + moved.lead;
    out += text.slice(moved.begin, moved.end) + text.slice(slot.end, slot.close);
    out += index + 1 < n ? text.slice(slot.close, slots[index + 1]!.begin) : text.slice(slot.close);
  });
  return { text: out, cursor };
}

export type SlideArrangement = "one-column" | "two-columns" | "figure-left" | "figure-right";

export const SLIDE_ARRANGEMENTS: readonly { id: SlideArrangement; label: string }[] = [
  { id: "one-column", label: "One column" },
  { id: "two-columns", label: "Two columns" },
  { id: "figure-left", label: "Figure left" },
  { id: "figure-right", label: "Figure right" },
];

const indentOf = (text: string, offset: number): string => /^[ \t]*/.exec(text.slice(lineStart(text, offset), offset))![0];

/** Whether `code` (comments blanked) holds only whitespace in [from, to) outside the given ranges. */
function blankOutside(code: string, from: number, to: number, ranges: readonly SourceDeckRange[]): boolean {
  let at = from;
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (code.slice(at, Math.max(at, Math.min(start, to))).trim()) return false;
    at = Math.max(at, end);
  }
  return !code.slice(at, Math.max(at, to)).trim();
}

/** The top-level comma-separated arguments of the first `(…)` in `text` from `open`, and the text after its `)`; null when unclosed. */
function typstArgs(text: string, open: number): { args: string[]; rest: string } | null {
  const args: string[] = []; let depth = 0; let segment = open + 1;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch) && --depth === 0) { args.push(text.slice(segment, i)); return { args, rest: text.slice(i + 1) }; }
    else if (ch === "," && depth === 1) { args.push(text.slice(segment, i)); segment = i + 1; }
  }
  return null;
}

/** Whether a `columns` node holds nothing but its columns' items: its wrapper syntax and named or numeric arguments, no stray text. */
function columnsClean(format: SourceDeckFormat, code: string, node: SourceDeckNode): boolean {
  const columns = node.children ?? [];
  for (const column of columns) {
    const body = column.bodyRange ?? column.range;
    if (!blankOutside(code, body[0], body[1], (column.children ?? []).map((child) => child.range))) return false;
  }
  let wrapper = ""; let at = node.range[0];
  for (const column of columns) { wrapper += code.slice(at, column.range[0]); at = column.range[1]; }
  wrapper = (wrapper + code.slice(at, node.range[1])).trim();
  if (format === "latex") return /^\\begin\s*\{columns\}\s*(?:\[[^\]]*\])?\s*\\end\s*\{columns\}$/.test(wrapper);
  wrapper = wrapper.replace(/#colbreak\([^)]*\)/g, "");
  const head = /^#(?:grid|columns)\s*(?=\()/.exec(wrapper);
  const parsed = head ? typstArgs(wrapper, head[0].length) : null;
  return !!parsed && /^[\s[\],]*(?:<[\w:.-]+>)?\s*$/.test(parsed.rest)
    && parsed.args.every((arg) => !arg.trim() || /^\s*[A-Za-z_][\w-]*\s*:/.test(arg) || /^\s*\d+\s*$/.test(arg));
}

/** The item's source with its later lines moved from its own indentation to `indent`. */
function reindent(text: string, item: SourceDeckNode, indent: string): string {
  const own = indentOf(text, item.range[0]);
  return text.slice(item.range[0], item.range[1]).split("\n")
    .map((line, index) => (index === 0 ? line : !line.trim() ? "" : line.startsWith(own) ? indent + line.slice(own.length) : line)).join("\n");
}

function columnsSource(format: SourceDeckFormat, indent: string, left: string[], right: string[]): string {
  const inner = `${indent}    `;
  const cell = (items: string[]): string => items.map((item) => inner + item).join("\n\n");
  if (format === "latex") {
    const column = (items: string[]): string => `${indent}  \\begin{column}{0.48\\textwidth}\n${cell(items)}\n${indent}  \\end{column}\n`;
    return `\\begin{columns}[T]\n${column(left)}${column(right)}${indent}\\end{columns}`;
  }
  const column = (items: string[]): string => `${indent}  [\n${cell(items)}\n${indent}  ],\n`;
  return `#grid(columns: (1fr, 1fr), gutter: 1em,\n${column(left)}${column(right)}${indent})`;
}

/**
 * The slide's content items (its element children, those of any `columns` child flattened in) laid out again: one after another, in two
 * columns (first half left), or with the figures on one side. The title stays as written and each item's text is copied verbatim.
 * Null when the slide has no items, figure-left or figure-right lacks a figure or anything else, or the body holds non-whitespace text
 * outside every child (comments count as whitespace), so nothing is ever lost.
 */
export function arrangeSourceSlide(format: SourceDeckFormat, text: string, slide: SourceDeckNode, arrangement: SlideArrangement): SourceDeckChange | null {
  const children = slide.children ?? [];
  if (!slide.bodyRange || !children.length) return null;
  const code = blank(format, text);
  const [bodyStart, bodyEnd] = slide.bodyRange;
  const title: SourceDeckRange[] = slide.titleRange && slide.titleRange[0] >= bodyStart && slide.titleRange[1] <= bodyEnd
    ? [[lineStart(text, slide.titleRange[0]), lineEnd(text, slide.titleRange[1])]] : [];
  if (!blankOutside(code, bodyStart, bodyEnd, [...title, ...children.map((child) => child.range)])) return null;
  if (children.some((child) => child.kind === "columns" && !columnsClean(format, code, child))) return null;
  const items = children.flatMap((child) => (child.kind === "columns" ? (child.children ?? []).flatMap((column) => column.children ?? []) : [child]));
  if (!items.length) return null;
  const from = children[0]!.range[0]; const to = children[children.length - 1]!.range[1];
  const indent = indentOf(text, from);
  let body: string;
  if (arrangement === "one-column") body = items.map((item) => reindent(text, item, indent)).join(`\n\n${indent}`);
  else {
    const source = (list: SourceDeckNode[]): string[] => list.map((item) => reindent(text, item, `${indent}    `));
    let left: SourceDeckNode[]; let right: SourceDeckNode[];
    if (arrangement === "two-columns") { const half = Math.ceil(items.length / 2); left = items.slice(0, half); right = items.slice(half); }
    else {
      const figures = items.filter((item) => item.kind === "figure"); const others = items.filter((item) => item.kind !== "figure");
      if (!figures.length || !others.length) return null;
      [left, right] = arrangement === "figure-left" ? [figures, others] : [others, figures];
    }
    body = columnsSource(format, indent, source(left), source(right));
  }
  return { text: text.slice(0, from) + body + text.slice(to), cursor: from };
}
