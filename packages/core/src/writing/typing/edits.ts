// Decides the edit each typing helper makes for a typed character, Backspace or Enter at one selection; undefined lets the editor's own edit happen.
import { findEnvironmentToClose } from "../../latex/catalogCompletion.js";
import { scanTypingContext, type TypingScan } from "./context.js";
import type { TypingHelpers, TypingLanguage } from "./helpers.js";

export interface TypingChange { from: number; to: number; insert: string }

/** The changes, in the text before them; the selection and the inserted closers to track, in the text after them. */
export interface TypingEdit {
  changes: TypingChange[];
  anchor: number;
  head: number;
  /** Positions of auto-inserted closing text that typing the same character may step over. */
  autoClosers?: number[];
}

/** Whether a tracked auto-inserted closer starts at the position. */
export type AutoCloserCheck = (pos: number) => boolean;

const CLOSE_BEFORE = new Set([")", "]", "}", "$", ",", ".", ";", ":", "'", "\""]);
const PAIRS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };
const SIZES: Readonly<Record<string, string>> = { left: "right", bigl: "bigr", Bigl: "Bigr", biggl: "biggr", Biggl: "Biggr" };
const NAMED_DELIMITERS: Readonly<Record<string, string>> = { langle: "rangle", lfloor: "rfloor", lceil: "rceil", lvert: "rvert", lVert: "rVert" };
const LEFT_DELIMITERS: ReadonlyArray<readonly [string, string]> = [
  ["(", ")"], ["[", "]"], ["|", "|"], ["\\{", "\\}"], ["\\|", "\\|"],
  ...Object.entries(NAMED_DELIMITERS).map(([open, close]) => [`\\${open}`, `\\${close}`] as const),
];
const SIZE_BEFORE = /\\(left|bigl|Bigl|biggl|Biggl)$/;
const SIZE_ESCAPED_BEFORE = /\\(left|bigl|Bigl|biggl|Biggl)\\$/;
const SIZE_NAMED_BEFORE = /\\(left|bigl|Bigl|biggl|Biggl)\\([A-Za-z]+)$/;
const WORD_BEFORE = /[\p{L}\p{N}_]$/u;

/** Odd backslashes right before `pos`: the next character is escaped. */
export function isEscapedAt(text: string, pos: number): boolean {
  let count = 0;
  while (pos - count - 1 >= 0 && text[pos - count - 1] === "\\") count += 1;
  return count % 2 === 1;
}

/** A closer may be added only before the end of the line, a space or a closing or punctuation character. */
export function isClosingAllowed(text: string, pos: number): boolean {
  const next = text[pos];
  return next === undefined || /\s/.test(next) || CLOSE_BEFORE.has(next);
}

const cursorAt = (changes: TypingChange[], cursor: number, autoClosers?: number[]): TypingEdit => ({ changes, anchor: cursor, head: cursor, ...(autoClosers ? { autoClosers } : {}) });

/** `open|close` at an empty selection, the closer tracked. */
function pair(pos: number, open: string, close: string): TypingEdit {
  const cursor = pos + open.length;
  return cursorAt([{ from: pos, to: pos, insert: open + close }], cursor, [cursor]);
}

const stepOver = (pos: number, length: number): TypingEdit => cursorAt([], pos + length);

/** Stepping over a tracked closer: the character itself, or a LaTeX `\right)` whose delimiter is typed. */
function deriveOvertype(language: TypingLanguage, text: string, pos: number, typed: string, isAutoCloser: AutoCloserCheck): TypingEdit | undefined {
  if (!")]}'\"|".includes(typed) || !isAutoCloser(pos)) return undefined;
  if (text[pos] === typed) return stepOver(pos, 1);
  if (language !== "latex") return undefined;
  const right = /^\\(?:right|bigr|Bigr|biggr|Biggr)\\?(.)/.exec(text.slice(pos, pos + 8));
  return right && right[1] === typed ? stepOver(pos, right[0].length) : undefined;
}

function deriveLatexDollar(text: string, pos: number, scan: TypingScan): TypingEdit | undefined {
  if (scan.context === "math") {
    const empty = text[pos - 1] === "$" && text[pos] === "$" && text[pos - 2] !== "$" && text[pos + 1] !== "$" && !isEscapedAt(text, pos - 1);
    if (empty) return cursorAt([{ from: pos, to: pos, insert: "$$" }], pos + 1);
    if (text[pos] !== "$") return undefined;
    return stepOver(pos, scan.mathOpen === "$$" && text[pos + 1] === "$" ? 2 : 1);
  }
  return isClosingAllowed(text, pos) ? cursorAt([{ from: pos, to: pos, insert: "$$" }], pos + 1) : undefined;
}

function deriveTypstDollar(text: string, pos: number, scan: TypingScan): TypingEdit | undefined {
  if (scan.context === "math") return text[pos] === "$" ? stepOver(pos, 1) : undefined;
  return isClosingAllowed(text, pos) ? cursorAt([{ from: pos, to: pos, insert: "$$" }], pos + 1) : undefined;
}

/** `\left(` → `\left(|\right)`, `\left\{`, `\left\|` and `\left\langle` (completed by its last letter) likewise, and the \bigl sizes. */
function deriveLeftRight(text: string, pos: number, typed: string): TypingEdit | undefined {
  const before = text.slice(Math.max(0, pos - 16), pos);
  let size: string | undefined;
  let close: string | undefined;
  if ("([|".includes(typed) && (size = SIZE_BEFORE.exec(before)?.[1])) close = PAIRS[typed] ?? typed;
  else if ((typed === "{" || typed === "|") && (size = SIZE_ESCAPED_BEFORE.exec(before)?.[1])) close = typed === "{" ? "\\}" : "\\|";
  else if (/[A-Za-z]/.test(typed) && !/[A-Za-z]/.test(text[pos] ?? "")) {
    const named = SIZE_NAMED_BEFORE.exec(before + typed);
    const closing = named && NAMED_DELIMITERS[named[2]!];
    if (named && closing) { size = named[1]; close = `\\${closing}`; }
  }
  if (size === undefined || close === undefined || !isClosingAllowed(text, pos)) return undefined;
  return pair(pos, typed, `\\${SIZES[size]}${close}`);
}

function deriveLatexTyped(helpers: TypingHelpers, text: string, pos: number, typed: string, scan: TypingScan): TypingEdit | undefined {
  const escaped = isEscapedAt(text, pos);
  if (typed === "$") return helpers.mathDollar && !escaped ? deriveLatexDollar(text, pos, scan) : undefined;
  if (helpers.leftRight) {
    const leftRight = deriveLeftRight(text, pos, typed);
    if (leftRight) return leftRight;
  }
  if (typed === "(" || typed === "[") {
    if (escaped) return helpers.mathDelimiters && isClosingAllowed(text, pos) ? pair(pos, typed, `\\${PAIRS[typed]}`) : undefined;
    return helpers.brackets && isClosingAllowed(text, pos) ? pair(pos, typed, PAIRS[typed]!) : undefined;
  }
  if (typed === "{") return helpers.brackets && isClosingAllowed(text, pos) ? pair(pos, "{", escaped ? "\\}" : "}") : undefined;
  if (typed === "`") {
    const second = text[pos - 1] === "`" && text[pos - 2] !== "`" && !isEscapedAt(text, pos - 1);
    if (!helpers.quotes || !second || !isClosingAllowed(text, pos)) return undefined;
    return cursorAt([{ from: pos, to: pos, insert: "`''" }], pos + 1, [pos + 1, pos + 2]);
  }
  if ((typed === "^" || typed === "_") && helpers.scripts && scan.context === "math" && !escaped && text[pos] !== "{" && isClosingAllowed(text, pos)) return pair(pos, `${typed}{`, "}");
  return undefined;
}

function deriveTypstTyped(helpers: TypingHelpers, text: string, pos: number, typed: string, scan: TypingScan): TypingEdit | undefined {
  if (isEscapedAt(text, pos)) return undefined;
  if (typed === "$") return helpers.mathDollar ? deriveTypstDollar(text, pos, scan) : undefined;
  if (typed === " " && helpers.mathDollar && scan.context === "math" && text[pos - 1] === "$" && text[pos] === "$" && !isEscapedAt(text, pos - 1)) {
    return cursorAt([{ from: pos, to: pos, insert: "  " }], pos + 1);
  }
  if (PAIRS[typed]) return helpers.brackets && isClosingAllowed(text, pos) ? pair(pos, typed, PAIRS[typed]!) : undefined;
  if (typed === "\"") {
    if (!helpers.quotes || scan.context === "string" || WORD_BEFORE.test(text.slice(Math.max(0, pos - 2), pos))) return undefined;
    return isClosingAllowed(text, pos) ? pair(pos, "\"", "\"") : undefined;
  }
  if ((typed === "^" || typed === "_") && helpers.scripts && scan.context === "math" && text[pos] !== "(" && isClosingAllowed(text, pos)) return pair(pos, `${typed}(`, ")");
  return undefined;
}

/** The markup a typed character puts around a selection; undefined = the character replaces it. */
function deriveWrap(language: TypingLanguage, text: string, from: number, to: number, typed: string, scan: TypingScan): readonly [string, string] | undefined {
  if (isEscapedAt(text, from)) return undefined;
  if (typed === "$") {
    const inMath = language === "typst" && text[from - 1] === "$" && text[to] === "$" && !/^\s|\s$/.test(text.slice(from, to));
    return inMath ? [" ", " "] : ["$", "$"];
  }
  if (PAIRS[typed]) return [typed, PAIRS[typed]!];
  if (scan.context === "math" && (typed === "^" || typed === "_")) return language === "latex" ? [`${typed}{`, "}"] : [`${typed}(`, ")"];
  if (language === "latex") return typed === "`" ? ["``", "''"] : undefined;
  return scan.context === "text" && "*_`\"".includes(typed) ? [typed, typed] : undefined;
}

/**
 * The edit for `typed` (one character) over the selection `from`–`to`. Nothing fires in a comment or verbatim text except
 * stepping over a tracked closer.
 */
export function deriveTypedEdit(language: TypingLanguage, helpers: TypingHelpers, text: string, from: number, to: number, typed: string, isAutoCloser: AutoCloserCheck): TypingEdit | undefined {
  const scan = scanTypingContext(language, text, from);
  if (from !== to) {
    if (!helpers.wrapSelection || scan.context === "comment" || scan.context === "verbatim") return undefined;
    const wrap = deriveWrap(language, text, from, to, typed, scan);
    if (!wrap) return undefined;
    const [open, close] = wrap;
    return { changes: [{ from, to: from, insert: open }, { from: to, to, insert: close }], anchor: from + open.length, head: to + open.length };
  }
  if (helpers.overtype) {
    const over = deriveOvertype(language, text, from, typed, isAutoCloser);
    if (over) return over;
  }
  if (scan.context === "comment" || scan.context === "verbatim") return undefined;
  if (language === "typst" && scan.context === "string") {
    return typed === "\"" && helpers.quotes && text[from] === "\"" ? stepOver(from, 1) : undefined;
  }
  return language === "latex" ? deriveLatexTyped(helpers, text, from, typed, scan) : deriveTypstTyped(helpers, text, from, typed, scan);
}

/** An empty pair Backspace removes whole: before the cursor, after it, and how many characters of each side stay. */
type EmptyPair = readonly [open: string, close: string, keepOpen: number, keepClose: number];

/** The pairs, longest first. */
function emptyPairs(language: TypingLanguage): readonly EmptyPair[] {
  const common: EmptyPair[] = [["(", ")", 0, 0], ["[", "]", 0, 0], ["{", "}", 0, 0], ["\"", "\"", 0, 0]];
  if (language === "typst") return [["$ ", " $", 1, 1], ["$", "$", 0, 0], ...common];
  const leftRight = Object.entries(SIZES).flatMap(([left, right]) => LEFT_DELIMITERS.map(([open, close]): EmptyPair => [`\\${left}${open}`, `\\${right}${close}`, left.length + 1, 0]));
  return [...leftRight, ["$$", "$$", 1, 1], ["\\(", "\\)", 0, 0], ["\\[", "\\]", 0, 0], ["\\{", "\\}", 0, 0], ["``", "''", 1, 0], ["$", "$", 0, 0], ...common];
}

/** Backspace at an empty selection inside an empty pair deletes both sides (`\left(|\right)` keeps `\left`, `$$|$$` keeps `$|$`, ``|'' keeps one backtick). */
export function deriveBackspaceEdit(language: TypingLanguage, helpers: TypingHelpers, text: string, pos: number): TypingEdit | undefined {
  if (!helpers.deletePair) return undefined;
  for (const [open, close, keepOpen, keepClose] of emptyPairs(language)) {
    const start = pos - open.length;
    if (start < 0 || !text.startsWith(open, start) || !text.startsWith(close, pos) || isEscapedAt(text, start)) continue;
    if (language === "latex" && open === "$" && (text[start - 1] === "$" || text[pos + 1] === "$")) continue;
    return cursorAt([{ from: start + keepOpen, to: pos + close.length - keepClose, insert: "" }], start + keepOpen);
  }
  return undefined;
}

const lineIndent = (text: string, lineStart: number): string => /^[ \t]*/.exec(text.slice(lineStart))![0];

/** `\begin{name}` (with arguments) at the end of the line, or `\begin{name|}` with its brace auto-closed: the body line and `\end{name}`. */
function deriveBeginEnd(text: string, pos: number, lineStart: number, lineEnd: number, unit: string): TypingEdit | undefined {
  const before = text.slice(lineStart, pos);
  const indent = lineIndent(text, lineStart);
  const body = `\n${indent}${unit}`;
  const rest = text.slice(pos, lineEnd);
  if (rest.trim() === "") {
    const name = findEnvironmentToClose(before, () => text.slice(lineEnd));
    if (name !== undefined) return cursorAt([{ from: pos, to: lineEnd, insert: `${body}\n${indent}\\end{${name}}` }], pos + body.length);
  }
  if (rest.startsWith("}") && rest.slice(1).trim() === "" && /\\begin\{[A-Za-z]+\*?$/.test(before)) {
    const name = findEnvironmentToClose(`${before}}`, () => text.slice(lineEnd));
    if (name !== undefined) return cursorAt([{ from: pos, to: lineEnd, insert: `}${body}\n${indent}\\end{${name}}` }], pos + 1 + body.length);
  }
  return undefined;
}

/** Enter in an empty display math pair or after a `\begin{name}`: the opener, an indented cursor line and the closer on lines of their own. */
export function deriveEnterEdit(language: TypingLanguage, helpers: TypingHelpers, text: string, pos: number, indentUnit: string): TypingEdit | undefined {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const nextBreak = text.indexOf("\n", pos);
  const lineEnd = nextBreak < 0 ? text.length : nextBreak;
  const context = scanTypingContext(language, text, pos).context;
  if (context === "comment" || context === "verbatim") return undefined;
  const indent = lineIndent(text, lineStart);
  if (helpers.enterMath) {
    const split = (from: number, to: number): TypingEdit => cursorAt([{ from, to, insert: `\n${indent}${indentUnit}\n${indent}` }], from + 1 + indent.length + indentUnit.length);
    if (language === "latex" && text.startsWith("\\[", pos - 2) && text.startsWith("\\]", pos) && !isEscapedAt(text, pos - 2)) return split(pos, pos);
    if (language === "latex" && text.startsWith("$$", pos - 2) && text.startsWith("$$", pos) && !isEscapedAt(text, pos - 2)) return split(pos, pos);
    if (language === "typst" && text.startsWith("$ ", pos - 2) && text.startsWith(" $", pos) && !isEscapedAt(text, pos - 2)) return split(pos - 1, pos + 1);
  }
  return language === "latex" && helpers.beginEnd ? deriveBeginEnd(text, pos, lineStart, lineEnd, indentUnit) : undefined;
}

/** The \begin auto-close alone, for editors without the other helpers. */
export function deriveBeginEndEdit(text: string, pos: number, indentUnit: string): TypingEdit | undefined {
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const nextBreak = text.indexOf("\n", pos);
  return deriveBeginEnd(text, pos, lineStart, nextBreak < 0 ? text.length : nextBreak, indentUnit);
}
