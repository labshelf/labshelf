// The LaTeX syntax the raw-block table reader shares: arguments, top-level splitting and the inline text of a cell or caption.

import type { LatexInline } from "./latexTable.js";

/** LaTeX the reader cannot read; callers turn it into their fallback. */
export class LatexSyntaxError extends Error {}

export const fail = (message: string): never => { throw new LatexSyntaxError(message); };

/** The index just after the `}` that closes the `{` at `open`. */
function closeBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === "\\") { i++; continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return fail("unbalanced braces");
}

export const skipSpace = (text: string, i: number): number => { while (i < text.length && /\s/.test(text.charAt(i))) i++; return i; };

/** Reads a `{…}` argument at `i` (after spaces): its content and the index after it. */
export function braceArg(text: string, i: number): { value: string; end: number } {
  const at = skipSpace(text, i);
  if (text.charAt(at) !== "{") {
    // A single-token argument, as in `\multicolumn2c…`.
    if (at >= text.length) fail("missing argument");
    if (text.charAt(at) === "\\") { const m = /^\\([A-Za-z]+|.)/.exec(text.slice(at)); return { value: m![0], end: at + m![0].length }; }
    return { value: text.charAt(at), end: at + 1 };
  }
  const end = closeBrace(text, at);
  return { value: text.slice(at + 1, end - 1), end };
}

/** Skips an optional `[…]` argument at `i` (after spaces). */
export function skipOptional(text: string, i: number, open = "[", close = "]"): { value: string | null; end: number } {
  const at = skipSpace(text, i);
  if (text.charAt(at) !== open) return { value: null, end: i };
  const end = text.indexOf(close, at);
  if (end < 0) fail("unclosed optional argument");
  return { value: text.slice(at + 1, end), end: end + 1 };
}

/**
 * Splits `text` at top-level separators: `\\` (with `*` and `[len]`) or `\tabularnewline` when `rows`, `&` otherwise;
 * braces, math and escaped characters never split.
 */
export function splitTopLevel(text: string, rows: boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let math: string | null = null;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === "\\") {
      const next = text.charAt(i + 1);
      if (next === "\\" && depth === 0 && math === null && rows) {
        parts.push(text.slice(start, i));
        let j = i + 2;
        if (text.charAt(j) === "*") j++;
        const optional = skipOptional(text, j);
        start = i = optional.end;
        continue;
      }
      if (next === "(" || next === "[") { if (math === null) math = next === "(" ? ")" : "]"; i += 2; continue; }
      if ((next === ")" || next === "]") && math === next) { math = null; i += 2; continue; }
      const word = /^\\[A-Za-z]+/.exec(text.slice(i));
      if (word && word[0] === "\\tabularnewline" && depth === 0 && math === null && rows) {
        parts.push(text.slice(start, i));
        start = i = i + word[0].length;
        continue;
      }
      i += word ? word[0].length : 2;
      continue;
    }
    if (c === "$") {
      const display = text.charAt(i + 1) === "$";
      const delimiter = display ? "$$" : "$";
      if (math === null) math = delimiter;
      else if (math === delimiter) math = null;
      i += delimiter.length;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth < 0) fail("unbalanced braces"); }
    else if (c === "&" && !rows && depth === 0 && math === null) { parts.push(text.slice(start, i)); start = i + 1; }
    i++;
  }
  if (depth !== 0) fail("unbalanced braces");
  if (math !== null) fail("unclosed math");
  parts.push(text.slice(start));
  return parts;
}

const SYMBOLS: Readonly<Record<string, string>> = {
  "%": "%", "&": "&", "$": "$", "#": "#", "_": "_", "{": "{", "}": "}", ",": " ", " ": " ", ";": " ", ":": " ", "!": "",
  textbackslash: "\\", ldots: "…", dots: "…", textendash: "–", textemdash: "—", quad: " ", qquad: "  ",
  textdegree: "°", S: "§", P: "¶", copyright: "©", textasciitilde: "~", textasciicircum: "^", newline: " ", linebreak: " ",
};
const STYLES: Readonly<Record<string, "bold" | "italic" | "mono" | "plain">> = {
  textbf: "bold", textit: "italic", emph: "italic", textsl: "italic", texttt: "mono", textrm: "plain", textsf: "plain",
  textup: "plain", textnormal: "plain", text: "plain", mbox: "plain", makecell: "plain", textsc: "plain",
};
const SWITCHES: Readonly<Record<string, "bold" | "italic" | "mono">> = { bfseries: "bold", itshape: "italic", em: "italic", ttfamily: "mono", bf: "bold", it: "italic", tt: "mono" };
const DROPPED = new Set(["label", "ref", "vspace", "hspace", "rule", "phantom", "footnote", "index", "centering", "raggedright", "raggedleft"]);

/** Inline content being built: text gathers in `buffer` until a node is pushed. */
interface InlineSink { out: LatexInline[]; buffer: string; flush(): void; push(node: LatexInline): void }

function inlineSink(): InlineSink {
  const sink: InlineSink = {
    out: [],
    buffer: "",
    flush() { if (sink.buffer) sink.out.push({ type: "text", text: sink.buffer }); sink.buffer = ""; },
    push(node) { sink.flush(); sink.out.push(node); },
  };
  return sink;
}

/** The math that opens at `i` (`$`, `$$`, `\(` or `\[`): its TeX and the index after its close; null when no math opens there. */
function readInlineMath(text: string, i: number): { tex: string; end: number } | null {
  const c = text.charAt(i);
  if (!(c === "$" || (c === "\\" && (text.charAt(i + 1) === "(" || text.charAt(i + 1) === "[")))) return null;
  const open = c === "$" ? (text.charAt(i + 1) === "$" ? "$$" : "$") : text.slice(i, i + 2);
  const close = open === "\\(" ? "\\)" : open === "\\[" ? "\\]" : open;
  let j = i + open.length;
  while (j < text.length && text.slice(j, j + close.length) !== close) j += text.charAt(j) === "\\" ? 2 : 1;
  if (j >= text.length) fail("unclosed math");
  return { tex: text.slice(i + open.length, j).trim(), end: j + close.length };
}

/** Reads the command at `start` (a backslash) into the sink: a symbol, a styled argument, a style switch to the end, a dropped command or an unknown one; returns the index after it. */
function readCommand(text: string, start: number, sink: InlineSink): number {
  const word = /^\\([A-Za-z]+|.)\*?/.exec(text.slice(start))!;
  const name = word[1]!;
  const i = start + word[0].length;
  if (Object.hasOwn(SYMBOLS, name)) { sink.buffer += SYMBOLS[name]; return /^[A-Za-z]/.test(name) ? skipSpace(text, i) : i; }
  if (Object.hasOwn(STYLES, name)) {
    const arg = braceArg(text, i);
    const children = parseLatexInline(arg.value);
    const style = STYLES[name]!;
    if (style === "plain") { sink.flush(); sink.out.push(...children); } else sink.push({ type: style, children });
    return arg.end;
  }
  if (Object.hasOwn(SWITCHES, name)) {
    sink.push({ type: SWITCHES[name]!, children: parseLatexInline(text.slice(i)) });
    return text.length;
  }
  if (DROPPED.has(name)) {
    const end = skipOptional(text, i).end;
    return text.charAt(skipSpace(text, end)) === "{" ? braceArg(text, end).end : end;
  }
  // An unknown command keeps the content of its brace arguments.
  return /^[A-Za-z]/.test(name) ? skipSpace(text, i) : i;
}

/** The typography TeX writes with plain characters: a tie, dashes and quotes. */
const TYPOGRAPHY: readonly (readonly [string, string])[] = [["~", " "], ["---", "—"], ["--", "–"], ["``", "“"], ["''", "”"]];

/** Reads one plain character (or a typography mark, or a run of space as one) into the sink; returns the index after it. */
function readText(text: string, i: number, sink: InlineSink): number {
  const mark = TYPOGRAPHY.find(([from]) => text.startsWith(from, i));
  if (mark) { sink.buffer += mark[1]; return i + mark[0].length; }
  const c = text.charAt(i);
  if (!/\s/.test(c)) sink.buffer += c;
  else if (!/\s$/.test(sink.buffer)) sink.buffer += " ";
  return i + 1;
}

/** Reads cell or caption LaTeX into inline content. */
export function parseLatexInline(text: string): LatexInline[] {
  const sink = inlineSink();
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    const math = readInlineMath(text, i);
    if (math) { sink.push({ type: "math", tex: math.tex }); i = math.end; continue; }
    if (c === "\\") { i = readCommand(text, i, sink); continue; }
    if (c === "{") {
      const end = closeBrace(text, i);
      sink.flush();
      sink.out.push(...parseLatexInline(text.slice(i + 1, end - 1)));
      i = end;
      continue;
    }
    if (c === "}") fail("unbalanced braces");
    i = readText(text, i, sink);
  }
  sink.flush();
  return trimInline(sink.out);
}

/** Drops the spaces at the start and end of inline content. */
function trimInline(nodes: LatexInline[]): LatexInline[] {
  const first = nodes[0];
  if (first?.type === "text") { first.text = first.text.replace(/^\s+/, ""); if (!first.text) nodes.shift(); }
  const last = nodes[nodes.length - 1];
  if (last?.type === "text") { last.text = last.text.replace(/\s+$/, ""); if (!last.text) nodes.pop(); }
  return nodes;
}
