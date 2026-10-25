/** Collects, in source order, the definitions a section typeset alone needs from the document body before it. */
import {
  type LatexPosition,
  type LatexSourceFacts,
  removeComments,
  readDelimited,
  findSpaceEnd,
} from "../../source/index.js";

interface SourceSpan {
  start: number;
  end: number;
}

// Argument shapes: `*` an optional star, `{` a group or a single token, `[` an optional bracket group.
const SHAPES: ReadonlyMap<string, string> = new Map([
  ["theoremstyle", "{"], ["newtheorem", "*{[{["], ["newenvironment", "*{[[{{"], ["newcounter", "{["], ["newlength", "{"],
]);
const DEFS: ReadonlySet<string> = new Set(["def", "gdef", "edef", "xdef"]);
const COMMAND = /\\([A-Za-z]+)/g;
const TOKEN = /\\(?:[A-Za-z@]+|.)/y;

function readToken(text: string, at: number): number | undefined {
  if (at >= text.length) { return undefined; }
  if (text[at] !== "\\") { return at + 1; }
  TOKEN.lastIndex = at;
  return TOKEN.exec(text) ? TOKEN.lastIndex : undefined;
}

function readShape(text: string, after: number, shape: string): number | undefined {
  let at: number | undefined = after;
  for (const part of shape) {
    if (part === "*") { if (text[at] === "*") { at++; } continue; }
    const from = findSpaceEnd(text, at);
    if (part === "[") { at = readDelimited(text, from, "[")?.next ?? at; continue; }
    at = text[from] === "{" ? readDelimited(text, from, "{")?.next : readToken(text, from);
    if (at === undefined) { return undefined; }
  }
  return at;
}

/** `\def\name<parameter text>{body}`: the parameter text runs to the first unescaped brace. */
function readDef(text: string, after: number): number | undefined {
  const name = findSpaceEnd(text, after);
  let at = text[name] === "\\" ? readToken(text, name) : undefined;
  if (at === undefined) { return undefined; }
  while (at < text.length && text[at] !== "{") { at += text[at] === "\\" ? 2 : 1; }
  return readDelimited(text, at, "{")?.next;
}

/** `\let\name=\other`, with the equals sign and the space around it optional. */
function readLet(text: string, after: number): number | undefined {
  const name = findSpaceEnd(text, after);
  const named = text[name] === "\\" ? readToken(text, name) : undefined;
  if (named === undefined) { return undefined; }
  let at = findSpaceEnd(text, named);
  if (text[at] === "=") { at = findSpaceEnd(text, at + 1); }
  return readToken(text, at);
}

/** Expects comment-free text; spans may nest, e.g. a `\def` inside a `\newenvironment` body. */
function findDefinitionSpans(text: string): SourceSpan[] {
  const spans: SourceSpan[] = [];
  for (const match of text.matchAll(COMMAND)) {
    const command = match[1]!;
    const after = match.index + match[0].length;
    const shape = SHAPES.get(command);
    const end = DEFS.has(command) ? readDef(text, after)
      : command === "let" ? readLet(text, after)
      : shape ? readShape(text, after, shape) : undefined;
    if (end !== undefined) { spans.push({ start: match.index, end }); }
  }
  return spans;
}

const BEGIN_DOCUMENT = /\\begin\s*\{document\}/;

function offsetsOf(text: string): (position: LatexPosition) => number {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") { lineStarts.push(i + 1); }
  }
  return (position) => lineStarts[position.line]! + position.character;
}

/**
 * `scan` is `scanLatexSource(text)`. Definitions before `\begin{document}` are skipped: the format holds the preamble,
 * and a second `\newcommand` of the same name stops TeX. A definition nested in another is kept once, inside its parent.
 */
export function extractDefinitions(text: string, scan: LatexSourceFacts): string[] {
  // INVARIANT: removeComments keeps offsets, so spans found in the stripped text slice the original.
  const stripped = removeComments(text);
  const body = BEGIN_DOCUMENT.exec(stripped);
  const from = body ? body.index + body[0].length : 0;
  const offset = offsetsOf(text);
  const spans: SourceSpan[] = [
    ...scan.macros.map((macro) => ({ start: offset(macro.range.start), end: offset(macro.range.end) })),
    ...findDefinitionSpans(stripped),
  ].filter((span) => span.start >= from).sort((a, b) => a.start - b.start);
  const definitions: string[] = [];
  let covered = -1;
  for (const span of spans) {
    if (span.start < covered) { continue; }
    definitions.push(text.slice(span.start, span.end));
    covered = span.end;
  }
  return definitions;
}
