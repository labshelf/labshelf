// Finds where LaTeX completion applies in a line: the environment a typed \begin{name} still has to close, and the span a completion replaces.

import { escapeRegExp } from "../writing/search/index.js";

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
export function findEnvironmentToClose(lineBeforeCursor: string, textAfterCursor: () => string): string | undefined {
  const name = BEGIN_AT_END.exec(lineBeforeCursor)?.[1];
  if (name === undefined) { return undefined; }
  if (COMMENT_START.test(lineBeforeCursor)) { return undefined; }
  return hasUnmatchedEnd(name, textAfterCursor()) ? undefined : name;
}

const ENVIRONMENT_CONTEXT = /\\(begin|end)\{([A-Za-z]*\*?)$/;
const COMMAND_CONTEXT = /(?:^|[^\\])(\\[A-Za-z]*)$/;
const NAME_AND_BRACE_AFTER_CURSOR = /^[A-Za-z]*\*?\}?/;

export type LatexCompletionSpan =
  /** `before` name characters precede the cursor; `after` name characters and a closing `}` follow it. */
  | { kind: "environment"; closing: boolean; before: number; after: number }
  /** `before` characters of the backslash and command name precede the cursor. */
  | { kind: "command"; before: number };

/**
 * The span inside `\begin{…}`, `\end{…}` or after a typed `\command`, or undefined anywhere else. A `}` that bracket
 * closing already put after the cursor counts in `after`, so the item replaces it.
 */
export function findLatexCompletionSpan(lineBeforeCursor: string, lineAfterCursor: string): LatexCompletionSpan | undefined {
  const environment = ENVIRONMENT_CONTEXT.exec(lineBeforeCursor);
  if (environment) {
    const after = NAME_AND_BRACE_AFTER_CURSOR.exec(lineAfterCursor)?.[0].length ?? 0;
    return { kind: "environment", closing: environment[1] === "end", before: environment[2]!.length, after };
  }
  const command = COMMAND_CONTEXT.exec(lineBeforeCursor)?.[1];
  return command === undefined ? undefined : { kind: "command", before: command.length };
}

/** `$1` becomes `${1}`, and a literal brace after a backslash stays literal (CodeMirror reads `\{` as an escape). */
export function deriveSnippetTemplate(vscodeSnippet: string): string {
  return vscodeSnippet.replace(/\\([{}])/g, "\\\\$1").replace(/\$(\d+)/g, "$${$1}");
}

/** The `name[options]{arg}` a command item shows: the first line of its snippet with each placeholder read as its default text. */
export function deriveSnippetSignature(vscodeSnippet: string): string {
  let text = vscodeSnippet.split("\n")[0]!;
  // Placeholders nest, so the innermost is read first until none is left.
  for (let previous = ""; previous !== text;) {
    previous = text;
    text = text.replace(/\$\{\d+:([^${}]*)\}/g, "$1").replace(/\$\{?\d+\}?/g, "");
  }
  return text.trimEnd();
}

// The commands and environments most papers use, most common first; the completion list leads with them.
const COMMON_COMMANDS = [
  "begin", "end", "usepackage", "section", "subsection", "item", "label", "ref", "cite", "textbf", "emph", "textit", "frac",
  "includegraphics", "caption", "centering", "eqref", "cref", "footnote", "documentclass", "subsubsection", "title", "author",
  "maketitle", "text", "mathbf", "mathrm", "mathbb", "left", "right", "sqrt", "sum", "int", "newcommand", "hline", "url", "href",
  "input", "vspace", "hspace", "noindent", "newpage", "toprule", "midrule", "bottomrule",
];
const COMMON_ENVIRONMENTS = [
  "itemize", "enumerate", "figure", "table", "equation", "align", "tabular", "center", "equation*", "align*", "abstract", "document",
];

/** `top` for the first name of `list`, one less for each next one, `otherwise` for a name not in it. */
const rankBoost = (list: readonly string[], name: string, top: number, otherwise: number): number => {
  const index = list.indexOf(name);
  return index === -1 ? otherwise : top - index;
};

/**
 * The CodeMirror boost of a command item: common commands from 60 down, the rest -1. Every boost stays inside ±99, under
 * the 100 a worse match costs, so it only orders items the typed text matches equally well.
 */
export const deriveCommandBoost = (name: string): number => rankBoost(COMMON_COMMANDS, name, 60, -1);

/**
 * The boost of an environment item. Offered after a backslash as `\begin{name}`, it ranks under every command so the bare
 * backslash list is not filled with environments; inside `\begin{` the common ones lead.
 */
export const deriveEnvironmentBoost = (name: string, afterBackslash: boolean): number =>
  afterBackslash ? rankBoost(COMMON_ENVIRONMENTS, name, -2, -30) : rankBoost(COMMON_ENVIRONMENTS, name, 30, -1);
