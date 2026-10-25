// Walks Typst text through its markup, code and math modes, reporting identifiers, labels and strings.
import {
  openEmbed,
  openFrame,
  popFrame,
  type TypstFrame,
  type TypstWalk,
  type TypstWalkEnd,
  type TypstWalkEvents,
  stringCall,
} from "./typstFrames.js";
import { skipCommentOrRaw, skipString } from "./typstSkip.js";

const IDENT = /[\p{L}_][\p{L}\p{N}_-]*/uy;
const IDENT_START = /[\p{L}_]/u;
const NUMBER = /[0-9][\p{L}\p{N}_.%]*/uy;
const NAMED = /\s*:/y;
const STATEMENTS = new Set(["let", "set", "show", "import", "include", "return", "break", "continue"]);
const BLOCKS = new Set(["if", "for", "while"]);
const CLOSERS: Readonly<Record<string, TypstFrame["closer"]>> = { ")": ")", "}": "}", "]": "]" };

/** The end of the identifier starting at `from`, or -1 when none starts there. */
function readIdent(text: string, from: number): number {
  IDENT.lastIndex = from;
  return IDENT.test(text) ? IDENT.lastIndex : -1;
}

function popEmbed(w: TypstWalk): true {
  w.stack.pop();
  return true;
}

/** Moves a `#` expression on by the token at the offset; true when that already finished the step. */
function embedStep(w: TypstWalk, top: TypstFrame): boolean {
  const { text, i } = w;
  const ch = text[i]!;
  if (top.embed === "start") {
    const end = readIdent(text, i);
    if (end < 0) {
      if ("{([\"".includes(ch)) { top.embed = "after"; return false; }
      return popEmbed(w);
    }
    const name = text.slice(i, end);
    if (name === "context") {
      // `context` stays at "start" so the expression after it belongs to the same `#`.
      w.i = end;
      while (text[w.i] === " " || text[w.i] === "\t") { w.i++; }
      return true;
    }
    top.embed = STATEMENTS.has(name) ? "statement" : BLOCKS.has(name) ? "block" : "after";
    return false;
  }
  if (top.embed === "ident") {
    if (!IDENT_START.test(ch)) { return popEmbed(w); }
    top.embed = "after";
    return false;
  }
  if (top.embed === "after") {
    if (ch === "." && (i + 1 === text.length || IDENT_START.test(text[i + 1]!))) {
      w.i++;
      top.embed = "ident";
      return true;
    }
    return ch === "(" || ch === "[" ? false : popEmbed(w);
  }
  return false;
}

/** Opens or closes the bracket at the offset; false when there is none. */
function bracketStep(w: TypstWalk, top: TypstFrame, ch: string): boolean {
  if (ch === "{") { w.stack.push(openFrame("code", "}")); }
  else if (ch === "(") {
    const callee = w.lastPath?.end === w.i ? w.lastPath.text : undefined;
    w.stack.push(openFrame("code", ")", callee));
  }
  else if (ch === "[") { w.stack.push(openFrame("markup", "]")); }
  else if (ch === "$") { w.stack.push(openFrame("math", "$")); }
  else if (CLOSERS[ch] !== undefined) {
    if (top.closer === ch) { w.i++; popFrame(w, ch); return true; }
    if (top.embed !== undefined) { w.stack.pop(); return true; }
  }
  else { return false; }
  w.i++;
  return true;
}

/** Reads the identifier at the offset into the dotted path, the events and the call's named arguments. */
function identStep(w: TypstWalk, top: TypstFrame, end: number): void {
  const { text, i: from } = w;
  const name = text.slice(from, end);
  const joins = text[from - 1] === "." && w.lastPath?.end === from - 1;
  w.lastPath = { text: joins ? `${w.lastPath!.text}.${name}` : name, end };
  w.events.ident?.(name, from, end, w.stack.every((frame) => frame.closer === ""));
  if (name === "import" || name === "include") { top.keyword = name; }
  NAMED.lastIndex = end;
  if (top.callee !== undefined && NAMED.test(text)) {
    top.given.push(name);
    top.named = true;
  }
  w.i = end;
}

/** Steps the walk over one token of code at the top of the stack. */
function codeStep(w: TypstWalk, top: TypstFrame): void {
  if (top.embed !== undefined && embedStep(w, top)) { return; }
  const { text } = w;
  const ch = text[w.i]!;
  if (ch === " " || ch === "\t" || ch === "\r") { w.i++; return; }
  if (top.embed !== undefined && (ch === "\n" || ch === ";")) { w.i++; w.stack.pop(); return; }
  const kw = top.keyword;
  delete top.keyword;
  if (skipCommentOrRaw(w, false)) { return; }
  if (ch === "\"") { skipString(w, kw ?? stringCall(w.stack)); return; }
  if (bracketStep(w, top, ch)) { return; }
  if (ch === "," && top.closer === ")") { top.args++; top.named = false; w.i++; return; }
  const end = readIdent(text, w.i);
  if (end >= 0) { identStep(w, top, end); return; }
  NUMBER.lastIndex = w.i;
  w.i = NUMBER.test(text) ? NUMBER.lastIndex : w.i + 1;
}

const LABEL = /<([\p{L}\p{N}_\-:.]+)>/uy;

function pushEmbed(w: TypstWalk): void {
  w.i++;
  w.stack.push(openEmbed());
}

function markupStep(w: TypstWalk, top: TypstFrame): void {
  if (skipCommentOrRaw(w, true)) { return; }
  const ch = w.text[w.i];
  if (ch === "\\") { w.i += 2; return; }
  if (ch === "#") { pushEmbed(w); return; }
  if (ch === "$" || ch === "[") {
    w.stack.push(openFrame(ch === "$" ? "math" : "markup", ch === "$" ? "$" : "]"));
    w.i++;
    return;
  }
  if (ch === "]" && top.closer === "]") { w.i++; popFrame(w, ch); return; }
  LABEL.lastIndex = w.i;
  const label = LABEL.exec(w.text);
  if (label) {
    w.events.label?.(label[1]!, w.i + 1, LABEL.lastIndex - 1);
    w.i = LABEL.lastIndex;
    return;
  }
  w.i++;
}

function mathStep(w: TypstWalk, top: TypstFrame): void {
  if (skipCommentOrRaw(w, false)) { return; }
  const ch = w.text[w.i];
  if (ch === "\\") { w.i += 2; return; }
  if (ch === "$" && top.closer === "$") { w.i++; popFrame(w, ch); return; }
  if (ch === "#") { pushEmbed(w); return; }
  if (ch === "\"") { skipString(w, undefined); return; }
  w.i++;
}

/** Walks the whole text and returns where it ends: the open frames and any unclosed comment, raw span or string. */
export function walkTypst(text: string, events: TypstWalkEvents = {}): TypstWalkEnd {
  const w: TypstWalk = { text, events, i: 0, stack: [openFrame("markup", "")], inComment: false, inRaw: false };
  while (w.i < text.length) {
    const top = w.stack[w.stack.length - 1]!;
    if (top.mode === "code") { codeStep(w, top); }
    else if (top.mode === "math") { mathStep(w, top); }
    else { markupStep(w, top); }
  }
  return w;
}
