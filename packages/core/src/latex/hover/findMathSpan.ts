/**
 * Finds the math expression of a LaTeX source that covers an offset: inline, display or a math environment.
 */
import { lineEnd } from "../../text/index.js";

export interface MathSpan {
  /** What MathJax renders: the inner TeX for delimiters, the whole `\begin…\end` for environments. */
  tex: string;
  display: boolean;
  /** Offsets of the span including its delimiters, end exclusive. */
  start: number;
  end: number;
}

const MATH_ENVIRONMENTS = new Set([
  "equation", "equation*", "align", "align*", "gather", "gather*", "multline", "multline*",
  "flalign", "flalign*", "alignat", "alignat*", "eqnarray", "eqnarray*", "displaymath", "math",
]);

const BEGIN = /^\\begin\{([^}]*)\}/;

/** Returns the span at `offset`, or undefined when the offset is in text, a comment or unclosed math. */
export function findMathSpan(text: string, offset: number): MathSpan | undefined {
  let i = 0;
  while (i < text.length && i <= offset) {
    const span = spanStartingAt(text, i);
    if (span === "comment") i = lineEnd(text, i);
    else if (typeof span === "number") i = span;
    else if (span === undefined) return undefined;
    else if (offset < span.end) return offset >= span.start ? span : undefined;
    else i = span.end;
  }
  return undefined;
}

/**
 * Reads what starts at `i`: a math span, a comment, or the next offset to look at.
 * Undefined means math opens here but never closes.
 */
function spanStartingAt(text: string, i: number): MathSpan | "comment" | number | undefined {
  const char = text[i];
  if (char === "%") return "comment";
  if (char === "$") {
    const display = text[i + 1] === "$";
    return delimited(text, i, display ? "$$" : "$", display ? "$$" : "$", display);
  }
  if (char !== "\\") return i + 1;
  const next = text[i + 1];
  if (next === "(") return delimited(text, i, "\\(", "\\)", false);
  if (next === "[") return delimited(text, i, "\\[", "\\]", true);
  const name = BEGIN.exec(text.slice(i, i + 40))?.[1];
  if (name !== undefined && MATH_ENVIRONMENTS.has(name)) return environment(text, i, name);
  // Skipping the escaped character keeps `\$` and `\%` out of the scan.
  return i + 2;
}

function delimited(text: string, start: number, open: string, close: string, display: boolean): MathSpan | undefined {
  const innerStart = start + open.length;
  const closeAt = findClose(text, innerStart, close);
  if (closeAt < 0) return undefined;
  return { tex: text.slice(innerStart, closeAt), display, start, end: closeAt + close.length };
}

/** Finds `close` past escaped characters, so `\$` inside `$…$` does not end it. */
function findClose(text: string, from: number, close: string): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === "\\" && !close.startsWith("\\")) i++;
    else if (text.startsWith(close, i)) return i;
    else if (close === "$" && text[i] === "\n" && text[i + 1] === "\n") return -1;
  }
  return -1;
}

function environment(text: string, start: number, name: string): MathSpan | undefined {
  const endTag = `\\end{${name}}`;
  const endAt = text.indexOf(endTag, start);
  if (endAt < 0) return undefined;
  const end = endAt + endTag.length;
  return { tex: text.slice(start, end), display: true, start, end };
}
