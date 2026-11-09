/**
 * Collects the author's macro definitions from a TeX text and expands them in a piece of LaTeX:
 * \newcommand, \renewcommand, \providecommand (with an optional default argument), \def with #1..#9,
 * \let aliases and \DeclareMathOperator(*). Expansion is brace-aware and stops at a depth of 32 nested
 * expansions or 64 KiB of output, returning what was expanded so far plus the unexpanded rest.
 */
import { removeComments } from "../latex/source.js";

export interface MacroTable { readonly size: number }

interface MacroDefinition {
  params: number;
  /** Default of the optional first argument; undefined when the first argument is mandatory. */
  optional?: string | undefined;
  body: string;
}

class DefinedMacros implements MacroTable {
  constructor(readonly definitions: ReadonlyMap<string, MacroDefinition>) {}
  get size(): number { return this.definitions.size; }
}

const DEPTH_CAP = 32;
const OUTPUT_CAP = 64 * 1024;
// Guards against macros that expand to nothing yet branch exponentially, which never reach the output cap.
const STEP_CAP = 100_000;

const DEFINING = /\\(newcommand|renewcommand|providecommand|DeclareRobustCommand|def|gdef|edef|xdef|let|DeclareMathOperator)(?![A-Za-z])(\*?)/g;

interface Parsed { name: string; definition: MacroDefinition; end: number }

/** Reads every macro definition of `tex`; a command defined twice keeps its last definition. */
export function collectMacros(tex: string): MacroTable {
  const text = removeComments(tex);
  const definitions = new Map<string, MacroDefinition>();
  let resume = 0;
  for (const match of text.matchAll(DEFINING)) {
    if (match.index < resume) continue;
    const [whole, command = "", star = ""] = match;
    const parsed = readDefinition(text, command, star === "*", match.index + whole.length);
    if (!parsed) continue;
    resume = parsed.end;
    if (command === "providecommand" && definitions.has(parsed.name)) continue;
    definitions.set(parsed.name, parsed.definition);
  }
  return new DefinedMacros(definitions);
}

function readDefinition(text: string, command: string, starred: boolean, at: number): Parsed | undefined {
  switch (command) {
    case "def": case "gdef": case "edef": case "xdef": return readDef(text, at);
    case "let": return readLet(text, at);
    case "DeclareMathOperator": return readOperator(text, at, starred);
    default: return readNewCommand(text, at);
  }
}

function readNewCommand(text: string, at: number): Parsed | undefined {
  const name = readDefinedName(text, at);
  if (!name) return undefined;
  let i = skipSpaces(text, name.end);
  let params = 0;
  let optional: string | undefined;
  if (text[i] === "[") {
    const count = readBracket(text, i);
    if (!count) return undefined;
    params = Number.parseInt(count.content.trim(), 10);
    if (!Number.isInteger(params) || params < 0 || params > 9) return undefined;
    i = skipSpaces(text, count.end);
    if (text[i] === "[") {
      const fallback = readBracket(text, i);
      if (!fallback) return undefined;
      optional = fallback.content;
      i = skipSpaces(text, fallback.end);
    }
  }
  const body = readGroup(text, i);
  if (!body) return undefined;
  return { name: name.name, definition: { params, optional, body: body.content }, end: body.end };
}

function readDef(text: string, at: number): Parsed | undefined {
  const name = readControlSequence(text, skipSpaces(text, at));
  if (!name) return undefined;
  const open = text.indexOf("{", name.end);
  if (open < 0) return undefined;
  const pattern = text.slice(name.end, open).replace(/\s+/g, "");
  // Delimited parameters (text between the #n) are not supported; such a \def is left undefined.
  if (!/^(#[1-9])*$/.test(pattern)) return undefined;
  const body = readGroup(text, open);
  if (!body) return undefined;
  return { name: name.name, definition: { params: pattern.length / 2, body: body.content }, end: body.end };
}

function readLet(text: string, at: number): Parsed | undefined {
  const name = readControlSequence(text, skipSpaces(text, at));
  if (!name) return undefined;
  let i = skipSpaces(text, name.end);
  if (text[i] === "=") i = skipSpaces(text, i + 1);
  const target = readControlSequence(text, i);
  if (target) return { name: name.name, definition: { params: 0, body: "\\" + target.name }, end: target.end };
  const char = text[i];
  if (char === undefined) return undefined;
  return { name: name.name, definition: { params: 0, body: char }, end: i + 1 };
}

function readOperator(text: string, at: number, starred: boolean): Parsed | undefined {
  const name = readDefinedName(text, at);
  if (!name) return undefined;
  const label = readGroup(text, skipSpaces(text, name.end));
  if (!label) return undefined;
  const body = `\\operatorname${starred ? "*" : ""}{${label.content}}`;
  return { name: name.name, definition: { params: 0, body }, end: label.end };
}

/** Reads `{\name}` or `\name` at `at` (after spaces). */
function readDefinedName(text: string, at: number): { name: string; end: number } | undefined {
  const i = skipSpaces(text, at);
  if (text[i] !== "{") return readControlSequence(text, i);
  const group = readGroup(text, i);
  if (!group) return undefined;
  const inner = readControlSequence(group.content.trim(), 0);
  if (!inner || inner.end !== group.content.trim().length) return undefined;
  return { name: inner.name, end: group.end };
}

/** Reads `\name` (letters) or a control symbol `\x` at `i`; the name excludes the backslash. */
function readControlSequence(text: string, i: number): { name: string; end: number } | undefined {
  if (text[i] !== "\\") return undefined;
  const letters = readLetters(text, i + 1);
  if (letters) return { name: letters, end: i + 1 + letters.length };
  const symbol = text[i + 1];
  return symbol === undefined ? undefined : { name: symbol, end: i + 2 };
}

/** Expands the macros of `macros` in `latex`; unknown commands stay as they are. */
export function expandMacros(latex: string, macros: MacroTable): string {
  if (!(macros instanceof DefinedMacros) || macros.size === 0) return latex;
  const state: ExpandState = { length: 0, steps: 0, stopped: false };
  return expandText(latex, macros.definitions, 0, state);
}

interface ExpandState { length: number; steps: number; stopped: boolean }

function expandText(text: string, definitions: ReadonlyMap<string, MacroDefinition>, depth: number, state: ExpandState): string {
  let out = "";
  let i = 0;
  const emit = (piece: string): void => {
    out += piece;
    state.length += piece.length;
    if (state.length > OUTPUT_CAP) state.stopped = true;
  };
  while (i < text.length) {
    if (state.stopped) return out + text.slice(i);
    const at = text.indexOf("\\", i);
    if (at < 0) { emit(text.slice(i)); break; }
    emit(text.slice(i, at));
    if (state.stopped) return out + text.slice(at);
    const name = readLetters(text, at + 1);
    if (!name) { emit(text.slice(at, at + 2)); i = at + 2; continue; }
    const nameEnd = at + 1 + name.length;
    const definition = definitions.get(name);
    const call = definition ? readCall(text, nameEnd, definition) : undefined;
    if (!definition || !call) { emit(text.slice(at, nameEnd)); i = nameEnd; continue; }
    state.steps += 1;
    if (depth + 1 > DEPTH_CAP || state.steps > STEP_CAP) {
      state.stopped = true;
      return out + text.slice(at);
    }
    out += expandText(substitute(definition.body, call.args), definitions, depth + 1, state);
    i = call.end;
  }
  return out;
}

/** Reads the arguments of a call whose name ends at `at`; undefined when the text runs out first. */
function readCall(text: string, at: number, definition: MacroDefinition): { args: string[]; end: number } | undefined {
  const args: string[] = [];
  let i = at;
  let mandatory = definition.params;
  if (definition.optional !== undefined && mandatory > 0) {
    const j = skipSpaces(text, i);
    const given = text[j] === "[" ? readBracket(text, j) : undefined;
    if (given) { args.push(given.content); i = given.end; }
    else args.push(definition.optional);
    mandatory -= 1;
  }
  for (let k = 0; k < mandatory; k++) {
    const arg = readArgument(text, skipSpaces(text, i));
    if (!arg) return undefined;
    args.push(arg.content);
    i = arg.end;
  }
  return { args, end: i };
}

function readArgument(text: string, i: number): { content: string; end: number } | undefined {
  const char = text[i];
  if (char === undefined || char === "}") return undefined;
  if (char === "{") return readGroup(text, i);
  if (char === "\\") {
    const sequence = readControlSequence(text, i);
    return sequence && { content: text.slice(i, sequence.end), end: sequence.end };
  }
  return { content: char, end: i + 1 };
}

function substitute(body: string, args: readonly string[]): string {
  return body.replace(/##|#([1-9])/g, (match, digit: string | undefined) =>
    digit === undefined ? "#" : args[Number(digit) - 1] ?? match);
}

/** Reads the brace group opening at `i`; `content` excludes the braces. Undefined when unbalanced. */
export function readGroup(text: string, i: number): { content: string; end: number } | undefined {
  if (text[i] !== "{") return undefined;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const char = text[j];
    if (char === "\\") { j += 1; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return { content: text.slice(i + 1, j), end: j + 1 };
    }
  }
  return undefined;
}

/** Reads the `[...]` opening at `i`, skipping brackets inside braces. */
function readBracket(text: string, i: number): { content: string; end: number } | undefined {
  let depth = 0;
  for (let j = i + 1; j < text.length; j++) {
    const char = text[j];
    if (char === "\\") { j += 1; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === "]" && depth === 0) return { content: text.slice(i + 1, j), end: j + 1 };
  }
  return undefined;
}

export function skipSpaces(text: string, i: number): number {
  let j = i;
  while (j < text.length && /\s/.test(text[j] ?? "")) j += 1;
  return j;
}

export function readLetters(text: string, i: number): string {
  let j = i;
  while (j < text.length && /[A-Za-z]/.test(text[j] ?? "")) j += 1;
  return text.slice(i, j);
}
