// The LaTeX syntax the raw-block table reader shares: arguments, top-level splitting and the inline text of a cell or caption.

/** Inline content of a cell or caption: text, math (TeX without delimiters) and styled groups. */
export type LatexInline =
  | { type: "text"; text: string }
  | { type: "math"; tex: string }
  | { type: "bold" | "italic" | "mono"; children: LatexInline[] };

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

/** Reads cell or caption LaTeX into inline content. */
export function parseLatexInline(text: string): LatexInline[] {
  const out: LatexInline[] = [];
  let buffer = "";
  const flush = (): void => { if (buffer) out.push({ type: "text", text: buffer }); buffer = ""; };
  const push = (node: LatexInline): void => { flush(); out.push(node); };
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === "$" || (c === "\\" && (text.charAt(i + 1) === "(" || text.charAt(i + 1) === "["))) {
      const open = c === "$" ? (text.charAt(i + 1) === "$" ? "$$" : "$") : text.slice(i, i + 2);
      const close = open === "\\(" ? "\\)" : open === "\\[" ? "\\]" : open;
      let j = i + open.length;
      while (j < text.length && text.slice(j, j + close.length) !== close) j += text.charAt(j) === "\\" ? 2 : 1;
      if (j >= text.length) fail("unclosed math");
      push({ type: "math", tex: text.slice(i + open.length, j).trim() });
      i = j + close.length;
      continue;
    }
    if (c === "\\") {
      const word = /^\\([A-Za-z]+|.)\*?/.exec(text.slice(i))!;
      const name = word[1]!;
      i += word[0].length;
      if (Object.hasOwn(SYMBOLS, name)) { buffer += SYMBOLS[name]; if (/^[A-Za-z]/.test(name)) i = skipSpace(text, i); continue; }
      if (Object.hasOwn(STYLES, name)) {
        const arg = braceArg(text, i);
        i = arg.end;
        const children = parseLatexInline(arg.value);
        const style = STYLES[name]!;
        if (style === "plain") { flush(); out.push(...children); } else push({ type: style, children });
        continue;
      }
      if (Object.hasOwn(SWITCHES, name)) {
        push({ type: SWITCHES[name]!, children: parseLatexInline(text.slice(i)) });
        i = text.length;
        continue;
      }
      if (DROPPED.has(name)) {
        i = skipOptional(text, i).end;
        if (text.charAt(skipSpace(text, i)) === "{") i = braceArg(text, i).end;
        continue;
      }
      // An unknown command keeps the content of its brace arguments.
      i = /^[A-Za-z]/.test(name) ? skipSpace(text, i) : i;
      continue;
    }
    if (c === "{") {
      const end = closeBrace(text, i);
      flush();
      out.push(...parseLatexInline(text.slice(i + 1, end - 1)));
      i = end;
      continue;
    }
    if (c === "}") fail("unbalanced braces");
    if (c === "~") { buffer += " "; i++; continue; }
    if (text.startsWith("---", i)) { buffer += "—"; i += 3; continue; }
    if (text.startsWith("--", i)) { buffer += "–"; i += 2; continue; }
    if (text.startsWith("``", i)) { buffer += "“"; i += 2; continue; }
    if (text.startsWith("''", i)) { buffer += "”"; i += 2; continue; }
    if (/\s/.test(c)) { if (!/\s$/.test(buffer)) buffer += " "; i++; continue; }
    buffer += c;
    i++;
  }
  flush();
  return trimInline(out);
}

/** Drops the spaces at the start and end of inline content. */
function trimInline(nodes: LatexInline[]): LatexInline[] {
  const first = nodes[0];
  if (first?.type === "text") { first.text = first.text.replace(/^\s+/, ""); if (!first.text) nodes.shift(); }
  const last = nodes[nodes.length - 1];
  if (last?.type === "text") { last.text = last.text.replace(/\s+$/, ""); if (!last.text) nodes.pop(); }
  return nodes;
}
