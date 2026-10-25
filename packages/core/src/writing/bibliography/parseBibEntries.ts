/** Parses the entries of a .bib file with their fields and character offsets. */

export interface BibEntry {
  /** Entry type in lower case: `article`, `inproceedings`, `misc`… */
  type: string;
  key: string;
  /** Field values by lower-case name, without the outer braces or quotes; inner braces stay. */
  fields: ReadonlyMap<string, string>;
  /** Character offsets of the entry, from its `@` to its closing delimiter inclusive. */
  start: number;
  end: number;
}

// These are not citable entries; their bodies are skipped whole.
const NON_ENTRIES = new Set(["comment", "preamble", "string"]);
const ENTRY_HEAD = /@\s*([A-Za-z]+)\s*([{(])/y;
const FIELD_NAME = /\s*([^\s=,{}()"#%]+)\s*=\s*/y;

/** Every citable entry in text order; a malformed entry is skipped and parsing resumes after it. */
export function parseBibEntries(text: string): BibEntry[] {
  const entries: BibEntry[] = [];
  let at = nextEntryStart(text, 0);
  while (at >= 0) {
    ENTRY_HEAD.lastIndex = at;
    const head = ENTRY_HEAD.exec(text);
    if (!head) { at = nextEntryStart(text, at + 1); continue; }
    const close = head[2] === "{" ? "}" : ")";
    const bodyStart = ENTRY_HEAD.lastIndex;
    const type = head[1]!.toLowerCase();
    const end = NON_ENTRIES.has(type) ? balancedEnd(text, bodyStart - 1) : -1;
    if (NON_ENTRIES.has(type)) { at = nextEntryStart(text, end < 0 ? bodyStart : end); continue; }
    const entry = parseBody(text, bodyStart, close);
    if (entry) { entries.push({ type, key: entry.key, fields: entry.fields, start: at, end: entry.end }); }
    at = nextEntryStart(text, entry ? entry.end : bodyStart);
  }
  return entries;
}

/** A field value as plain text: inner braces removed and whitespace collapsed, for comparisons and lookups. */
export function extractPlainField(value: string | undefined): string {
  return (value ?? "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

// Biber reads `%` to the end of the line as a comment outside entries, so an `@` after one starts nothing.
function nextEntryStart(text: string, from: number): number {
  for (let at = text.indexOf("@", from); at >= 0; at = text.indexOf("@", at + 1)) {
    const lineStart = text.lastIndexOf("\n", at - 1) + 1;
    if (!text.slice(lineStart, at).includes("%")) { return at; }
  }
  return -1;
}

function parseBody(text: string, from: number, close: string): { key: string; fields: Map<string, string>; end: number } | undefined {
  const comma = text.indexOf(",", from);
  const closeAt = text.indexOf(close, from);
  // An entry with only a key (`@misc{key}`) is valid and has no fields.
  if (closeAt >= 0 && (comma < 0 || closeAt < comma)) {
    const key = text.slice(from, closeAt).trim();
    return key ? { key, fields: new Map(), end: closeAt + 1 } : undefined;
  }
  if (comma < 0) { return undefined; }
  const key = text.slice(from, comma).trim();
  if (!key || /[\s@{}]/.test(key)) { return undefined; }
  const fields = new Map<string, string>();
  let at = comma + 1;
  for (;;) {
    at = skipSpace(text, at);
    if (text[at] === close) { return { key, fields, end: at + 1 }; }
    if (text[at] === ",") { at += 1; continue; }
    FIELD_NAME.lastIndex = at;
    const name = FIELD_NAME.exec(text);
    if (!name) { return undefined; }
    const value = readValue(text, FIELD_NAME.lastIndex);
    if (!value) { return undefined; }
    fields.set(name[1]!.toLowerCase(), value.text);
    at = value.end;
  }
}

// A value is one or more parts joined by `#`: `{…}`, `"…"`, a number or a @string macro name.
function readValue(text: string, from: number): { text: string; end: number } | undefined {
  const parts: string[] = [];
  let at = from;
  for (;;) {
    at = skipSpace(text, at);
    const part = readPart(text, at);
    if (!part) { return undefined; }
    parts.push(part.text);
    at = skipSpace(text, part.end);
    if (text[at] !== "#") { return { text: parts.join(""), end: at }; }
    at += 1;
  }
}

function readPart(text: string, at: number): { text: string; end: number } | undefined {
  if (text[at] === "{") {
    const end = balancedEnd(text, at);
    return end < 0 ? undefined : { text: text.slice(at + 1, end - 1), end };
  }
  if (text[at] === "\"") {
    // A quote inside braces is text, so the closing quote is the first one at brace depth zero.
    let depth = 0;
    for (let i = at + 1; i < text.length; i++) {
      if (text[i] === "{") { depth += 1; } else if (text[i] === "}") { depth -= 1; }
      else if (text[i] === "\"" && depth === 0) { return { text: text.slice(at + 1, i), end: i + 1 }; }
    }
    return undefined;
  }
  const bare = /[^\s,#{}()"]+/y;
  bare.lastIndex = at;
  const match = bare.exec(text);
  return match ? { text: match[0], end: bare.lastIndex } : undefined;
}

/** The offset just after the delimiter that closes the one at `open`, or -1 when it never closes. */
function balancedEnd(text: string, open: number): number {
  const opener = text[open]!;
  const closer = opener === "(" ? ")" : "}";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === opener) { depth += 1; } else if (text[i] === closer && (depth -= 1) === 0) { return i + 1; }
  }
  return -1;
}

function skipSpace(text: string, at: number): number {
  while (at < text.length && /\s/.test(text[at]!)) { at += 1; }
  return at;
}
