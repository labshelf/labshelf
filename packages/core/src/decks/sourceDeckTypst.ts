// The Typst side of the block tree: calls, columns, lists, paragraphs and the slides of a talk.
import type { SourceDeckNode, SourceDeckRange } from "./sourceDeckBlocks.js";
import { lineStart, readSourceDeckOutline, skipSpace, TYPST_SLIDE_CALL } from "./sourceDeckOutline.js";
import { at, elements, group, leaf, lineEndIn, make, mathClose, Unclosed, trimEnd, walkTypst } from "./sourceDeckScan.js";
import type { Ctx, Mode, Step } from "./sourceDeckScan.js";

interface TypstCall { name: string; args?: SourceDeckRange; content: SourceDeckRange[]; end: number }
const TYPST_TEXT = new Set(["text", "strong", "emph", "underline", "highlight", "smallcaps", "link", "cite", "ref", "footnote", "sub", "super", "strike", "overline", "lorem", "h", "sym", "box"]);
const TYPST_KEYWORD = /#(?:let|set|show|import|include|if|for|while|context)\b|#[{(]/y;
const TYPST_LIST = /[ \t]*(?:[-+][ \t]|\d+\.[ \t]|\/[ \t]+[^:\n]*:)/y;
const TYPST_HEADING = /(=+)[ \t]+/y;

/** A `#name(…)[…]` call with method chains, its argument and content groups; null when `i` is not a call. */
function typstCall(ctx: Ctx, i: number, start: number): TypstCall | null {
  const c = ctx.code; const m = at(/#([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)/y, c, i);
  if (!m) return null;
  const call: TypstCall = { name: m[1]!, content: [], end: i + m[0].length };
  for (;;) {
    const method = at(/\.[A-Za-z_][\w-]*/y, c, call.end);
    if (c[call.end] === "(" || c[call.end] === "[") {
      const [inner, end] = group(ctx, call.end, start);
      if (c[call.end] === "(") call.args ??= [inner, end - 1]; else call.content.push([inner, end - 1]);
      call.end = end;
    } else if (method) call.end += method[0].length;
    else return call;
  }
}

/** The end of a Typst statement: the first line break outside brackets. */
function statementEnd(ctx: Ctx, i: number, to: number): number {
  let depth = 0;
  const stop = walkTypst(ctx.code, i, (ch, k) => {
    if (k >= to || (ch === "\n" && depth <= 0)) return true;
    if ("([{".includes(ch)) depth++; else if (")]}".includes(ch)) depth--;
    return false;
  });
  if (depth > 0) throw new Unclosed(i);
  return stop === -1 ? to : Math.min(stop, to);
}

/** The columns of a Typst `#columns(n)[…]` (split at `#colbreak()`) or `#grid(…)` (its content cells); null for neither. */
function typstColumns(ctx: Ctx, call: TypstCall, start: number, mode: Mode): SourceDeckNode[] | null {
  const c = ctx.code;
  const column = (from: number, to: number, bracketed: boolean): SourceDeckNode => {
    const s = bracketed ? from : Math.min(skipSpace(c, from), to); const e = bracketed ? to : trimEnd(c, s, to);
    const range: SourceDeckRange = bracketed ? [s - 1, e + 1] : [s, e];
    return make(ctx, "column", range, { bodyRange: [s, e], children: elements(ctx, s, e, mode).nodes });
  };
  if (call.name === "columns") {
    const body = call.content[0];
    if (!body) return null;
    const breaks: SourceDeckRange[] = []; let depth = 0;
    walkTypst(c, body[0], (ch, k) => {
      if (k >= body[1]) return true;
      const colbreak = depth === 0 && ch === "#" ? at(/#colbreak\([^)]*\)/y, c, k) : null;
      if (colbreak) breaks.push([k, k + colbreak[0].length]);
      if ("([{".includes(ch)) depth++; else if (")]}".includes(ch)) depth--;
      return false;
    });
    const bounds = [body[0], ...breaks.flat(), body[1]];
    return bounds.filter((_, n) => n % 2 === 0).map((from, n) => column(from, bounds[2 * n + 1]!, false));
  }
  if (call.name !== "grid") return null;
  const cells: SourceDeckRange[] = [];
  if (call.args) {
    let segment = call.args[0];
    for (let k = call.args[0]; k < call.args[1];) {
      const ch = c[k]!;
      if (ch === ",") segment = k + 1;
      if (ch === '"') { const q = c.indexOf('"', k + 1); k = q === -1 ? call.args[1] : q + 1; continue; }
      if ("([{".includes(ch)) {
        const [inner, end] = group(ctx, k, start);
        if (ch === "[" && !c.slice(segment, k).trim()) cells.push([inner, end - 1]);
        k = end; continue;
      }
      k++;
    }
  }
  cells.push(...call.content);
  return cells.length ? cells.map(([from, to]) => column(from, to, true)) : null;
}

export function typstElement(ctx: Ctx, i: number, to: number, mode: Mode): Step | "stop" {
  const c = ctx.code; const lineEnd = lineEndIn(c, i, to);
  const atLineStart = !c.slice(lineStart(c, i), i).trim();
  const heading = atLineStart ? at(TYPST_HEADING, c, i) : null;
  if (heading && mode === "block") return "stop";
  if (heading && mode === "poster") {
    const body = elements(ctx, lineEnd, to, "block"); const end = trimEnd(c, i, body.end);
    return { node: make(ctx, "block", [i, end], { titleRange: [i + heading[0].length, trimEnd(c, i, lineEnd)], bodyRange: [Math.min(lineEnd, end), end], children: body.nodes }), end: body.end };
  }
  if (heading) return leaf(ctx, "text", [i, trimEnd(c, i, lineEnd)]);
  if (c[i] === "$" && /\s/.test(c[i + 1] ?? "")) {
    const close = mathClose(c, i + 1);
    if (close === -1 || close + 1 > ctx.limit) throw new Unclosed(i);
    return leaf(ctx, "equation", [i, withLabel(c, close + 1)]);
  }
  if (atLineStart && at(TYPST_LIST, c, i)) return typstList(ctx, i, to);
  if (at(TYPST_KEYWORD, c, i)) return leaf(ctx, "code", [i, trimEnd(c, i, statementEnd(ctx, i, to))]);
  const call = typstCall(ctx, i, i);
  if (!call || TYPST_TEXT.has(call.name)) return typstParagraph(ctx, i, to);
  if (/^(?:pdfpc\.)?speaker-note$/.test(call.name)) return { node: null, end: call.end };
  const end = withLabel(c, call.end);
  const inner = call.content.map(([s, e]) => c.slice(s, e)).join("");
  if (call.name === "figure" || call.name === "image" || (call.name === "align" && /#(?:image|figure)\(/.test(inner))) return leaf(ctx, "figure", [i, end]);
  if (call.name === "align") return leaf(ctx, "text", [i, end]);
  if (call.name === "table" || call.name === "math.equation") return leaf(ctx, call.name === "table" ? "table" : "equation", [i, end]);
  const columns = typstColumns(ctx, call, i, mode === "poster" ? "poster" : "talk");
  return columns ? { node: make(ctx, "columns", [i, end], { bodyRange: [i, end], children: columns }), end } : leaf(ctx, "code", [i, end]);
}

const withLabel = (code: string, end: number): number => end + (at(/[ \t]*<[\w:.-]+>/y, code, end)?.[0].length ?? 0);

function typstList(ctx: Ctx, i: number, to: number): Step {
  const c = ctx.code; const indent = i - lineStart(c, i);
  let end = lineEndIn(c, i, to);
  for (let k = end + 1; k < to;) {
    const lineEnd = lineEndIn(c, k, to); const line = c.slice(k, lineEnd);
    const depth = line.length - line.trimStart().length;
    if (line.trim() && (depth > indent || (depth === indent && at(TYPST_LIST, c, k)))) end = lineEnd;
    else if (line.trim()) break;
    k = lineEnd + 1;
  }
  return leaf(ctx, "list", [i, trimEnd(c, i, end)]);
}

/** Whether the line at k ends a Typst paragraph: blank, a heading, display math, a list item or a non-text call. */
function typstBreak(c: string, k: number, to: number): boolean {
  const line = c.slice(k, lineEndIn(c, k, to)).trimStart();
  const call = /^#([A-Za-z_][\w-]*)/.exec(line);
  return !line || /^=+[ \t]|^\$\s|^(?:[-+][ \t]|\d+\.[ \t]|\/[ \t])/.test(line) || (!!call && !TYPST_TEXT.has(call[1]!)) || /^#[{(]/.test(line);
}

function typstParagraph(ctx: Ctx, i: number, to: number): Step {
  const c = ctx.code; let j = i;
  while (j < to) {
    const ch = c[j]!;
    const call = ch === "#" ? typstCall(ctx, j, i) : null;
    const math = ch === "$" ? mathClose(c, j + 1) : -1;
    if (ch === "\n" && typstBreak(c, j + 1, to)) break;
    j = ch === "\\" ? j + 2 : call ? Math.max(call.end, j + 1) : ch === "[" ? group(ctx, j, i)[1] : math !== -1 && math < to ? math + 1 : j + 1;
  }
  return leaf(ctx, "text", [i, trimEnd(c, i, Math.min(j, to))]);
}

export function typstTalk(ctx: Ctx): SourceDeckNode[] {
  const c = ctx.code; const slides: SourceDeckNode[] = [];
  for (const item of readSourceDeckOutline("typst", "talk", ctx.text)) {
    if (item.start >= ctx.limit) break;
    const start = item.start; const stop = Math.min(item.end, ctx.limit);
    const lineEnd = lineEndIn(c, start, stop);
    if (!TYPST_SLIDE_CALL.test(c.slice(start, lineEnd))) {
      const heading = at(TYPST_HEADING, c, start)!; const end = trimEnd(c, start, stop);
      slides.push(make(ctx, "slide", [start, end], { titleRange: [start + heading[0].length, trimEnd(c, start, lineEnd)], bodyRange: [Math.min(lineEnd, end), end], children: elements(ctx, lineEnd, stop, "talk").nodes }));
      continue;
    }
    const call = typstCall(ctx, start, start)!;
    const named = call.args ? at(/title:\s*([["])/g, c, call.args[0]) : null;
    let title: SourceDeckRange | undefined;
    if (named && named.index < call.args![1]) {
      const open = named.index + named[0].length - 1;
      title = named[1] === "[" ? [open + 1, group(ctx, open, start)[1] - 1] : [open + 1, c.indexOf('"', open + 1)];
    }
    const body = call.content[call.content.length - 1];
    let from = body?.[0] ?? call.end;
    const inner = !title && body ? at(/\s*=+[ \t]+/y, c, body[0]) : null;
    if (inner) { const end = lineEndIn(c, body![0] + inner[0].length, body![1]); title = [body![0] + inner[0].length, trimEnd(c, body![0], end)]; from = end; }
    slides.push(make(ctx, "slide", [start, call.end], { titleRange: title, bodyRange: body ?? [call.end, call.end], children: body ? elements(ctx, from, body[1], "talk").nodes : [] }));
  }
  return slides;
}
