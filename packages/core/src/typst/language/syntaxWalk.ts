// Walks Typst text through its markup, code and math modes, reporting identifiers, labels and strings, and models the open brackets and `#` expressions it tracks.

export type TypstMode = "markup" | "code" | "math";

/** How far a `#` expression has got: it ends on its own when the next token cannot continue it. */
type TypstEmbedState = "start" | "ident" | "after" | "statement" | "block";

interface TypstFrame {
  mode: TypstMode;
  /** The character that closes the frame; "" for the file root and for `#` expressions. */
  closer: "" | "]" | "}" | ")" | "$";
  embed?: TypstEmbedState;
  /** Set on the parentheses of a call: the dotted path written right before them. */
  callee?: string;
  given: string[];
  /** Commas written so far at this frame's level. */
  args: number;
  /** Whether the current argument started with `name:`. */
  named: boolean;
  /** `import` or `include` when it is the last token, so the string after it belongs to it. */
  keyword?: string;
}

interface TypstWalkEvents {
  /** An identifier in code; `topLevel` is false inside any bracket. */
  ident?(name: string, from: number, to: number, topLevel: boolean): void;
  /** A closed string literal in code: `from`/`to` bound its content; `call` as in `findStringCall`. */
  string?(content: string, from: number, to: number, call: string | undefined): void;
  /** A `<name>` label in markup: `from`/`to` bound the name. */
  label?(name: string, from: number, to: number): void;
}

interface TypstWalkEnd {
  readonly stack: TypstFrame[];
  inComment: boolean;
  inRaw: boolean;
  /** Set when the text ends inside a string literal. */
  string?: { from: number; call: string | undefined };
}

interface TypstWalk extends TypstWalkEnd {
  readonly text: string;
  readonly events: TypstWalkEvents;
  i: number;
  /** The dotted identifier path read last and the offset where it ends. */
  lastPath?: { text: string; end: number };
}

const ELSE = /[ \t]*else(?![\p{L}\p{N}_-])/uy;

function openFrame(mode: TypstMode, closer: TypstFrame["closer"], callee?: string): TypstFrame {
  const frame: TypstFrame = { mode, closer, given: [], args: 0, named: false };
  if (callee !== undefined) { frame.callee = callee; }
  return frame;
}

function openEmbed(): TypstFrame {
  return { ...openFrame("code", ""), embed: "start" };
}

/** Pops the top frame, whose closer the walk has just consumed, and lets a `#` expression around it go on or end. */
function removeTopFrame(w: TypstWalk, closer: string): void {
  w.stack.pop();
  const parent = w.stack[w.stack.length - 1];
  if (!parent?.embed || parent.embed === "statement") { return; }
  if (parent.embed !== "block") { parent.embed = "after"; return; }
  if (closer !== "]" && closer !== "}") { return; }
  ELSE.lastIndex = w.i;
  if (!ELSE.test(w.text)) { w.stack.pop(); }
}

const isFirstArgument = (frame: TypstFrame): boolean => frame.args === 0 && !frame.named;

/** The call a string at the top of the stack is the first argument of, looking through an array literal. */
function findStringCall(stack: readonly TypstFrame[]): string | undefined {
  const top = stack[stack.length - 1];
  if (top?.callee !== undefined) { return isFirstArgument(top) ? top.callee : undefined; }
  const parent = stack[stack.length - 2];
  if (top?.closer !== ")" || parent?.callee === undefined) { return undefined; }
  return isFirstArgument(parent) ? parent.callee : undefined;
}

/** The innermost call whose parentheses are open, without crossing out of code. */
export function findInnermostCall(stack: readonly TypstFrame[]): { callee: string; given: string[] } | undefined {
  for (let k = stack.length - 1; k >= 0; k--) {
    const frame = stack[k]!;
    if (frame.mode !== "code") { return undefined; }
    if (frame.callee !== undefined) { return { callee: frame.callee, given: [...frame.given] }; }
  }
  return undefined;
}

/** Where the comment at `start` ends (a line comment ends at its newline), or -1 when it runs to the end of the text. */
function commentEnd(text: string, start: number): number {
  if (text[start + 1] === "/") { return text.indexOf("\n", start); }
  let depth = 0;
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === "/" && text[i + 1] === "*") { depth++; i++; continue; }
    if (text[i] === "*" && text[i + 1] === "/") {
      depth--; i++;
      if (depth === 0) { return i + 1; }
    }
  }
  return -1;
}

/** Where the raw span opened by the backticks at `start` ends, or -1 when it runs to the end of the text. */
function rawEnd(text: string, start: number): number {
  let ticks = 0;
  while (text[start + ticks] === "`") { ticks++; }
  // TRAP: exactly two backticks are an empty raw span, not the opening of one.
  if (ticks === 2) { return start + 2; }
  const close = text.indexOf("`".repeat(ticks), start + ticks);
  return close < 0 ? -1 : close + ticks;
}

/** The offset of the quote closing the string opened at `start`, or -1 when the string runs to the end of the text. */
function stringEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === '"') { return i; }
  }
  return -1;
}

/** Skips the comment or raw span at the walk's offset; false when none starts there. */
function skipCommentOrRaw(w: TypstWalk, inMarkup: boolean): boolean {
  const { text, i } = w;
  const isComment = text[i] === "/" && (text[i + 1] === "*" || text[i + 1] === "/");
  // TRAP: in markup `//` right after `:` belongs to a URL such as https://x.org, not a line comment.
  if (isComment && !(inMarkup && text[i + 1] === "/" && text[i - 1] === ":")) {
    const end = commentEnd(text, i);
    if (end < 0) { w.inComment = true; w.i = text.length; } else { w.i = end; }
    return true;
  }
  if (text[i] !== "`") { return false; }
  const end = rawEnd(text, i);
  if (end < 0) { w.inRaw = true; w.i = text.length; } else { w.i = end; }
  return true;
}

/** Skips the string literal opened at the walk's offset and reports it with the call it belongs to. */
function skipString(w: TypstWalk, call: string | undefined): void {
  const close = stringEnd(w.text, w.i);
  const from = w.i + 1;
  if (close < 0) {
    w.string = { from, call };
    w.i = w.text.length;
    return;
  }
  w.events.string?.(w.text.slice(from, close), from, close, call);
  w.i = close + 1;
}

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
    if (top.closer === ch) { w.i++; removeTopFrame(w, ch); return true; }
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
  if (ch === "\"") { skipString(w, kw ?? findStringCall(w.stack)); return; }
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
  if (ch === "]" && top.closer === "]") { w.i++; removeTopFrame(w, ch); return; }
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
  if (ch === "$" && top.closer === "$") { w.i++; removeTopFrame(w, ch); return; }
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
