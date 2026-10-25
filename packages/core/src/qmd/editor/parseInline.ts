// Reads the inline Markdown of one paragraph or heading into ProseMirror nodes.
// CONTRACT: documents/contracts/qmd-items.md#format
import { Fragment, type Node } from "prosemirror-model";
import { serializeInline } from "./serializeInline.js";
import { plainInline, hardBreak, splitBreakMarker } from "./lineBreak.js";
import { qmdSchema, matchCitation } from "./schema/index.js";
import { type InlineToken, pushText, tokensToNodes } from "./inlineToken.js";
import { withMark, writesBackAs } from "./writesBack.js";

// CONTRACT: documents/contracts/qmd-items.md#format
function runLength(source: string, at: number, char: string, end: number): number {
  let length = 0;
  while (at + length < end && source[at + length] === char) length++;
  return length;
}

/** INVARIANT: neither construct crosses a line ending, so text nodes never hold "\n". */
function matchCodeSpan(source: string, at: number, end: number): { ticks: number; code: string; end: number } | { ticks: number } {
  const ticks = runLength(source, at, "`", end);
  let index = at + ticks;
  while (index < end && source[index] !== "\n") {
    if (source[index] !== "`") { index++; continue; }
    const run = runLength(source, index, "`", end);
    if (run === ticks) return { ticks, code: source.slice(at + ticks, index), end: index + run };
    index += run;
  }
  return { ticks };
}

/** Pandoc rules: the opening `$` is not followed by whitespace, the closing one is not preceded by whitespace nor followed by a digit. */
function matchMath(source: string, at: number, end: number): { tex: string; end: number } | null {
  const first = source[at + 1];
  if (first === undefined || at + 1 >= end || first === "$" || WHITESPACE.test(first)) return null;
  for (let index = at + 1; index < end && source[index] !== "\n"; index++) {
    if (source[index] === "\\") {
      if (source[index + 1] === "\n") return null;
      index++;
      continue;
    }
    if (source[index] !== "$") continue;
    const after = index + 1 < end ? source[index + 1] ?? "" : "";
    if (!WHITESPACE.test(source[index - 1] ?? "") && !/[0-9]/.test(after)) return { tex: source.slice(at + 1, index), end: index + 1 };
  }
  return null;
}

type Delimiter = Extract<InlineToken, { kind: "delim" }>;

const WHITESPACE = /\s/;
const PUNCTUATION = /[\p{P}\p{S}]/u;

/** Characters outside `[from, end)` count as whitespace, as at the edge of a paragraph or link text. */
function delimiterRun(source: string, at: number, from: number, end: number): Delimiter {
  const char = source[at] ?? "";
  let length = 0;
  while (at + length < end && source[at + length] === char) length++;
  const before = at > from ? source[at - 1] ?? " " : " ";
  const after = at + length < end ? source[at + length] ?? " " : " ";
  const leftFlanking = !WHITESPACE.test(after) && (!PUNCTUATION.test(after) || WHITESPACE.test(before) || PUNCTUATION.test(before));
  const rightFlanking = !WHITESPACE.test(before) && (!PUNCTUATION.test(before) || WHITESPACE.test(after) || PUNCTUATION.test(after));
  // TRAP: `_` inside a word (snake_case_name) neither opens nor closes.
  const canOpen = char === "*" ? leftFlanking : leftFlanking && (!rightFlanking || PUNCTUATION.test(before));
  const canClose = char === "*" ? rightFlanking : rightFlanking && (!leftFlanking || PUNCTUATION.test(after));
  return { kind: "delim", char, count: length, length, canOpen, canClose, start: at, end: at + length };
}

function findOpener(tokens: readonly InlineToken[], closer: Delimiter, before: number): number {
  for (let index = before - 1; index >= 0; index--) {
    const opener = tokens[index];
    if (opener?.kind !== "delim" || !opener.canOpen || opener.char !== closer.char) continue;
    const sum = opener.length + closer.length;
    if ((opener.canClose || closer.canOpen) && sum % 3 === 0 && !(opener.length % 3 === 0 && closer.length % 3 === 0)) continue;
    return index;
  }
  return -1;
}

/** Wraps the tokens between opener and closer; returns the closer's index afterwards, or -1 when the pair does not write back. */
function pair(tokens: InlineToken[], source: string, openerIndex: number, closerIndex: number): number {
  const opener = tokens[openerIndex] as Delimiter;
  const closer = tokens[closerIndex] as Delimiter;
  const use = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
  const start = opener.end - use;
  const end = closer.start + use;
  const mark = qmdSchema.mark(use === 2 ? "strong" : "em", { marker: closer.char });
  const nodes = withMark(tokensToNodes(tokens.slice(openerIndex + 1, closerIndex)), mark);
  if (!writesBackAs(nodes, source.slice(start, end))) return -1;
  opener.count -= use;
  opener.end -= use;
  closer.count -= use;
  closer.start += use;
  tokens.splice(openerIndex + 1, closerIndex - openerIndex - 1, { kind: "nodes", nodes, start, end });
  let index = openerIndex + 2;
  if (opener.count === 0) {
    tokens.splice(openerIndex, 1);
    index--;
  }
  return index;
}

function resolveEmphasis(tokens: InlineToken[], source: string): Node[] {
  for (let index = 0; index < tokens.length; index++) {
    const closer = tokens[index];
    if (closer?.kind !== "delim" || !closer.canClose || closer.count === 0) continue;
    const openerIndex = findOpener(tokens, closer, index);
    if (openerIndex < 0) continue;
    const closerIndex = pair(tokens, source, openerIndex, index);
    if (closerIndex < 0) continue;
    if (closer.count === 0) tokens.splice(closerIndex, 1);
    index = closerIndex - 1;
  }
  return tokensToNodes(tokens);
}

export type ReadRange = (from: number, end: number) => Node[];

function closingBracket(source: string, at: number, end: number): number {
  let depth = 0;
  for (let index = at; index < end; index++) {
    const char = source[index];
    if (char === "\\") index++;
    else if (char === "[") depth++;
    else if (char === "]" && --depth === 0) return index;
  }
  return -1;
}

/** Reads `(destination)` at `at`; whitespace means title syntax or spaces, which do not round trip. */
function destination(source: string, at: number, end: number): { href: string; end: number } | null {
  if (source[at] !== "(") return null;
  let depth = 0;
  for (let index = at + 1; index < end; index++) {
    const char = source[index] ?? "";
    if (/\s/.test(char)) return null;
    if (char === "\\") index++;
    else if (char === "(") depth++;
    else if (char === ")" && depth-- === 0) return { href: source.slice(at + 1, index), end: index + 1 };
  }
  return null;
}

function readBracketed(source: string, at: number, end: number, readRange: ReadRange): { nodes: Node[]; end: number } | null {
  const image = source[at] === "!";
  const open = image ? at + 1 : at;
  if (!image) {
    const citation = matchCitation(source.slice(at, end));
    if (citation) {
      const raw = source.slice(at, at + citation.length);
      return { nodes: [qmdSchema.node("citation", { keys: citation.keys, raw })], end: at + citation.length };
    }
  }
  const close = closingBracket(source, open, end);
  const target = close < 0 ? null : destination(source, close + 1, end);
  if (!target) return null;
  const nodes = image
    ? [qmdSchema.node("image", { alt: source.slice(open + 1, close), src: target.href })]
    : withMark(readRange(open + 1, close), qmdSchema.mark("link", { href: target.href }));
  if (nodes.length === 0 || !writesBackAs(nodes, source.slice(at, target.end))) return null;
  return { nodes, end: target.end };
}

const PLAIN = /[^\\\n`$![*_]+/y;

function pushBreak(tokens: InlineToken[], at: number): void {
  const last = tokens[tokens.length - 1];
  let marker = "";
  if (last?.kind === "text") {
    const split = splitBreakMarker(last.text);
    marker = split.marker;
    last.text = split.text;
  }
  tokens.push({ kind: "nodes", nodes: [hardBreak(marker)], start: at, end: at + 1 });
}

/** Scans the construct at `at` into `tokens` and returns where scanning continues. */
function scanAt(source: string, at: number, from: number, end: number, tokens: InlineToken[]): number {
  const char = source[at] ?? "";
  if (char === "\n") {
    pushBreak(tokens, at);
    return at + 1;
  }
  if (char === "\\") {
    // A backslash before a line ending is the hard break marker, read when the line ending is.
    const length = at + 1 < end && source[at + 1] !== "\n" ? 2 : 1;
    pushText(tokens, source.slice(at, at + length), at);
    return at + length;
  }
  if (char === "*" || char === "_") {
    const run = delimiterRun(source, at, from, end);
    tokens.push(run);
    return run.end;
  }
  if (char === "`") {
    const span = matchCodeSpan(source, at, end);
    if (!("code" in span)) {
      pushText(tokens, "`".repeat(span.ticks), at);
      return at + span.ticks;
    }
    tokens.push({ kind: "nodes", nodes: [qmdSchema.text(span.code, [qmdSchema.mark("code", { ticks: span.ticks })])], start: at, end: span.end });
    return span.end;
  }
  if (char === "$") {
    const math = source[at + 1] === "$" ? null : matchMath(source, at, end);
    if (!math) {
      let length = 1;
      while (at + length < end && source[at + length] === "$") length++;
      pushText(tokens, source.slice(at, at + length), at);
      return at + length;
    }
    tokens.push({ kind: "nodes", nodes: [qmdSchema.node("math_inline", { tex: math.tex })], start: at, end: math.end });
    return math.end;
  }
  const bracketed = char === "[" || (char === "!" && source[at + 1] === "[") ? readBracketed(source, at, end, (start, stop) => readInlineRange(source, start, stop)) : null;
  if (bracketed) {
    tokens.push({ kind: "nodes", nodes: bracketed.nodes, start: at, end: bracketed.end });
    return bracketed.end;
  }
  pushText(tokens, char, at);
  return at + 1;
}

function readInlineRange(source: string, from: number, end: number): Node[] {
  const tokens: InlineToken[] = [];
  let at = from;
  while (at < end) {
    PLAIN.lastIndex = at;
    const plain = PLAIN.exec(source);
    if (plain) {
      const text = plain[0].slice(0, end - at);
      pushText(tokens, text, at);
      at += text.length;
    } else {
      at = scanAt(source, at, from, end, tokens);
    }
  }
  return resolveEmphasis(tokens, source);
}

/** `text` is the paragraph's source lines joined with "\n", without a final newline. */
export function parseInline(text: string): Node[] {
  // Fragment.from joins adjacent text nodes that carry the same marks.
  const read = Fragment.from(readInlineRange(text, 0, text.length));
  // INVARIANT: serializeInline(parseInline(text)) === text; a reading that would rewrite bytes falls back to literal text.
  if (serializeInline(read) !== text) return plainInline(text);
  const nodes: Node[] = [];
  read.forEach((node) => nodes.push(node));
  return nodes;
}
