// The shared base of the source deck block parser (context, node builders, Typst scanning) and the property readers its leaves use.
import { removeComments } from "../latex/index.js";
import { lineAt } from "../text/index.js";
import type { SourceDeckAlign, SourceDeckNode, SourceDeckNodeKind, SourceDeckPropForm, SourceDeckProps, SourceDeckRange } from "./sourceDeckBlocks.js";
import { balancedGroup, cleanTitle, skipSpace } from "./sourceDeckOutline.js";
import type { SourceDeckFormat } from "./sourceDecks.js";

export type Mode = "poster" | "block" | "talk";
/** The parse state; `element` reads one element of the format at an offset, or "stop" at a heading that ends a poster block. */
export interface Ctx { format: SourceDeckFormat; text: string; code: string; limit: number; element: (ctx: Ctx, i: number, to: number, mode: Mode) => Step | "stop" }
export interface Step { node: SourceDeckNode | null; end: number }
/** A construct starting at `at` that does not close before the parse limit. */
export class Unclosed { constructor(readonly at: number) {} }

export const at = (re: RegExp, text: string, offset: number): RegExpExecArray | null => { re.lastIndex = offset; return re.exec(text); };
export const trimEnd = (text: string, from: number, offset: number): number => { let i = offset; while (i > from && /\s/.test(text[i - 1]!)) i--; return i; };
export const lineEndIn = (text: string, offset: number, to: number): number => { const n = text.indexOf("\n", offset); return n === -1 || n > to ? to : n; };

/** Walks Typst source from `from`, skipping escapes, strings and raw on one line, raw blocks and math; returns where `visit` said stop, or -1. */
export function walkTypst(code: string, from: number, visit: (ch: string, i: number) => boolean): number {
  for (let i = from; i < code.length; i++) {
    const ch = code[i]!;
    if (ch === "\\") { i++; continue; }
    if (i > from && (ch === '"' || ch === "`" || ch === "$")) {
      const fence = code.startsWith("```", i) ? "```" : ch;
      const close = ch === "$" ? mathClose(code, i + 1) : code.indexOf(fence, i + fence.length);
      const newline = code.indexOf("\n", i);
      if (close !== -1 && (fence.length === 3 || ch === "$" || newline === -1 || close < newline)) { i = close + fence.length - 1; continue; }
    }
    if (visit(ch, i)) return i;
  }
  return -1;
}

export function mathClose(code: string, from: number): number {
  for (let i = from; i < code.length; i++) { if (code[i] === "\\") i++; else if (code[i] === "$") return i; }
  return -1;
}

function typstGroup(code: string, open: number): [number, number] | null {
  const opener = code[open]!; const closer = opener === "[" ? "]" : opener === "(" ? ")" : "}";
  let depth = 0;
  const end = walkTypst(code, open, (ch) => (ch === opener ? (depth++, false) : ch === closer && --depth === 0));
  return end === -1 ? null : [open + 1, end + 1];
}

/** The Typst source with line and block comments blanked to spaces, offsets kept; strings and raw text are kept as they are. */
function blankTypst(text: string): string {
  let out = ""; let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "\\") { out += text.slice(i, i + 2); i += 2; continue; }
    if (ch === '"' || ch === "`") {
      const fence = text.startsWith("```", i) ? "```" : ch; const close = text.indexOf(fence, i + fence.length);
      if (close !== -1 && (fence.length === 3 || close < lineEndIn(text, i, text.length))) { out += text.slice(i, close + fence.length); i = close + fence.length; continue; }
    }
    const comment = text.startsWith("//", i) && text[i - 1] !== ":" ? lineEndIn(text, i, text.length) : text.startsWith("/*", i) ? (text.indexOf("*/", i + 2) + 1 || text.length - 1) + 1 : -1;
    if (comment !== -1) { out += text.slice(i, comment).replace(/[^\n]/g, " "); i = comment; continue; }
    out += ch; i++;
  }
  return out;
}

export const blank = (format: SourceDeckFormat, text: string): string => (format === "latex" ? removeComments(text) : blankTypst(text));

export function group(ctx: Ctx, open: number, start: number): [number, number] {
  const found = ctx.format === "latex" ? balancedGroup(ctx.code, open) : typstGroup(ctx.code, open);
  if (!found || found[1] > ctx.limit) throw new Unclosed(start);
  return found;
}

export function make(ctx: Ctx, kind: SourceDeckNodeKind, range: SourceDeckRange, extra: { titleRange?: SourceDeckRange | undefined; bodyRange?: SourceDeckRange; children?: SourceDeckNode[]; props?: SourceDeckProps } = {}): SourceDeckNode {
  const node: SourceDeckNode = { kind, range, line: lineAt(ctx.text, range[0]), endLine: lineAt(ctx.text, Math.max(range[0], range[1] - 1)), props: { ...extra.props } };
  if (extra.titleRange) {
    const title = cleanTitle(ctx.code.slice(extra.titleRange[0], extra.titleRange[1]));
    Object.assign(node, { title, titleRange: extra.titleRange });
    node.props.title = title;
  }
  if (extra.bodyRange) node.bodyRange = extra.bodyRange;
  if (extra.children) node.children = extra.children;
  return node;
}

export function leaf(ctx: Ctx, kind: SourceDeckNodeKind, range: SourceDeckRange): Step {
  const props: SourceDeckProps = {};
  const read = <K extends keyof SourceDeckProps>(key: K, form: SourceDeckPropForm<NonNullable<SourceDeckProps[K]>> | null): void => { if (form) props[key] = form.value; };
  if (kind === "figure") {
    read("src", readSourceDeckSrc(ctx.format, ctx.text, range));
    read("width", readSourceDeckWidth(ctx.format, ctx.text, range));
    read("caption", readSourceDeckCaption(ctx.format, ctx.text, range));
  }
  if (kind === "figure" || kind === "text") read("align", readSourceDeckAlign(ctx.format, ctx.text, range));
  return { node: make(ctx, kind, range, { props }), end: range[1] };
}

export function elements(ctx: Ctx, from: number, to: number, mode: Mode): { nodes: SourceDeckNode[]; end: number } {
  const nodes: SourceDeckNode[] = [];
  let i = skipSpace(ctx.code, from);
  while (i < to) {
    const step = ctx.element(ctx, i, to, mode);
    if (step === "stop") return { nodes, end: i };
    if (step.node) nodes.push(step.node);
    i = skipSpace(ctx.code, Math.max(step.end, i + 1));
  }
  return { nodes, end: to };
}

// Property readers: each finds the first known form inside `range` and gives its value and the range of the literal a writer replaces.

function within(format: SourceDeckFormat, text: string, range: SourceDeckRange, re: RegExp): { m: RegExpExecArray; s: string; at: number } | null {
  const s = blank(format, text.slice(range[0], range[1]));
  const m = re.exec(s);
  return m ? { m, s, at: range[0] + m.index } : null;
}

/** The figure path: `\includegraphics{…}` or Typst `image("…")`. */
export function readSourceDeckSrc(format: SourceDeckFormat, text: string, range: SourceDeckRange): SourceDeckPropForm<string> | null {
  const found = within(format, text, range, format === "latex" ? /(\\includegraphics\s*(?:\[[^\]]*\])?\s*\{)([^}]*)\}/ : /(\bimage\(\s*")([^"]*)"/);
  if (!found) return null;
  const start = found.at + found.m[1]!.length;
  return { value: found.m[2]!.trim(), range: [start, start + found.m[2]!.length] };
}

/** The figure width as a fraction: `width=0.8\linewidth` (also `\columnwidth`, `\textwidth`; the range is the factor) or Typst `width: 80%`. */
export function readSourceDeckWidth(format: SourceDeckFormat, text: string, range: SourceDeckRange): SourceDeckPropForm<number> | null {
  const found = within(format, text, range, format === "latex" ? /(\\includegraphics\s*\[[^\]]*?\bwidth\s*=\s*)([\d.]*)\s*\\(?:linewidth|columnwidth|textwidth)\b/ : /(\bimage\([^)]*?\bwidth:\s*)(\d+(?:\.\d+)?%)/);
  if (!found) return null;
  const literal = found.m[2]!; const value = format === "latex" ? (literal ? Number(literal) : 1) : Number(literal.slice(0, -1)) / 100;
  const start = found.at + found.m[1]!.length;
  return Number.isFinite(value) ? { value, range: [start, start + literal.length] } : null;
}

/** The caption: `\caption{…}`, `\captionof{figure}{…}` or Typst `caption: […]` / `caption: "…"`; the range is inside the delimiters. */
export function readSourceDeckCaption(format: SourceDeckFormat, text: string, range: SourceDeckRange): SourceDeckPropForm<string> | null {
  const found = within(format, text, range, format === "latex" ? /(\\caption(?:of\s*\{figure\})?\s*(?:\[[^\]]*\])?\s*)\{/ : /(\bcaption:\s*)([["])/);
  if (!found) return null;
  const open = found.m.index + found.m[1]!.length;
  const close = found.s[open] === '"' ? found.s.indexOf('"', open + 1) + 1 : (format === "latex" ? balancedGroup(found.s, open) : typstGroup(found.s, open))?.[1] ?? 0;
  if (close <= open) return null;
  const inner: SourceDeckRange = [range[0] + open + 1, range[0] + close - 1];
  return { value: cleanTitle(text.slice(inner[0], inner[1])), range: inner };
}

const ALIGN_VALUE: Record<string, SourceDeckAlign> = { centering: "center", raggedright: "left", raggedleft: "right", center: "center", flushleft: "left", flushright: "right", left: "left", right: "right" };

/**
 * The alignment: a `\centering`/`\raggedright`/`\raggedleft` declaration (range: the whole command), a `center`/`flushleft`/`flushright`
 * environment (range: its name in `\begin`), or Typst `align(left|center|right…)` (range: the word).
 */
export function readSourceDeckAlign(format: SourceDeckFormat, text: string, range: SourceDeckRange): SourceDeckPropForm<SourceDeckAlign> | null {
  const found = within(format, text, range, format === "latex" ? /(\\)(centering|raggedright|raggedleft)\b|(\\begin\s*\{)(center|flushleft|flushright)\}/ : /(\balign\(\s*)(left|center|right)\b/);
  if (!found) return null;
  const prefix = found.m[1] ?? found.m[3]!; const word = found.m[2] ?? found.m[4]!;
  const start = found.at + prefix.length - (found.m[2] && format === "latex" ? 1 : 0);
  return { value: ALIGN_VALUE[word]!, range: [start, found.at + prefix.length + word.length] };
}

/** The width of a LaTeX column from its header `\column{0.5}` or `\begin{column}{0.5\textwidth}`; the range is the factor. Typst columns have none. */
export function readSourceDeckColumnWidth(format: SourceDeckFormat, text: string, range: SourceDeckRange): SourceDeckPropForm<number> | null {
  if (format !== "latex") return null;
  const m = /^(\\(?:column|begin\s*\{column\}(?:\[[^\]]*\])?)\s*\{\s*)([\d.]*)\s*(\\(?:textwidth|linewidth|columnwidth|paperwidth))?\s*\}/.exec(text.slice(range[0], range[1]));
  if (!m || (!m[2] && !m[3])) return null;
  const value = m[2] ? Number(m[2]) : 1; const start = range[0] + m[1]!.length;
  return Number.isFinite(value) ? { value, range: [start, start + m[2]!.length] } : null;
}
