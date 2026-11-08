// The block tree of a LaTeX or Typst talk (slides, then elements) or poster (columns, then blocks, then elements), with source ranges.
import type { DeckKind } from "./deckSizes.js";
import { balancedGroup, skipSpace } from "./sourceDeckOutline.js";
import { at, blank, elements, group, leaf, make, readSourceDeckColumnWidth, trimEnd, Unclosed, walkTypst } from "./sourceDeckScan.js";
import type { Ctx, Mode, Step } from "./sourceDeckScan.js";
import { typstElement, typstTalk } from "./sourceDeckTypst.js";
import type { SourceDeckFormat } from "./sourceDecks.js";

/** Character offsets [start, end) into the source text. */
export type SourceDeckRange = [number, number];
export type SourceDeckNodeKind = "column" | "block" | "slide" | "figure" | "equation" | "list" | "table" | "columns" | "text" | "code";
export type SourceDeckAlign = "left" | "center" | "right";
/** The properties a node carries in a known, rewritable form; an absent form is an absent key. */
export interface SourceDeckProps { title?: string; src?: string; width?: number; caption?: string; align?: SourceDeckAlign; columnWidth?: number }
/** One node of the tree: lines are 1-based and inclusive; `children` only on containers (column, block, slide, columns). `file` is the
 * project-relative path of the included file the ranges and lines refer to; absent for the main file. */
export interface SourceDeckNode {
  kind: SourceDeckNodeKind; title?: string; range: SourceDeckRange; titleRange?: SourceDeckRange; bodyRange?: SourceDeckRange;
  line: number; endLine: number; props: SourceDeckProps; children?: SourceDeckNode[]; file?: string;
}
/** A property value with the range of the literal a writer replaces. */
export interface SourceDeckPropForm<T> { value: T; range: SourceDeckRange }

/** The first unbalanced `{`/`}` (LaTeX) or `[`/`]` (Typst) in comment-blanked source, or the source length. */
function firstUnbalanced(format: SourceDeckFormat, code: string): number {
  const [open, close] = format === "latex" ? ["{", "}"] : ["[", "]"];
  const stack: number[] = []; let bad = -1;
  const visit = (ch: string, i: number): boolean => {
    if (ch === open) stack.push(i);
    else if (ch === close && stack.pop() === undefined) { bad = i; return true; }
    return false;
  };
  if (format === "typst") walkTypst(code, 0, visit);
  else for (let i = 0; i < code.length && bad === -1; i++) { if (code[i] === "\\") i++; else visit(code[i]!, i); }
  return bad !== -1 ? bad : stack.length ? stack[0]! : code.length;
}

// LaTeX

/** The `\end{name}` matching an environment whose header ends at `from`, as the offset of `\end` and the end after it. */
function envEnd(ctx: Ctx, name: string, from: number, start: number): { inner: number; end: number } {
  const re = new RegExp(`\\\\(begin|end)\\s*\\{${name.replace(/[*]/g, "\\*")}\\}`, "g");
  let depth = 1;
  for (let m = at(re, ctx.code, from); m && m.index + m[0].length <= ctx.limit; m = re.exec(ctx.code)) {
    if (m[1] === "begin") depth++;
    else if (--depth === 0) return { inner: m.index, end: m.index + m[0].length };
  }
  throw new Unclosed(start);
}

/** The end of a command's directly following `<…>`, `[…]` and up to `groups` `{…}` arguments. */
function commandEnd(ctx: Ctx, from: number, start: number, groups = Infinity): number {
  const c = ctx.code; let k = from; let n = 0;
  for (;;) {
    let p = k; while (c[p] === " " || c[p] === "\t") p++;
    const option = c[p] === "[" ? balancedGroup(c, p) : null;
    const overlay = c[p] === "<" ? at(/<[^>\n]*>/y, c, p) : null;
    if (overlay) k = p + overlay[0].length;
    else if (option && option[1] <= ctx.limit) k = option[1];
    else if (c[p] === "{" && n++ < groups) k = group(ctx, p, start)[1];
    else return k;
  }
}

/** The title `{…}` after overlay specs and options, as its inner range, and where the body starts. */
function titleAfter(ctx: Ctx, from: number, start: number): { title?: SourceDeckRange; end: number } {
  const c = ctx.code; let p = skipSpace(c, from);
  for (;;) {
    const overlay = c[p] === "<" ? at(/<[^>\n]*>/y, c, p) : null;
    if (overlay) p = skipSpace(c, p + overlay[0].length);
    else if (c[p] === "[") p = skipSpace(c, group(ctx, p, start)[1]);
    else break;
  }
  if (c[p] !== "{") return { end: from };
  const [inner, end] = group(ctx, p, start);
  return { title: [inner, end - 1], end };
}

const FIGURE_ENV = /^(?:figure\*?|tikzfigure|wrapfigure)$/;
const ALIGN_ENV = /^(?:center|flushleft|flushright)$/;
const EQUATION_ENV = /^(?:(?:equation|align|gather|multline|eqnarray|flalign|alignat)\*?|displaymath)$/;
const LIST_ENV = /^(?:itemize|enumerate|description)$/;
const TABLE_ENV = /^(?:table\*?|tabular[x*]?|longtable|tblr)$/;
const BLOCK_ENV = /^(?:block|alertblock|exampleblock)$/;
const LATEX_TEXT = new Set(["textbf", "textit", "emph", "underline", "textcolor", "color", "textsc", "texttt", "textrm", "textsf", "alert", "structure", "cite", "ref", "eqref", "href", "url", "mbox", "noindent", "tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge", "bfseries", "itshape"]);
const LATEX_BREAK = /\\(?:begin\b|end\b|\[|includegraphics\b|block\b|column\b|note\b|frametitle\b)|\$\$|\n[ \t]*\n/y;

function latexElement(ctx: Ctx, i: number, to: number, mode: Mode): Step {
  const c = ctx.code;
  const env = at(/\\begin\s*\{([^}]+)\}/y, c, i);
  if (env) {
    const name = env[1]!.trim(); const head = i + env[0].length;
    const { inner, end } = envEnd(ctx, name, head, i);
    if (name === "columns") {
      const body = commandEnd(ctx, head, i, 0);
      return { node: make(ctx, "columns", [i, end], { bodyRange: [body, inner], children: latexColumns(ctx, body, inner, mode === "poster" ? "poster" : "talk") }), end };
    }
    if (mode === "poster" && BLOCK_ENV.test(name)) {
      const title = titleAfter(ctx, head, i);
      return { node: make(ctx, "block", [i, end], { titleRange: title.title, bodyRange: [title.end, inner], children: elements(ctx, title.end, inner, "talk").nodes }), end };
    }
    const graphic = /\\includegraphics\b/.test(c.slice(head, inner));
    const kind = FIGURE_ENV.test(name) || (ALIGN_ENV.test(name) && graphic) ? "figure" : ALIGN_ENV.test(name) ? "text"
      : EQUATION_ENV.test(name) ? "equation" : LIST_ENV.test(name) ? "list" : TABLE_ENV.test(name) ? "table" : "code";
    return leaf(ctx, kind, [i, end]);
  }
  if (c.startsWith("\\[", i) || c.startsWith("$$", i)) {
    const close = c.indexOf(c[i + 1] === "[" ? "\\]" : "$$", i + 2);
    if (close === -1 || close + 2 > ctx.limit) throw new Unclosed(i);
    return leaf(ctx, "equation", [i, close + 2]);
  }
  const command = at(/\\([A-Za-z]+)\*?/y, c, i);
  if (!command) return latexParagraph(ctx, i, to);
  const name = command[1]!; const after = i + command[0].length;
  if (mode === "poster" && name === "block") {
    const title = titleAfter(ctx, after, i); const open = skipSpace(c, title.end);
    if (!title.title || c[open] !== "{") return leaf(ctx, "code", [i, commandEnd(ctx, after, i)]);
    const [inner, end] = group(ctx, open, i);
    return { node: make(ctx, "block", [i, end], { titleRange: title.title, bodyRange: [inner, end - 1], children: elements(ctx, inner, end - 1, "talk").nodes }), end };
  }
  if (name === "includegraphics") {
    let end = commandEnd(ctx, after, i, 1);
    const caption = at(/[ \t]*\n?[ \t]*\\caption(of)?\b/y, c, end);
    if (caption) end = commandEnd(ctx, end + caption[0].length, i, caption[1] ? 2 : 1);
    return leaf(ctx, "figure", [i, end]);
  }
  if (name === "note" || name === "frametitle") return { node: null, end: commandEnd(ctx, after, i, 1) };
  if (!LATEX_TEXT.has(name)) return leaf(ctx, "code", [i, commandEnd(ctx, after, i)]);
  return latexParagraph(ctx, i, to);
}

function latexParagraph(ctx: Ctx, i: number, to: number): Step {
  const c = ctx.code; let j = i;
  while (j < to) {
    if (j > i && at(LATEX_BREAK, c, j)) break;
    if (c[j] === "{") j = group(ctx, j, i)[1];
    else j += c[j] === "\\" ? 2 : 1;
  }
  return leaf(ctx, "text", [i, trimEnd(c, i, Math.min(j, to))]);
}

/** The columns between `from` and `to`: `\column{w}` markers or `column` environments, nested `columns` skipped. */
function latexColumns(ctx: Ctx, from: number, to: number, mode: Mode): SourceDeckNode[] {
  const c = ctx.code; const columns: SourceDeckNode[] = [];
  const re = /\\column\b|\\begin\s*\{columns?\}/g;
  let open: { start: number; head: number } | null = null;
  const column = (start: number, head: number, inner: number, end: number): void => {
    const width = readSourceDeckColumnWidth("latex", ctx.text, [start, end]);
    columns.push(make(ctx, "column", [start, end], { bodyRange: [Math.min(head, inner), inner], props: width ? { columnWidth: width.value } : {}, children: elements(ctx, head, inner, mode).nodes }));
  };
  const close = (stop: number): void => { if (open) { const end = trimEnd(c, open.start, stop); column(open.start, open.head, end, end); open = null; } };
  for (let m = at(re, c, from); m && m.index < to; m = re.exec(c)) {
    if (m[0].endsWith("columns}")) { re.lastIndex = envEnd(ctx, "columns", m.index + m[0].length, m.index).end; continue; }
    close(m.index);
    const head = commandEnd(ctx, m.index + m[0].length, m.index, 1);
    if (m[0] === "\\column") { open = { start: m.index, head }; re.lastIndex = head; continue; }
    const { inner, end } = envEnd(ctx, "column", m.index + m[0].length, m.index);
    column(m.index, head, inner, end);
    re.lastIndex = end;
  }
  close(to);
  return columns;
}

function latexTalk(ctx: Ctx): SourceDeckNode[] {
  const c = ctx.code; const slides: SourceDeckNode[] = [];
  const re = /\\begin\s*\{frame\}/g;
  for (let m = re.exec(c); m && m.index < ctx.limit; m = re.exec(c)) {
    const start = m.index; const head = start + m[0].length;
    const { inner, end } = envEnd(ctx, "frame", head, start);
    let { title, end: body } = titleAfter(ctx, head, start);
    const frameTitle = title ? null : at(/\\frametitle\s*(?:<[^>]*>)?\s*(?:\[[^\]]*\])?\s*\{/g, c, body);
    if (frameTitle && frameTitle.index < inner) { const g = group(ctx, frameTitle.index + frameTitle[0].length - 1, start); title = [g[0], g[1] - 1]; }
    if (!title) body = commandEnd(ctx, head, start, 0);
    slides.push(make(ctx, "slide", [start, end], { titleRange: title, bodyRange: [body, inner], children: elements(ctx, body, inner, "talk").nodes }));
    re.lastIndex = end;
  }
  return slides;
}

function latexPoster(ctx: Ctx): SourceDeckNode[] {
  const c = ctx.code;
  const doc = /\\begin\s*\{document\}/.exec(c);
  let from = doc ? doc.index + doc[0].length : 0;
  const docEnd = /\\end\s*\{document\}/.exec(c);
  let to = Math.min(docEnd ? docEnd.index : c.length, ctx.limit);
  const frame = at(/\\begin\s*\{frame\}/g, c, from);
  if (frame && frame.index < to) {
    const { inner } = envEnd(ctx, "frame", frame.index + frame[0].length, frame.index);
    from = commandEnd(ctx, frame.index + frame[0].length, frame.index, 0); to = inner;
  }
  return posterColumns(ctx, elements(ctx, from, to, "poster").nodes);
}

/** The columns of a poster: those of its top-level `columns`, else one implicit column from the first non-code node. */
function posterColumns(ctx: Ctx, nodes: SourceDeckNode[]): SourceDeckNode[] {
  const columns = nodes.filter((node) => node.kind === "columns").flatMap((node) => node.children ?? []);
  if (columns.length) return columns;
  const first = nodes.findIndex((node) => node.kind !== "code");
  if (first === -1) return [];
  const children = nodes.slice(first);
  const range: SourceDeckRange = [children[0]!.range[0], children[children.length - 1]!.range[1]];
  return [make(ctx, "column", range, { bodyRange: range, children })];
}

/**
 * The tree of a talk (slides, then elements) or poster (columns, then blocks, then elements).
 * Comments open no node; unrecognised content is `code`.
 * An unbalanced brace (LaTeX) or bracket (Typst) closes the tree at its node; from that node on, the source is one top-level `code` node.
 */
export function readSourceDeckBlocks(format: SourceDeckFormat, kind: DeckKind, text: string): SourceDeckNode[] {
  const code = blank(format, text);
  let limit = firstUnbalanced(format, code);
  for (;;) {
    const ctx: Ctx = { format, text, code, limit, element: format === "latex" ? latexElement : typstElement };
    try {
      const nodes = kind === "talk" ? (format === "latex" ? latexTalk(ctx) : typstTalk(ctx))
        : format === "latex" ? latexPoster(ctx) : posterColumns(ctx, elements(ctx, 0, limit, "poster").nodes);
      const rest = skipSpace(code, limit);
      return rest < text.length ? [...nodes, make(ctx, "code", [rest, trimEnd(text, rest, text.length)])] : nodes;
    } catch (error) {
      if (!(error instanceof Unclosed)) throw error;
      limit = Math.min(error.at, limit - 1);
    }
  }
}
