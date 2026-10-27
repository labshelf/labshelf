// Scans Typst text lexically: the context at a cursor, the symbols a file defines and its headings.
import { findLineOfOffset, deriveLineOffsets } from "../../text/index.js";
import { findInnermostCall, walkTypst, type TypstMode } from "./syntaxWalk.js";

export interface TypstCursorContext {
  mode: TypstMode;
  inComment: boolean;
  inRaw: boolean;
  /** The identifier fragment (letters, digits, `_`, `-`) that ends at the offset. */
  word: { from: number; text: string };
  /** The character just before `word` when it is one of these; "" otherwise. */
  trigger: "#" | "@" | "<" | "." | "";
  /** For trigger ".": the dotted path before the dot, e.g. "calc" or "math.attach". */
  receiver?: string;
  /** Inside a string literal: where its content starts and the content before the offset; `call` is the
   *  function or keyword the string is the first argument of ("image", "include", "import", "bibliography", …). */
  string?: { from: number; prefix: string; call?: string };
  /** The innermost unclosed call around the offset: the dotted callee and the named arguments already written. */
  call?: { callee: string; given: string[] };
}

export interface TypstBinding {
  name: string;
  from: number;
  to: number;
  line: number;
  topLevel: boolean;
  /** `let name(params) = …` as written, without the body; e.g. "let note(body, color: red)". */
  signature: string;
  params?: string[];
  /** The `///` lines right above, without the slashes, joined with "\n". */
  doc?: string;
}

export interface TypstLabelDefinition {
  name: string;
  from: number;
  to: number;
  line: number;
  /** The text on the label's line before it, trimmed. */
  context: string;
}

interface TypstPathReference {
  path: string;
  from: number;
  to: number;
}

interface TypstImport extends TypstPathReference {
  names: string[] | "*" | undefined;
  alias?: string;
}

export interface TypstFileSymbols {
  bindings: TypstBinding[];
  labels: TypstLabelDefinition[];
  imports: TypstImport[];
  includes: TypstPathReference[];
  bibliographies: TypstPathReference[];
}

const OPENERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/** The index of the bracket that closes the one at `open`, skipping strings; -1 when the text ends first. */
function closingBracket(text: string, open: number): number {
  const closers: string[] = [];
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') { i = stringEnd(text, i); continue; }
    if (OPENERS[ch] !== undefined) { closers.push(OPENERS[ch]); continue; }
    if (ch !== closers[closers.length - 1]) { continue; }
    closers.pop();
    if (closers.length === 0) { return i; }
  }
  return -1;
}

/** The comma-separated items of `list` at its own nesting level, trimmed, without empty ones. */
function topLevelItems(list: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i]!;
    if (ch === '"') { i = stringEnd(list, i); continue; }
    if (OPENERS[ch] !== undefined) { depth++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; continue; }
    if (ch === "," && depth === 0) { items.push(list.slice(start, i)); start = i + 1; }
  }
  items.push(list.slice(start));
  return items.map((item) => item.trim()).filter((item) => item !== "");
}

/** The index of the quote that closes the string opening at `quote`, or the last index when unclosed. */
function stringEnd(text: string, quote: number): number {
  for (let i = quote + 1; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === '"') { return i; }
  }
  return text.length - 1;
}

interface TypstLetHead {
  name: string;
  from: number;
  to: number;
  signature: string;
  params?: string[];
}

const NAME = /[ \t]+([\p{L}_][\p{L}\p{N}_-]*)/uy;

/** The head of the `let` keyword at `letFrom`..`letTo`; undefined for destructuring or a missing name. */
function readLetHead(text: string, letFrom: number, letTo: number): TypstLetHead | undefined {
  NAME.lastIndex = letTo;
  const match = NAME.exec(text);
  if (!match) { return undefined; }
  const name = match[1]!;
  const to = NAME.lastIndex;
  const head = { name, from: to - name.length, to };
  const close = text[to] === "(" ? closingBracket(text, to) : -1;
  if (close < 0) { return { ...head, signature: text.slice(letFrom, to) }; }
  const params = topLevelItems(text.slice(to + 1, close)).map((item) => item.split(":")[0]!.trim());
  return { ...head, signature: text.slice(letFrom, close + 1).replace(/\s+/g, " "), params };
}

const IDENT = "[\\p{L}_][\\p{L}\\p{N}_-]*";
const HEAD = new RegExp(`[ \\t]*(?:as[ \\t]+(${IDENT}))?[ \\t]*(:)?[ \\t]*`, "uy");
const RENAME = new RegExp(`\\s+as\\s+(${IDENT})$`, "u");

/** The names and alias of the import whose path string closes just before `afterQuote`. */
function readImportNames(text: string, afterQuote: number): Pick<TypstImport, "names" | "alias"> {
  HEAD.lastIndex = afterQuote;
  const head = HEAD.exec(text);
  const alias = head?.[1];
  const names = head?.[2] === undefined ? undefined : nameList(text, HEAD.lastIndex);
  return alias === undefined ? { names } : { names, alias };
}

function nameList(text: string, start: number): string[] | "*" {
  if (text[start] === "*") { return "*"; }
  let list: string;
  if (text[start] === "(") {
    const close = closingBracket(text, start);
    list = text.slice(start + 1, close < 0 ? text.length : close);
  } else {
    const end = text.slice(start).search(/[\n;\]}]/);
    list = text.slice(start, end < 0 ? text.length : start + end);
  }
  return topLevelItems(list).map(importedName);
}

/** The name an import item binds: its rename, else the last segment of its dotted path. */
function importedName(item: string): string {
  return RENAME.exec(item)?.[1] ?? item.split(".").pop()!.trim();
}

/** The symbols of `text`, each in the order it appears. */
export function scanTypstFile(text: string): TypstFileSymbols {
  const symbols: TypstFileSymbols = { bindings: [], labels: [], imports: [], includes: [], bibliographies: [] };
  const starts = deriveLineOffsets(text);
  walkTypst(text, {
    ident(name, from, to, topLevel) {
      if (name !== "let") { return; }
      const head = readLetHead(text, from, to);
      if (!head) { return; }
      const line = findLineOfOffset(starts, from);
      const binding: TypstBinding = { ...head, line, topLevel };
      const doc = docAbove(text, starts, line);
      if (doc !== undefined) { binding.doc = doc; }
      symbols.bindings.push(binding);
    },
    label(name, from, to) {
      const line = findLineOfOffset(starts, from);
      symbols.labels.push({ name, from, to, line, context: text.slice(starts[line], from - 1).trim() });
    },
    string(path, from, to, call) {
      if (call === "import") { symbols.imports.push({ path, from, to, ...readImportNames(text, to + 1) }); }
      if (call === "include") { symbols.includes.push({ path, from, to }); }
      if (call === "bibliography") { symbols.bibliographies.push({ path, from, to }); }
    },
  });
  return symbols;
}

/** The `///` lines right above `line`, without the slashes and one space, joined with "\n". */
function docAbove(text: string, starts: readonly number[], line: number): string | undefined {
  const lines: string[] = [];
  for (let k = line - 1; k >= 0; k--) {
    const content = text.slice(starts[k], starts[k + 1]! - 1).trim();
    if (!content.startsWith("///")) { break; }
    lines.unshift(content.replace(/^\/\/\/ ?/, ""));
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

const WORD_CHAR = /[\p{L}\p{N}_-]/u;
const TRIGGERS = new Set(["#", "@", "<", "."]);
const RECEIVER = /[\p{L}_][\p{L}\p{N}_-]*(?:\.[\p{L}_][\p{L}\p{N}_-]*)*$/u;
/** How far before the dot a receiver path is looked for. */
const RECEIVER_SPAN = 200;

export function deriveTypstCursor(text: string, offset: number): TypstCursorContext {
  const before = text.slice(0, offset);
  const end = walkTypst(before);
  let from = offset;
  while (from > 0 && WORD_CHAR.test(before[from - 1]!)) { from--; }
  const mark = before[from - 1] ?? "";
  const trigger = TRIGGERS.has(mark) ? (mark as TypstCursorContext["trigger"]) : "";
  const context: TypstCursorContext = {
    mode: end.stack[end.stack.length - 1]!.mode,
    inComment: end.inComment,
    inRaw: end.inRaw,
    word: { from, text: before.slice(from) },
    trigger,
  };
  const receiver = trigger === "." ? RECEIVER.exec(before.slice(Math.max(0, from - 1 - RECEIVER_SPAN), from - 1))?.[0] : undefined;
  if (receiver !== undefined) { context.receiver = receiver; }
  if (end.string) {
    context.string = { from: end.string.from, prefix: before.slice(end.string.from) };
    if (end.string.call !== undefined) { context.string.call = end.string.call; }
  }
  const call = findInnermostCall(end.stack);
  if (call) { context.call = call; }
  return context;
}

export interface TypstHeading {
  level: number;
  title: string;
  /** Zero-based line of the heading. */
  line: number;
}

const MARKER_HEADING = /^[ \t]*(=+)[ \t]+(\S.*)$/;
const CALL_HEADING = /^[ \t]*#heading(?:\([ \t]*level:[ \t]*(\d+)[ \t]*\))?\[([^\]]*)\]/;
const FENCE_OPEN = /^[ \t]*(`{3,})/;
const TRAILING_LABEL = /\s*<[\p{L}\p{N}_:.-]+>$/u;

interface ScanState { commentDepth: number; fenceLength: number }

/** Returns the line without comments, updating the block-comment depth that carries to the next line. */
function stripComments(line: string, state: ScanState): string {
  let code = "";
  for (let i = 0; i < line.length; i++) {
    const pair = line.slice(i, i + 2);
    if (pair === "/*") { state.commentDepth++; i++; code += " "; continue; }
    if (state.commentDepth > 0) {
      if (pair === "*/") { state.commentDepth--; i++; }
      continue;
    }
    // TRAP: `//` right after `:` belongs to a URL such as https://x.org, not a line comment.
    if (pair === "//" && line[i - 1] !== ":") { break; }
    code += line[i];
  }
  return code;
}

function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().replace(TRAILING_LABEL, "");
}

function headingOf(code: string, line: number): TypstHeading | undefined {
  const marker = MARKER_HEADING.exec(code);
  const call = marker ? undefined : CALL_HEADING.exec(code);
  const level = marker ? marker[1]!.length : Number(call?.[1] ?? 1);
  const title = cleanTitle(marker?.[2] ?? call?.[2] ?? "");
  return title && level > 0 ? { level, title, line } : undefined;
}

/** Headings in text order. */
export function scanTypstHeadings(text: string): TypstHeading[] {
  const state: ScanState = { commentDepth: 0, fenceLength: 0 };
  const headings: TypstHeading[] = [];
  text.split("\n").forEach((line, index) => {
    if (state.fenceLength > 0) {
      const closing = FENCE_OPEN.exec(line)?.[1];
      if (closing && closing.length >= state.fenceLength) { state.fenceLength = 0; }
      return;
    }
    const fence = state.commentDepth === 0 ? FENCE_OPEN.exec(line)?.[1] : undefined;
    // A fence closed on its own line is inline raw text, not a block.
    if (fence && !line.slice(line.indexOf(fence) + fence.length).includes(fence)) { state.fenceLength = fence.length; return; }
    const heading = headingOf(stripComments(line, state), index);
    if (heading) { headings.push(heading); }
  });
  return headings;
}
