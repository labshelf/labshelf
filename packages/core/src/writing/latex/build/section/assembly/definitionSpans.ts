/** Finds the definitions the `\newcommand` scan does not read: the `\def` family, `\let`, theorems, environments, counters and lengths. */
import { readDelimited, skipSpace } from "../../../source/index.js";

export interface SourceSpan {
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
    const from = skipSpace(text, at);
    if (part === "[") { at = readDelimited(text, from, "[")?.next ?? at; continue; }
    at = text[from] === "{" ? readDelimited(text, from, "{")?.next : readToken(text, from);
    if (at === undefined) { return undefined; }
  }
  return at;
}

/** `\def\name<parameter text>{body}`: the parameter text runs to the first unescaped brace. */
function readDef(text: string, after: number): number | undefined {
  const name = skipSpace(text, after);
  let at = text[name] === "\\" ? readToken(text, name) : undefined;
  if (at === undefined) { return undefined; }
  while (at < text.length && text[at] !== "{") { at += text[at] === "\\" ? 2 : 1; }
  return readDelimited(text, at, "{")?.next;
}

/** `\let\name=\other`, with the equals sign and the space around it optional. */
function readLet(text: string, after: number): number | undefined {
  const name = skipSpace(text, after);
  const named = text[name] === "\\" ? readToken(text, name) : undefined;
  if (named === undefined) { return undefined; }
  let at = skipSpace(text, named);
  if (text[at] === "=") { at = skipSpace(text, at + 1); }
  return readToken(text, at);
}

/** Expects comment-free text; spans may nest, e.g. a `\def` inside a `\newenvironment` body. */
export function findDefinitionSpans(text: string): SourceSpan[] {
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
