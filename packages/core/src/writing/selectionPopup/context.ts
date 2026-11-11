// Tells what a selection of a LaTeX or Typst source is on (prose, math, a citation key, a reference or label, several lines), for the actions the selection popup suggests, and derives the text edits of those actions.
import { scanTypingContext } from "../typing/context.js";
import type { TypingLanguage } from "../typing/helpers.js";

/** Where "Page…" puts the cursor: an empty argument inserted at `at`, or the existing one selected. */
export type CitationPageTarget =
  | { kind: "insert"; at: number; text: string; cursor: number }
  | { kind: "select"; from: number; to: number };

export interface SelectionCitation {
  key: string;
  /** Offsets of the key in the text. */
  from: number;
  to: number;
  page: CitationPageTarget;
}

export interface SelectionReference {
  name: string;
  /** Offsets of the label name in the text. */
  from: number;
  to: number;
  /** The label's definition (`\label{x}`, `<x>`) rather than a use of it. */
  definition: boolean;
}

/** Inline math around the selection: its whole span, delimiters included, and its body. */
export interface SelectionInlineMath {
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
}

export type SelectionKind = "prose" | "math" | "citation" | "reference" | "multiline" | "other";

export interface SelectionContext {
  kind: SelectionKind;
  citation?: SelectionCitation;
  reference?: SelectionReference;
  /** Set for a selection in inline math that "To display" can turn into display math. */
  inlineMath?: SelectionInlineMath;
}

export interface SelectionContextOptions {
  /** The cite keys of the library's papers: a Typst `@key` is a citation only for one of them. */
  citeKeys?: ReadonlySet<string>;
}

const LATEX_CITE = /\\[A-Za-z]*[Cc]ite[A-Za-z]*\*?\s*((?:\[[^\]\n]*\]\s*){0,2})\{([^{}\n]*)\}/g;
const LATEX_REFERENCE = /\\(ref|eqref|cref|Cref|autoref|pageref|nameref|vref|label)\*?\s*\{([^{}\n]*)\}/g;
const TYPST_AT = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_][\p{L}\p{N}_:.-]*[\p{L}\p{N}_])/gu;
const TYPST_LABEL = /<([\p{L}\p{N}_][\p{L}\p{N}_:.-]*)>/gu;

interface KeyPart { key: string; from: number; to: number }

/** The comma-separated keys of a list starting at `listStart`. */
function splitKeys(list: string, listStart: number): KeyPart[] {
  return [...list.matchAll(/[^,\s][^,]*/g)].map((part) => {
    const key = part[0].trimEnd();
    return { key, from: listStart + part.index, to: listStart + part.index + key.length };
  });
}

/** The key that holds the selection whole; a cursor at either end of a key is on it. */
const keyAt = (parts: readonly KeyPart[], from: number, to: number): KeyPart | undefined => parts.find((part) => from >= part.from && to <= part.to);

function lineAround(text: string, from: number, to: number): { start: number; line: string } {
  const start = text.lastIndexOf("\n", from - 1) + 1;
  const endAt = text.indexOf("\n", to);
  return { start, line: text.slice(start, endAt < 0 ? text.length : endAt) };
}

/** The first `pattern` match on the selection's line whose key list (group 2) holds the selection: its key, or "list" when the selection is not on one key. */
function latexKeyMatch(text: string, from: number, to: number, pattern: RegExp): { match: RegExpMatchArray; listStart: number; part: KeyPart } | "list" | undefined {
  const { start, line } = lineAround(text, from, to);
  for (const match of line.matchAll(pattern)) {
    const listStart = start + match.index + match[0].length - 1 - match[2]!.length;
    if (from < listStart || to > listStart + match[2]!.length) continue;
    const part = keyAt(splitKeys(match[2]!, listStart), from, to);
    return part ? { match, listStart, part } : "list";
  }
  return undefined;
}

function latexCitation(text: string, from: number, to: number): SelectionCitation | "list" | undefined {
  const found = latexKeyMatch(text, from, to, LATEX_CITE);
  if (typeof found !== "object") return found;
  const { match, listStart, part } = found;
  const options = [...match[1]!.matchAll(/\[([^\]]*)\]/g)];
  const last = options.at(-1);
  const optionsStart = listStart - 1 - match[1]!.length;
  const page: CitationPageTarget = last
    ? { kind: "select", from: optionsStart + last.index + 1, to: optionsStart + last.index + 1 + last[1]!.length }
    : { kind: "insert", at: listStart - 1, text: "[]", cursor: listStart };
  return { ...part, page };
}

function latexReference(text: string, from: number, to: number): SelectionReference | "list" | undefined {
  const found = latexKeyMatch(text, from, to, LATEX_REFERENCE);
  if (typeof found !== "object") return found;
  return { name: found.part.key, from: found.part.from, to: found.part.to, definition: found.match[1] === "label" };
}

function typstToken(text: string, from: number, to: number, citeKeys: ReadonlySet<string>): Pick<SelectionContext, "citation" | "reference"> | undefined {
  const { start, line } = lineAround(text, from, to);
  for (const match of line.matchAll(TYPST_AT)) {
    const keyFrom = start + match.index + 1;
    const keyTo = keyFrom + match[1]!.length;
    if (from < keyFrom - 1 || to > keyTo) continue;
    const key = match[1]!;
    if (!citeKeys.has(key)) return { reference: { name: key, from: keyFrom, to: keyTo, definition: false } };
    const close = text[keyTo] === "[" ? text.indexOf("]", keyTo) : -1;
    const page: CitationPageTarget = close >= 0
      ? { kind: "select", from: keyTo + 1, to: close }
      : { kind: "insert", at: keyTo, text: "[]", cursor: keyTo + 1 };
    return { citation: { key, from: keyFrom, to: keyTo, page } };
  }
  for (const match of line.matchAll(TYPST_LABEL)) {
    const nameFrom = start + match.index + 1;
    const nameTo = nameFrom + match[1]!.length;
    if (from < nameFrom - 1 || to > nameTo + 1) continue;
    // `#cite(<key>)` cites; it is not a label of the document.
    if (/#cite\(\s*$/.test(line.slice(0, match.index))) return undefined;
    return { reference: { name: match[1]!, from: nameFrom, to: nameTo, definition: true } };
  }
  return undefined;
}

const unescapedAt = (text: string, index: number): boolean => {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) slashes += 1;
  return slashes % 2 === 0;
};

const MAX_CANDIDATES = 40;

/** The inline math (`$…$`, or LaTeX `\(…\)`) that holds the whole selection; undefined when it is display math or there is none. */
function findInlineMath(language: TypingLanguage, text: string, from: number, to: number, open: string): SelectionInlineMath | undefined {
  const opener = open === "\\(" ? "\\(" : open === "$" ? "$" : undefined;
  if (!opener) return undefined;
  const closer = opener === "\\(" ? "\\)" : "$";
  let start = from;
  let opened = false;
  for (let tries = 0; tries < MAX_CANDIDATES && !opened; tries += 1) {
    start = text.lastIndexOf(opener, start - 1);
    if (start < 0) return undefined;
    if (opener === "$" && (text[start - 1] === "$" || text[start + 1] === "$")) continue;
    opened = unescapedAt(text, start) && scanTypingContext(language, text, start).context !== "math"
      && scanTypingContext(language, text, start + opener.length).context === "math";
  }
  if (!opened) return undefined;
  let end = to - 1;
  let closed = false;
  for (let tries = 0; tries < MAX_CANDIDATES && !closed; tries += 1) {
    end = text.indexOf(closer, end + 1);
    if (end < 0) return undefined;
    closed = (closer !== "$" || unescapedAt(text, end)) && scanTypingContext(language, text, end + closer.length).context !== "math";
  }
  if (!closed) return undefined;
  const bodyFrom = start + opener.length;
  const body = text.slice(bodyFrom, end);
  // Typst math with a space after `$` and before the closing `$` is already display math.
  if (language === "typst" && /^\s/.test(body) && /\s$/.test(body)) return undefined;
  return { from: start, to: end + closer.length, bodyFrom, bodyTo: end };
}

/**
 * What the selection `from`..`to` of `text` is on. A citation or reference wins when the selection (or a cursor) is on one
 * key of the list; otherwise the typing context at both ends decides: math, prose, several lines of prose, or other (a
 * comment, verbatim, a Typst string, or a mix).
 */
export function deriveSelectionContext(language: TypingLanguage, text: string, from: number, to: number, options: SelectionContextOptions = {}): SelectionContext {
  const start = scanTypingContext(language, text, from);
  if (start.context === "comment" || start.context === "verbatim" || start.context === "string") return { kind: "other" };
  if (language === "latex") {
    const citation = latexCitation(text, from, to);
    if (citation === "list") return { kind: "other" };
    if (citation) return { kind: "citation", citation };
    const reference = latexReference(text, from, to);
    if (reference === "list") return { kind: "other" };
    if (reference) return { kind: "reference", reference };
  } else {
    const token = typstToken(text, from, to, options.citeKeys ?? new Set());
    if (token?.citation) return { kind: "citation", citation: token.citation };
    if (token?.reference) return { kind: "reference", reference: token.reference };
  }
  const end = from === to ? start : scanTypingContext(language, text, to);
  if (start.context === "math" && end.context === "math") {
    const inlineMath = findInlineMath(language, text, from, to, start.mathOpen ?? "");
    return { kind: "math", ...(inlineMath && { inlineMath }) };
  }
  if (start.context !== "text" || end.context !== "text") return { kind: "other" };
  return { kind: text.slice(from, to).includes("\n") ? "multiline" : "prose" };
}

export interface TextReplacement { from: number; to: number; insert: string }

/** Inline math turned into display math: an equation environment in LaTeX, `$ … $` in Typst. */
export function deriveDisplayMath(language: TypingLanguage, text: string, math: SelectionInlineMath): TextReplacement {
  const body = text.slice(math.bodyFrom, math.bodyTo).trim();
  if (language === "typst") return { from: math.from, to: math.to, insert: `$ ${body} $` };
  const lineStart = text.lastIndexOf("\n", math.from - 1) + 1;
  const lineEnd = text.indexOf("\n", math.to);
  const before = text.slice(lineStart, math.from).trim() === "" ? "" : "\n";
  const after = text.slice(math.to, lineEnd < 0 ? text.length : lineEnd).trim() === "" ? "" : "\n";
  return { from: math.from, to: math.to, insert: `${before}\\begin{equation}\n  ${body}\n\\end{equation}${after}` };
}

/** Every use and the definition of label `name` in `text`: LaTeX reference and label arguments, Typst `@name` and `<name>`. */
export function findLabelOccurrences(language: TypingLanguage, text: string, name: string): { from: number; to: number; definition: boolean }[] {
  const found: { from: number; to: number; definition: boolean }[] = [];
  if (language === "latex") {
    for (const match of text.matchAll(LATEX_REFERENCE)) {
      const listStart = match.index + match[0].length - 1 - match[2]!.length;
      for (const part of splitKeys(match[2]!, listStart)) if (part.key === name) found.push({ from: part.from, to: part.to, definition: match[1] === "label" });
    }
    return found;
  }
  for (const match of text.matchAll(TYPST_AT)) if (match[1] === name) found.push({ from: match.index + 1, to: match.index + 1 + name.length, definition: false });
  for (const match of text.matchAll(TYPST_LABEL)) if (match[1] === name) found.push({ from: match.index + 1, to: match.index + 1 + name.length, definition: true });
  return found.sort((a, b) => a.from - b.from);
}

/** A file name from the first words of a selection: `sections/<slug>.tex` or `.typ`. */
export function deriveExtractPath(language: TypingLanguage, selected: string): string {
  const heading = /\\(?:sub)*section\*?\s*\{([^}]*)\}|^\s*=+\s*(.+)$/m.exec(selected);
  const source = heading?.[1] ?? heading?.[2] ?? selected;
  const slug = source.replace(/\\[A-Za-z]+/g, " ").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").split("-").filter(Boolean).slice(0, 5).join("-") || "section";
  return `sections/${slug}.${language === "typst" ? "typ" : "tex"}`;
}

/** The line that brings an extracted file back in: `\input{path}` without `.tex`, `#include "path"`. */
export function deriveIncludeLine(language: TypingLanguage, path: string): string {
  return language === "typst" ? `#include "${path}"` : `\\input{${path.replace(/\.tex$/, "")}}`;
}
