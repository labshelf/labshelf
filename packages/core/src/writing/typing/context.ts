// Tells what the cursor of a LaTeX or Typst source sits in (text, math, a comment, verbatim or a Typst string) by scanning the text before it; there is no syntax tree.
import type { TypingLanguage } from "./helpers.js";

export type TypingContext = "text" | "math" | "comment" | "verbatim" | "string";

/** The context, and for math the delimiter that opened it (`$`, `$$`, `\(`, `\[` or an environment name). */
export interface TypingScan {
  context: TypingContext;
  mathOpen?: string;
}

const VERBATIM_ENVIRONMENTS = new Set(["verbatim", "verbatim*", "Verbatim", "lstlisting", "minted", "comment"]);
const MATH_ENVIRONMENTS = new Set(["equation", "align", "gather", "multline", "flalign", "alignat", "eqnarray", "displaymath", "math"].flatMap((name) => [name, `${name}*`]));
const TEXT_COMMANDS = new Set(["text", "textrm", "textit", "textbf", "textsf", "texttt", "textnormal", "mbox", "intertext"]);

type Frame = { kind: "math"; close: string } | { kind: "text"; depth: number } | { kind: "verbatim"; end: string };

const isLetter = (c: string | undefined): boolean => c !== undefined && /[A-Za-z]/.test(c);

/** Drops the $ and $$ math a blank line ends, with whatever was opened inside it. */
function endDollarMath(stack: Frame[]): void {
  const index = stack.findIndex((frame) => frame.kind === "math" && (frame.close === "$" || frame.close === "$$"));
  if (index >= 0) stack.length = index;
}

/** Reads the letter command at `i` (its arguments up to `pos`), pushes or pops the frames it opens or closes, and returns where scanning goes on. */
function scanLatexCommand(text: string, i: number, pos: number, stack: Frame[]): number | "verbatim" {
  let j = i + 1;
  while (j < pos && isLetter(text[j])) j += 1;
  const name = text.slice(i + 1, j);
  const top = stack.at(-1);
  if (name === "verb") {
    let d = j;
    if (text[d] === "*") d += 1;
    if (d >= pos) return "verbatim";
    const end = text.indexOf(text[d]!, d + 1);
    const eol = text.indexOf("\n", d + 1);
    if (end < 0 || end >= pos || (eol >= 0 && eol < end)) return "verbatim";
    return end + 1;
  }
  if ((name === "begin" || name === "end") && text[j] === "{") {
    const close = text.indexOf("}", j + 1);
    if (close < 0 || close >= pos) return j;
    const env = text.slice(j + 1, close);
    if (name === "begin" && VERBATIM_ENVIRONMENTS.has(env)) stack.push({ kind: "verbatim", end: `\\end{${env}}` });
    else if (name === "begin" && MATH_ENVIRONMENTS.has(env)) stack.push({ kind: "math", close: env });
    else if (name === "end" && top?.kind === "math" && top.close === env) stack.pop();
    return close + 1;
  }
  if (top?.kind === "math" && TEXT_COMMANDS.has(name) && text[j] === "{" && j < pos) {
    stack.push({ kind: "text", depth: 1 });
    return j + 1;
  }
  return j;
}

function scanLatex(text: string, pos: number): TypingScan {
  const stack: Frame[] = [];
  let lineStart = 0;
  let i = 0;
  while (i < pos) {
    const top = stack.at(-1);
    if (top?.kind === "verbatim") {
      const end = text.indexOf(top.end, i);
      if (end < 0 || end + top.end.length > pos) return { context: "verbatim" };
      stack.pop();
      i = end + top.end.length;
      continue;
    }
    const c = text[i]!;
    if (c === "\\") {
      const next = text[i + 1];
      if (i + 1 >= pos) break;
      if (isLetter(next)) {
        const after = scanLatexCommand(text, i, pos, stack);
        if (after === "verbatim") return { context: "verbatim" };
        i = after;
        continue;
      }
      if ((next === "(" || next === "[") && top?.kind !== "math") stack.push({ kind: "math", close: next === "(" ? "\\)" : "\\]" });
      else if ((next === ")" || next === "]") && top?.kind === "math" && top.close === `\\${next}`) stack.pop();
      i += 2;
      continue;
    }
    if (c === "%") {
      const eol = text.indexOf("\n", i);
      if (eol < 0 || eol >= pos) return { context: "comment" };
      i = eol;
      continue;
    }
    if (c === "$") {
      const double = text[i + 1] === "$" && i + 1 < pos;
      if (top?.kind === "math" && top.close === "$$") { stack.pop(); i += double ? 2 : 1; continue; }
      if (top?.kind === "math" && top.close === "$") { stack.pop(); i += 1; continue; }
      stack.push({ kind: "math", close: double ? "$$" : "$" });
      i += double ? 2 : 1;
      continue;
    }
    if (c === "\n") {
      if (lineStart > 0 && text.slice(lineStart, i).trim() === "") endDollarMath(stack);
      lineStart = i + 1;
    } else if (top?.kind === "text" && (c === "{" || c === "}")) {
      top.depth += c === "{" ? 1 : -1;
      if (top.depth === 0) stack.pop();
    }
    i += 1;
  }
  const top = stack.at(-1);
  return top?.kind === "math" ? { context: "math", mathOpen: top.close } : { context: "text" };
}

/** The end of a `/* … *\/` comment opened at `i` (nesting), or -1 when it is not closed. */
function blockCommentEnd(text: string, i: number): number {
  let depth = 1;
  let j = i + 2;
  while (j < text.length) {
    if (text.startsWith("/*", j)) { depth += 1; j += 2; } else if (text.startsWith("*/", j)) {
      depth -= 1; j += 2;
      if (depth === 0) return j;
    } else j += 1;
  }
  return -1;
}

/** The end of the raw text opened by `run` backticks at `i`, or -1 when it is not closed. */
function rawEnd(text: string, i: number, run: number): number {
  if (run < 3) {
    const close = text.indexOf("`", i + 1);
    return close < 0 ? -1 : close + 1;
  }
  let j = i + run;
  while (j < text.length) {
    const open = text.indexOf("`", j);
    if (open < 0) return -1;
    let end = open;
    while (text[end] === "`") end += 1;
    if (end - open >= run) return end;
    j = end;
  }
  return -1;
}

function scanTypst(text: string, pos: number): TypingScan {
  let math = false;
  let i = 0;
  while (i < pos) {
    const c = text[i]!;
    if (c === "\\") { i += 2; continue; }
    if (c === "/" && text[i + 1] === "/" && i + 1 < pos && text[i - 1] !== ":") {
      const eol = text.indexOf("\n", i);
      if (eol < 0 || eol >= pos) return { context: "comment" };
      i = eol;
      continue;
    }
    if (c === "/" && text[i + 1] === "*" && i + 1 < pos) {
      const end = blockCommentEnd(text, i);
      if (end < 0 || end > pos) return { context: "comment" };
      i = end;
      continue;
    }
    if (c === "`" && !math) {
      let run = 0;
      while (i + run < pos && text[i + run] === "`") run += 1;
      // `` is an empty raw span, not an opener.
      if (run === 2) { i += 2; continue; }
      const end = rawEnd(text, i, run);
      if (end < 0 || end > pos) return { context: "verbatim" };
      i = end;
      continue;
    }
    if (c === "$") { math = !math; i += 1; continue; }
    if (math && c === "\"") {
      let j = i + 1;
      while (j < text.length && text[j] !== "\"") j += text[j] === "\\" ? 2 : 1;
      if (j >= pos) return { context: "string" };
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return math ? { context: "math", mathOpen: "$" } : { context: "text" };
}

/** The context at `pos` and, in math, its opening delimiter. */
export function scanTypingContext(language: TypingLanguage, text: string, pos: number): TypingScan {
  return language === "latex" ? scanLatex(text, pos) : scanTypst(text, pos);
}

/** What the cursor at `pos` sits in, read from the text before it only. */
export function deriveTypingContext(language: TypingLanguage, text: string, pos: number): TypingContext {
  return scanTypingContext(language, text, pos).context;
}
