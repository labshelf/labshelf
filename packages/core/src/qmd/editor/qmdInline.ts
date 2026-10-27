// Reads the inline Markdown of one paragraph or heading into ProseMirror nodes and writes it back.
// CONTRACT: documents/contracts/qmd-items.md#format
import { Fragment, type Node, type Mark } from "prosemirror-model";
import { qmdSchema, matchCitation } from "./qmdSchema.js";

/** `start`/`end` are source offsets of the bytes the token still stands for. */
type InlineToken =
  | { kind: "text"; text: string; start: number; end: number }
  | { kind: "nodes"; nodes: Node[]; start: number; end: number }
  | { kind: "delim"; char: string; count: number; length: number; canOpen: boolean; canClose: boolean; start: number; end: number };

function addText(tokens: InlineToken[], text: string, start: number): void {
  const last = tokens[tokens.length - 1];
  if (last?.kind === "text") {
    last.text += text;
    last.end = start + text.length;
  } else {
    tokens.push({ kind: "text", text, start, end: start + text.length });
  }
}

function deriveTokenNodes(tokens: readonly InlineToken[]): Node[] {
  return tokens.flatMap((token) => {
    if (token.kind === "nodes") return token.nodes;
    const text = token.kind === "text" ? token.text : token.char.repeat(token.count);
    return text ? [qmdSchema.text(text)] : [];
  });
}

/** Splits `line` into the text kept and the break marker: an odd trailing `\`, two or more trailing spaces, or "". */
function splitBreakMarker(line: string): { text: string; marker: string } {
  const backslashes = /\\*$/.exec(line)?.[0].length ?? 0;
  if (backslashes % 2 === 1) return { text: line.slice(0, -1), marker: "\\" };
  const spaces = / *$/.exec(line)?.[0].length ?? 0;
  if (spaces >= 2) return { text: line.slice(0, -spaces), marker: line.slice(-spaces) };
  return { text: line, marker: "" };
}

function hardBreak(marker: string): Node {
  return qmdSchema.node("hard_break", { marker });
}

/** Reads `text` with line breaks only, every other byte literal. */
function plainInline(text: string): Node[] {
  const lines = text.split("\n");
  return lines.flatMap((line, index) => {
    if (index === lines.length - 1) return line ? [qmdSchema.text(line)] : [];
    const { text: kept, marker } = splitBreakMarker(line);
    return kept ? [qmdSchema.text(kept), hardBreak(marker)] : [hardBreak(marker)];
  });
}

function withMark(nodes: readonly Node[], mark: Mark): Node[] {
  return nodes.map((node) => node.mark(mark.addToSet(node.marks)));
}

/** True when the nodes write back as exactly `source`; constructs that would not stay literal text. */
function writesBackAs(nodes: readonly Node[], source: string): boolean {
  return serializeInline(Fragment.from(nodes)) === source;
}

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
  const nodes = withMark(deriveTokenNodes(tokens.slice(openerIndex + 1, closerIndex)), mark);
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
  return deriveTokenNodes(tokens);
}

type ReadRange = (from: number, end: number) => Node[];

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
    addText(tokens, source.slice(at, at + length), at);
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
      addText(tokens, "`".repeat(span.ticks), at);
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
      addText(tokens, source.slice(at, at + length), at);
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
  addText(tokens, char, at);
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
      addText(tokens, text, at);
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

function codeSpan(code: string, ticks: number): string {
  const runs = new Set((code.match(/`+/g) ?? []).map((run) => run.length));
  let length = ticks;
  while (runs.has(length)) length++;
  const fence = "`".repeat(length);
  return fence + code + fence;
}

function citation(keys: string[], raw: string | null): string {
  const read = raw === null ? null : matchCitation(raw);
  const rawStillReads = read !== null && read.length === raw?.length && read.keys.join("\n") === keys.join("\n");
  return rawStillReads ? raw : `[${keys.map((key) => `@${key}`).join("; ")}]`;
}

function nodeSource(node: Node): string {
  const code = node.marks.find((mark) => mark.type.name === "code");
  if (node.isText) return code ? codeSpan(node.text ?? "", code.attrs.ticks as number) : node.text ?? "";
  const attrs = node.attrs;
  switch (node.type.name) {
    case "hard_break": return `${attrs.marker as string}\n`;
    case "math_inline": return `$${attrs.tex as string}$`;
    case "image": return `![${attrs.alt as string}](${attrs.src as string})`;
    case "citation": return citation(attrs.keys as string[], attrs.raw as string | null);
    default: throw new RangeError(`serializeInline: no Markdown for inline node "${node.type.name}"`);
  }
}

function opening(mark: Mark): string {
  if (mark.type.name === "link") return "[";
  return (mark.attrs.marker as string).repeat(mark.type.name === "strong" ? 2 : 1);
}

function closing(mark: Mark): string {
  return mark.type.name === "link" ? `](${mark.attrs.href as string})` : opening(mark);
}

/** Index of the first node from `index` on that lacks `mark`. */
function reach(nodes: readonly Node[], index: number, mark: Mark): number {
  let end = index;
  while (end < nodes.length && mark.isInSet(nodes[end]?.marks ?? [])) end++;
  return end;
}

export function serializeInline(content: Fragment): string {
  const nodes: Node[] = [];
  content.forEach((node) => nodes.push(node));
  const active: Mark[] = [];
  let source = "";
  nodes.forEach((node, index) => {
    const wanted = node.marks.filter((mark) => mark.type.name !== "code");
    let keep = 0;
    while (keep < active.length && active[keep]?.isInSet(wanted)) keep++;
    while (active.length > keep) source += closing(active.pop() as Mark);
    const opened = wanted
      .filter((mark) => !mark.isInSet(active))
      .map((mark) => ({ mark, end: reach(nodes, index, mark) }))
      .sort((a, b) => b.end - a.end || Number(b.mark.type.name === "link") - Number(a.mark.type.name === "link"));
    for (const { mark } of opened) {
      source += opening(mark);
      active.push(mark);
    }
    source += nodeSource(node);
  });
  while (active.length > 0) source += closing(active.pop() as Mark);
  return source;
}
