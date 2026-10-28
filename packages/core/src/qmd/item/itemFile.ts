// Reads and writes qmd item files: lines, code fences, fenced divs, attributes, anchors, and the items parsed from them.
// CONTRACT: documents/contracts/qmd-items.md#items
import { base64UrlToBytes, bytesToBase64Url } from "../../encoding/index.js";

// ---- Parsed shape

export const ITEM_CLASS = "labshelf-item";

/** Text outside any item, byte for byte. */
export interface LooseText {
  readonly kind: "loose";
  readonly text: string;
}

/**
 * One item. `fence`, `body` and `close` are the exact source bytes, line endings included, and are what gets written;
 * the other fields are read from `fence`.
 */
export interface ItemSegment {
  readonly kind: "item";
  readonly id: string;
  readonly anchor: ParsedAnchor;
  readonly author?: string;
  readonly created?: string;
  /** Every class of the opening line, `labshelf-item` included, in source order. */
  readonly classes: readonly string[];
  /** Every key-value attribute of the opening line in source order, known and unknown. */
  readonly attrs: readonly (readonly [string, string])[];
  readonly fence: string;
  readonly body: string;
  readonly close: string;
}

export type Segment = LooseText | ItemSegment;

/** INVARIANT: no two loose segments are adjacent and no loose segment is empty. */
export interface ItemFile {
  readonly segments: readonly Segment[];
}

// ---- Lines

const LINE_END = /\r\n|\n|\r/;

export function splitLines(text: string): string[] {
  return text.match(/[^\r\n]*(?:\r\n|\n|\r)|[^\r\n]+$/g) ?? [];
}

export function extractLineContent(line: string): string {
  return line.replace(/(?:\r\n|\n|\r)$/, "");
}

/** The line ending of the first line, or `\n` when the text has none. */
export function extractLineEnding(text: string): string {
  return LINE_END.exec(text)?.[0] ?? "\n";
}

export function isBlankLine(line: string): boolean {
  return /^[ \t]*$/.test(extractLineContent(line));
}

// ---- Code fences

// After the fence: nothing, an attribute block, or one word optionally followed by an attribute block.
const CODE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*(?:\{[^}\r\n]*\}|[^\s{`]+(?:[ \t]*\{[^}\r\n]*\})?)?[ \t]*$/;

/**
 * Maps the opening line of each code fence to its closing line. A fence without a closing fence is ordinary text,
 * as in Pandoc, and so are the lines that would have been inside it.
 */
export function findCodeFences(lines: readonly string[]): Map<number, number> {
  const fences = new Map<number, number>();
  for (let i = 0; i < lines.length; i++) {
    const close = codeFenceClose(lines, i);
    if (close !== undefined) {
      fences.set(i, close);
      i = close;
    }
  }
  return fences;
}

/** Lines that open a code fence but have no closing fence in `lines`. */
export function findUnclosedCodeFences(lines: readonly string[]): number[] {
  const fences = findCodeFences(lines);
  const unclosed: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const close = fences.get(i);
    if (close !== undefined) { i = close; } else if (CODE_OPEN.test(extractLineContent(lines[i]!))) { unclosed.push(i); }
  }
  return unclosed;
}

function codeFenceClose(lines: readonly string[], open: number): number | undefined {
  const opener = CODE_OPEN.exec(extractLineContent(lines[open]!));
  if (!opener) { return undefined; }
  const marker = opener[1]!;
  const closer = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`);
  for (let i = open + 1; i < lines.length; i++) {
    if (closer.test(extractLineContent(lines[i]!))) { return i; }
  }
  return undefined;
}

// ---- Div attributes

export interface ItemAttributes {
  readonly id?: string;
  readonly classes: readonly string[];
  /** Key-value attributes in source order, duplicates included. */
  readonly pairs: readonly (readonly [string, string])[];
}

const OPENER = /^:{3,}[ \t]*\{(.*)\}[ \t]*:*[ \t]*$/;
const TOKEN = /\s*(?:#([^\s{}"'=]+)|\.([^\s{}"'=]+)|([A-Za-z_][\w.:-]*)=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^\s{}"']+)))/y;

/** @returns undefined when the line is not a div opening line with one well-formed attribute block */
export function parseDivOpener(line: string): ItemAttributes | undefined {
  const opener = OPENER.exec(line);
  if (!opener) { return undefined; }
  const inner = opener[1]!;
  let id: string | undefined;
  const classes: string[] = [];
  const pairs: [string, string][] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < inner.length) {
    if (/^\s*$/.test(inner.slice(TOKEN.lastIndex))) { break; }
    const token = TOKEN.exec(inner);
    if (!token) { return undefined; }
    const [, tokenId, tokenClass, key, doubleQuoted, singleQuoted, bare] = token;
    const quoted = doubleQuoted ?? singleQuoted;
    if (tokenId !== undefined) {
      if (id !== undefined) { return undefined; }
      id = tokenId;
    } else if (tokenClass !== undefined) {
      classes.push(tokenClass);
    } else {
      pairs.push([key!, quoted !== undefined ? quoted.replace(/\\([\\"'])/g, "$1") : bare!]);
    }
  }
  return id === undefined ? { classes, pairs } : { id, classes, pairs };
}

/** Writes `::: {…}` without a line ending. Throws on a name or value that cannot be written on one line. */
export function formatDivOpener(attributes: ItemAttributes): string {
  const tokens: string[] = [];
  if (attributes.id !== undefined) { tokens.push(`#${checkName(attributes.id)}`); }
  for (const name of attributes.classes) { tokens.push(`.${checkName(name)}`); }
  for (const [key, value] of attributes.pairs) {
    if (!/^[A-Za-z_][\w.:-]*$/.test(key)) { throw new Error(`Div attribute: invalid key "${key}"`); }
    if (/[\r\n]/.test(value)) { throw new Error(`Div attribute: value of "${key}" spans lines`); }
    tokens.push(`${key}="${value.replace(/[\\"]/g, "\\$&")}"`);
  }
  return `::: {${tokens.join(" ")}}`;
}

/** The value of the first attribute named `key`. */
export function readAttribute(attributes: ItemAttributes, key: string): string | undefined {
  return attributes.pairs.find(([name]) => name === key)?.[1];
}

function checkName(name: string): string {
  if (!/^[^\s{}"'=]+$/.test(name)) { throw new Error(`Div attribute: invalid id or class "${name}"`); }
  return name;
}

// ---- Fenced divs

/** A top-level div: indices of its opening and closing lines. */
export interface ItemRange { readonly open: number; readonly close: number }

type LineKind = "open" | "close" | "text";

const DIV_OPEN = /^:{3,}[ \t]*(?:\{.*\}|[^\s{:]\S*)[ \t]*:*[ \t]*$/;
const DIV_CLOSE = /^:{3,}[ \t]*$/;
const HEADING = /^#{1,6}(?:[ \t]|$)/;

/**
 * The top-level divs of `lines`. An opening line without a matching closing line is ordinary text and the scan
 * goes on after it, so one broken fence never hides the divs that follow.
 */
export function findTopLevelDivs(lines: readonly string[]): ItemRange[] {
  const kinds = lineKinds(lines);
  const divs: ItemRange[] = [];
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] !== "open") { continue; }
    const close = divClose(kinds, i);
    if (close !== undefined) {
      divs.push({ open: i, close });
      i = close;
    }
  }
  return divs;
}

/** Whether every div opened in `lines` closes inside it and no closing line is left over. */
export function isBalanced(lines: readonly string[]): boolean {
  let depth = 0;
  for (const kind of lineKinds(lines)) {
    if (kind === "close" && --depth < 0) { return false; }
    if (kind === "open") { depth += 1; }
  }
  return depth === 0;
}

function divClose(kinds: readonly LineKind[], open: number): number | undefined {
  let depth = 1;
  for (let i = open + 1; i < kinds.length; i++) {
    if (kinds[i] === "close" && --depth === 0) { return i; }
    if (kinds[i] === "open") { depth += 1; }
  }
  return undefined;
}

/**
 * Classifies each line; lines inside code fences are text. TRAP: in Pandoc a closing line ends a paragraph but an
 * opening line does not, so an opening line right after paragraph text is text.
 */
function lineKinds(lines: readonly string[]): LineKind[] {
  const fences = findCodeFences(lines);
  const fenceCloses = new Set(fences.values());
  const kinds: LineKind[] = [];
  for (let i = 0; i < lines.length; i++) {
    const fenceClose = fences.get(i);
    if (fenceClose !== undefined) {
      for (; i <= fenceClose; i++) { kinds.push("text"); }
      i -= 1;
      continue;
    }
    const content = extractLineContent(lines[i]!);
    if (DIV_CLOSE.test(content)) {
      kinds.push("close");
    } else if (DIV_OPEN.test(content) && startsBlock(lines, i, fenceCloses)) {
      kinds.push("open");
    } else {
      kinds.push("text");
    }
  }
  return kinds;
}

function startsBlock(lines: readonly string[], index: number, fenceCloses: ReadonlySet<number>): boolean {
  if (index === 0 || fenceCloses.has(index - 1)) { return true; }
  const previous = extractLineContent(lines[index - 1]!);
  return isBlankLine(previous) || DIV_CLOSE.test(previous) || DIV_OPEN.test(previous) || HEADING.test(previous);
}

// ---- Anchors

export type ItemAnchor =
  | { readonly kind: "none" }
  | { readonly kind: "highlight"; readonly annotationId: string }
  | { readonly kind: "box"; readonly page: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: "quote"; readonly quote: string; readonly prefix: string; readonly suffix: string };

/** An anchor in no known form, or a known form that breaks its rules; kept verbatim. */
export interface UnknownAnchor { readonly kind: "unknown"; readonly raw: string }

export type ParsedAnchor = ItemAnchor | UnknownAnchor;

const HIGHLIGHT = /^hl:(\S+)$/;
const FRACTION = "(0(?:\\.\\d{1,4})?|1(?:\\.0{1,4})?|\\.\\d{1,4})";
const BOX = new RegExp(`^p([1-9]\\d*) box ${FRACTION} ${FRACTION} ${FRACTION} ${FRACTION}$`);
const QUOTE = /^quote:([A-Za-z0-9_-]+)$/;
const CONTEXT_LIMIT = 32;
// Fractions carry at most 4 decimals, so a sum that exceeds 1 by less than this is rounding.
const EPSILON = 1e-9;

export function parseAnchor(attr: string | undefined): ParsedAnchor {
  if (attr === undefined || attr === "") { return { kind: "none" }; }
  const highlight = HIGHLIGHT.exec(attr);
  if (highlight) { return { kind: "highlight", annotationId: highlight[1]! }; }
  const box = BOX.exec(attr);
  if (box) {
    const [page, x, y, w, h] = box.slice(1).map(Number) as [number, number, number, number, number];
    const anchor = { kind: "box", page, x, y, w, h } as const;
    return Number.isSafeInteger(page) && isValidBox(anchor) ? anchor : unknown(attr);
  }
  const quote = QUOTE.exec(attr);
  if (quote) { return parseQuote(quote[1]!) ?? unknown(attr); }
  return unknown(attr);
}

/** Throws when a box or quote breaks the contract's rules, so an invalid anchor is never written. */
export function formatAnchor(anchor: ParsedAnchor): string {
  switch (anchor.kind) {
    case "none": return "";
    case "unknown": return anchor.raw;
    case "highlight":
      if (!/^\S+$/.test(anchor.annotationId)) { throw new Error(`Anchor: invalid annotation id "${anchor.annotationId}"`); }
      return `hl:${anchor.annotationId}`;
    case "box": {
      const rounded = { ...anchor, x: round(anchor.x), y: round(anchor.y), w: round(anchor.w), h: round(anchor.h) };
      if (!Number.isSafeInteger(anchor.page) || anchor.page < 1 || !isValidBox(rounded)) {
        throw new Error(`Anchor: invalid box p${anchor.page} ${anchor.x} ${anchor.y} ${anchor.w} ${anchor.h}`);
      }
      return `p${anchor.page} box ${rounded.x} ${rounded.y} ${rounded.w} ${rounded.h}`;
    }
    case "quote":
      if (!isValidQuote(anchor)) { throw new Error(`Anchor: invalid quote (${anchor.quote.length} characters)`); }
      return `quote:${bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ quote: anchor.quote, prefix: anchor.prefix, suffix: anchor.suffix })))}`;
  }
}

function isValidBox(box: { x: number; y: number; w: number; h: number }): boolean {
  const inUnit = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
  return inUnit(box.x) && inUnit(box.y) && inUnit(box.w) && inUnit(box.h)
    && box.w > 0 && box.h > 0 && box.x + box.w <= 1 + EPSILON && box.y + box.h <= 1 + EPSILON;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function parseQuote(encoded: string): ItemAnchor | undefined {
  try {
    const json: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(encoded)));
    if (typeof json !== "object" || json === null) { return undefined; }
    const { quote, prefix, suffix } = json as Record<string, unknown>;
    if (typeof quote !== "string" || typeof prefix !== "string" || typeof suffix !== "string") { return undefined; }
    const anchor = { kind: "quote", quote, prefix, suffix } as const;
    return isValidQuote(anchor) ? anchor : undefined;
  } catch {
    // An undecodable value is an unknown anchor, kept verbatim by the caller.
    return undefined;
  }
}

function isValidQuote(anchor: { quote: string; prefix: string; suffix: string }): boolean {
  return anchor.quote !== "" && anchor.prefix.length <= CONTEXT_LIMIT && anchor.suffix.length <= CONTEXT_LIMIT;
}

function unknown(raw: string): UnknownAnchor {
  return { kind: "unknown", raw };
}

// ---- Parse and write

const BOM = "\uFEFF";

export function parseItemFile(text: string): ItemFile {
  // A byte order mark is kept as loose text, so it neither hides the first item nor disappears on write.
  const bom = text.startsWith(BOM) ? BOM : "";
  const lines = splitLines(text.slice(bom.length));
  const segments: Segment[] = [];
  let loose = bom;
  let next = 0;
  for (const div of findTopLevelDivs(lines)) {
    const item = readItem(lines, div.open, div.close);
    if (!item) { continue; }
    loose += lines.slice(next, div.open).join("");
    if (loose !== "") { segments.push({ kind: "loose", text: loose }); }
    loose = "";
    segments.push(item);
    next = div.close + 1;
  }
  loose += lines.slice(next).join("");
  if (loose !== "") { segments.push({ kind: "loose", text: loose }); }
  return { segments };
}

/** Reads the item whose fence spans `open`..`close`, or undefined when the div is not an item. */
function readItem(lines: readonly string[], open: number, close: number): ItemSegment | undefined {
  const fence = lines[open]!;
  const attributes = parseDivOpener(extractLineContent(fence));
  if (!attributes?.id || !attributes.classes.includes(ITEM_CLASS)) { return undefined; }
  const author = readAttribute(attributes, "author");
  const created = readAttribute(attributes, "created");
  return {
    kind: "item",
    id: attributes.id,
    anchor: parseAnchor(readAttribute(attributes, "anchor")),
    ...(author === undefined ? {} : { author }),
    ...(created === undefined ? {} : { created }),
    classes: attributes.classes,
    attrs: attributes.pairs,
    fence,
    body: lines.slice(open + 1, close).join(""),
    close: lines[close]!,
  };
}

export function serializeItemFile(file: ItemFile): string {
  return file.segments.map((segment) => (segment.kind === "loose" ? segment.text : segment.fence + segment.body + segment.close)).join("");
}
