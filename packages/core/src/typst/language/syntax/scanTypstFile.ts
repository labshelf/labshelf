// Collects the bindings, labels, imports, includes and bibliographies a Typst file defines.
import { lineOf, lineStarts } from "../../../writing/text/index.js";
import type { TypstBinding, TypstFileSymbols, TypstImport } from "./typstFileSymbols.js";
import { walkTypst } from "./typstWalk.js";

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
  const starts = lineStarts(text);
  walkTypst(text, {
    ident(name, from, to, topLevel) {
      if (name !== "let") { return; }
      const head = readLetHead(text, from, to);
      if (!head) { return; }
      const line = lineOf(starts, from);
      const binding: TypstBinding = { ...head, line, topLevel };
      const doc = docAbove(text, starts, line);
      if (doc !== undefined) { binding.doc = doc; }
      symbols.bindings.push(binding);
    },
    label(name, from, to) {
      const line = lineOf(starts, from);
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
