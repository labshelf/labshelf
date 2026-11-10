/** Finds the functions and classes of a Python, R or Julia file with their line spans, without a parser: by indentation in Python, braces in R and `end` keywords in Julia. */
// CONTRACT: documents/contracts/library-format.md#code-listings
import type { SymbolLanguage } from "./codeLanguages.js";

export interface CodeSymbol {
  /** Dotted from the enclosing definitions: `Model.fit`. */
  name: string;
  kind: "function" | "class";
  /** 0-based, inclusive; the first line includes decorators. */
  startLine: number;
  endLine: number;
}

interface Found { name: string; kind: CodeSymbol["kind"]; startLine: number; endLine: number }

/** The file's definitions in source order; a name defined twice is listed twice. */
export function listCodeSymbols(language: SymbolLanguage, text: string): CodeSymbol[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const found = language === "python" ? findPython(lines) : language === "r" ? findR(lines) : findJulia(lines);
  return nest(found);
}

/** The first definition with that dotted name. */
export function findCodeSymbol(language: SymbolLanguage, text: string, name: string): CodeSymbol | undefined {
  return listCodeSymbols(language, text).find((symbol) => symbol.name === name);
}

/** The innermost definition spanning a 0-based line. */
export function findEnclosingSymbol(symbols: readonly CodeSymbol[], line: number): CodeSymbol | undefined {
  let best: CodeSymbol | undefined;
  for (const symbol of symbols) {
    if (symbol.startLine <= line && line <= symbol.endLine && (!best || symbol.endLine - symbol.startLine <= best.endLine - best.startLine)) { best = symbol; }
  }
  return best;
}

/** Prefixes each name with the names of the definitions around it. */
function nest(found: readonly Found[]): CodeSymbol[] {
  const sorted = [...found].sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
  const open: CodeSymbol[] = [];
  const result: CodeSymbol[] = [];
  for (const item of sorted) {
    while (open.length > 0 && open[open.length - 1]!.endLine < item.startLine) { open.pop(); }
    const parent = open[open.length - 1];
    const symbol = { ...item, name: parent && item.endLine <= parent.endLine ? `${parent.name}.${item.name}` : item.name };
    result.push(symbol);
    open.push(symbol);
  }
  return result;
}

const indentOf = (line: string): number => /^[ \t]*/.exec(line)![0].replace(/\t/g, "    ").length;

/** The last line of a span, before the blank lines that end it. */
function trimEnd(lines: readonly string[], start: number, end: number): number {
  while (end > start && lines[end]!.trim() === "") { end--; }
  return end;
}

// ---- Python

const PY_DEF = /^([ \t]*)(?:async[ \t]+)?(def|class)[ \t]+([A-Za-z_]\w*)/;

/** Whether each line starts a statement: false inside brackets or a triple-quoted string that began earlier. */
function pythonStatementStarts(lines: readonly string[]): boolean[] {
  const starts: boolean[] = [];
  let depth = 0;
  let triple: string | undefined;
  for (const line of lines) {
    starts.push(depth === 0 && triple === undefined);
    let quote: string | undefined;
    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;
      if (triple !== undefined) {
        if (line.startsWith(triple, i)) { i += 2; triple = undefined; }
        continue;
      }
      if (quote !== undefined) {
        if (char === "\\") { i++; } else if (char === quote) { quote = undefined; }
        continue;
      }
      if (char === "#") { break; }
      if (line.startsWith('"""', i) || line.startsWith("'''", i)) { triple = line.slice(i, i + 3); i += 2; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if ("([{".includes(char)) { depth++; } else if (")]}".includes(char)) { depth = Math.max(0, depth - 1); }
    }
  }
  return starts;
}

function findPython(lines: readonly string[]): Found[] {
  const starts = pythonStatementStarts(lines);
  const found: Found[] = [];
  lines.forEach((line, index) => {
    const match = starts[index] ? PY_DEF.exec(line) : null;
    if (!match) { return; }
    const indent = indentOf(line);
    let startLine = index;
    while (startLine > 0 && starts[startLine - 1] && /^\s*@/.test(lines[startLine - 1]!) && indentOf(lines[startLine - 1]!) === indent) { startLine--; }
    // The body ends before the next statement indented no deeper than the definition; comments do not end it.
    let end = lines.length - 1;
    for (let next = index + 1; next < lines.length; next++) {
      const text = lines[next]!;
      if (!starts[next] || text.trim() === "" || text.trim().startsWith("#")) { continue; }
      if (indentOf(text) <= indent) { end = next - 1; break; }
    }
    while (end > index && (lines[end]!.trim() === "" || (lines[end]!.trim().startsWith("#") && indentOf(lines[end]!) <= indent))) { end--; }
    found.push({ name: match[3]!, kind: match[2] === "class" ? "class" : "function", startLine, endLine: end });
  });
  return found;
}

// ---- R

const R_DEF = /^[ \t]*([A-Za-z.][\w.]*|`[^`]+`)[ \t]*(?:<<?-|=)[ \t]*(?:function\b|\\\()/;

/** The offsets of `text` that are code, with strings and comments blanked so brackets in them do not count. */
function blankStringsAndComments(text: string, comment: string): string {
  let out = "";
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quote !== undefined) {
      if (char === "\\") { out += "  "; i++; continue; }
      if (char === quote) { quote = undefined; }
      out += char === "\n" ? "\n" : " ";
      continue;
    }
    if (text.startsWith(comment, i)) {
      while (i < text.length && text[i] !== "\n") { out += " "; i++; }
      if (i < text.length) { out += "\n"; }
      continue;
    }
    if (char === '"' || char === "'") { quote = char; }
    out += char;
  }
  return out;
}

function findR(lines: readonly string[]): Found[] {
  const code = blankStringsAndComments(lines.join("\n"), "#");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) { lineStarts.push(offset); offset += line.length + 1; }
  const lineAt = (at: number): number => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) { const mid = (low + high + 1) >> 1; if (lineStarts[mid]! <= at) { low = mid; } else { high = mid - 1; } }
    return low;
  };
  const found: Found[] = [];
  lines.forEach((line, index) => {
    const match = R_DEF.exec(line);
    if (!match) { return; }
    const name = match[1]!.replace(/^`|`$/g, "");
    // After the argument list: a braced body runs to its closing brace, anything else to the end of the line.
    const open = code.indexOf("(", lineStarts[index]! + match[0].length - 1);
    const argsEnd = open < 0 ? -1 : matchClose(code, open, "(", ")");
    if (argsEnd < 0) { return; }
    const after = /\S/.exec(code.slice(argsEnd + 1));
    const bodyAt = after ? argsEnd + 1 + after.index : -1;
    const end = bodyAt >= 0 && code[bodyAt] === "{" ? matchClose(code, bodyAt, "{", "}") : -1;
    const endLine = end >= 0 ? lineAt(end) : bodyAt >= 0 ? lineAt(bodyAt) : index;
    found.push({ name, kind: "function", startLine: index, endLine: trimEnd(lines, index, endLine) });
  });
  return found;
}

/** The offset of the bracket that closes the one at `open`, or -1. */
function matchClose(code: string, open: number, opening: string, closing: string): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === opening) { depth++; } else if (code[i] === closing && --depth === 0) { return i; }
  }
  return -1;
}

// ---- Julia

const JL_BLOCK_DEF = /^[ \t]*(?:@\w+[ \t]+)*(?:(function|macro)[ \t]+([\w.!]+|\([^)]*\))|(?:mutable[ \t]+)?(struct)[ \t]+(\w+)|(?:abstract|primitive)[ \t]+type[ \t]+(\w+)|(module|baremodule)[ \t]+(\w+))/;
const JL_SHORT_DEF = /^[ \t]*(?:@\w+[ \t]+)*([A-Za-z_][\w.!]*)(?:\{[^}]*\})?\([^=]*\)(?:[ \t]*::[ \t]*[\w.{}, ]+)?(?:[ \t]+where[ \t]+.*?)?[ \t]*=(?!=)/;
const JL_OPENERS: ReadonlySet<string> = new Set(["function", "macro", "if", "for", "while", "begin", "let", "struct", "quote", "do", "try", "module", "baremodule", "type"]);
const JL_WORDS = /\b(function|macro|if|for|while|begin|let|struct|quote|do|try|module|baremodule|type|end)\b/g;

/** Julia code with strings, comments and the inside of brackets blanked, so `a[end]` and comprehensions do not count as blocks. */
function blankJulia(text: string): string {
  const unquoted = blankStringsAndComments(text.replace(/#=[\s\S]*?=#/g, (block) => block.replace(/[^\n]/g, " ")), "#");
  let out = "";
  let depth = 0;
  for (const char of unquoted) {
    if ("([{".includes(char)) { depth++; out += char; continue; }
    if (")]}".includes(char)) { depth = Math.max(0, depth - 1); out += char; continue; }
    out += depth > 0 && char !== "\n" ? " " : char;
  }
  return out;
}

function findJulia(lines: readonly string[]): Found[] {
  const blank = blankJulia(lines.join("\n")).split("\n");
  const found: Found[] = [];
  lines.forEach((line, index) => {
    const block = JL_BLOCK_DEF.exec(line);
    if (block) {
      const name = block[2] ?? block[4] ?? block[5] ?? block[7] ?? "";
      // An anonymous `function (x)` has no name to link to.
      if (name.startsWith("(")) { return; }
      const kind = block[3] || block[5] || block[6] ? "class" : "function";
      found.push({ name, kind, startLine: index, endLine: juliaBlockEnd(blank, index) });
      return;
    }
    const short = JL_SHORT_DEF.exec(line);
    if (short && !/^\s*(if|elseif|while|for|return|local|global|const)\b/.test(line)) {
      found.push({ name: short[1]!, kind: "function", startLine: index, endLine: index });
    }
  });
  return found;
}

/** The line of the `end` that closes the block opened on `start`; the last line when it is never closed. */
function juliaBlockEnd(blank: readonly string[], start: number): number {
  let depth = 0;
  for (let index = start; index < blank.length; index++) {
    const words = blank[index]!.replace(/\babstract\s+type\b|\bprimitive\s+type\b/g, " type ").replace(/\bmutable\s+struct\b/g, "struct").match(JL_WORDS) ?? [];
    for (const word of words) {
      depth += word === "end" ? -1 : JL_OPENERS.has(word) ? 1 : 0;
      if (depth === 0) { return index; }
    }
  }
  return blank.length - 1;
}
