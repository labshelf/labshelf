// Finds the environment a line ending in \begin{name} opens and that no \end{name} closes yet.

import { escapeRegExp } from "../../search/index.js";

// Arguments written after the name, such as [htbp] or {ll}, may follow the closing brace.
const BEGIN_AT_END = /\\begin\{([A-Za-z]+\*?)\}(?:\s*(?:\[[^\]]*\]|\{[^{}]*\}))*\s*$/;
const COMMENT_START = /(^|[^\\])%/;
const COMMENT_TO_LINE_END = /(^|[^\\])%.*$/gm;

// Nested pairs of the same name are balanced; an \end{name} met at depth zero closes the typed \begin.
function hasUnmatchedEnd(name: string, text: string): boolean {
  const tag = new RegExp(String.raw`\\(begin|end)\{${escapeRegExp(name)}\}`, "g");
  let depth = 0;
  for (const match of text.replace(COMMENT_TO_LINE_END, "$1").matchAll(tag)) {
    if (match[1] === "begin") { depth += 1; } else if (depth === 0) { return true; } else { depth -= 1; }
  }
  return false;
}

/**
 * The name to close, or undefined when the line before the cursor does not end in `\begin{name}` (with optional
 * arguments) or an `\end{name}` already follows. `textAfterCursor` is lazy because most lines do not end in a \begin.
 */
export function environmentToClose(lineBeforeCursor: string, textAfterCursor: () => string): string | undefined {
  const name = BEGIN_AT_END.exec(lineBeforeCursor)?.[1];
  if (name === undefined) { return undefined; }
  if (COMMENT_START.test(lineBeforeCursor)) { return undefined; }
  return hasUnmatchedEnd(name, textAfterCursor()) ? undefined : name;
}
