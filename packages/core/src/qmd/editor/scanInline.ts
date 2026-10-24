// Reads one range of inline Markdown into nodes: scans constructs, then pairs emphasis.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Node } from "prosemirror-model";
import { qmdSchema } from "./schema/index.js";
import { readBracketed } from "./bracketed.js";
import { matchCodeSpan, matchMath } from "./spans.js";
import { delimiterRun, resolveEmphasis } from "./emphasis.js";
import { type InlineToken, pushText } from "./inlineToken.js";
import { hardBreak, splitBreakMarker } from "./lineBreak.js";

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

export function readInlineRange(source: string, from: number, end: number): Node[] {
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
