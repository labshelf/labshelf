// Reads a LaTeX build log (.log) into build problems in plain language, located in the source and in the order TeX met them.
// Three stages: read the transcript into messages, explain each message, then drop noise and duplicates.

import type { LatexEngine } from "../writing/project/index.js";

// Reading the transcript: errors, warnings and bad boxes, each placed in the file and line it came from.

type TexLogMessageKind = "error" | "warning" | "badbox";

export interface TexLogMessage {
  kind: TexLogMessageKind;
  /** The message as TeX wrote it, continuation lines joined, without the "! " or "X Warning: " prefix. */
  text: string;
  /** Who raised it: "LaTeX", "LaTeX Font", "Package hyperref", "Class article"; absent for TeX primitives. */
  source?: string;
  /** Path as the log names it, without a leading "./". */
  file?: string;
  line?: number;
  /** For errors: the source text up to the point where TeX stopped (the `l.<n>` line). */
  context?: string;
}

// PLATFORM: TeX Live breaks transcript lines at max_print_line, 79 characters by default.
const WRAP_WIDTH = 79;
const ERROR_CONTEXT_SEARCH = 20;

const FILE_LINE_ERROR = /^((?:[A-Za-z]:)?[^:\s()]*[^:\s()/\\]\.[A-Za-z]\w*):(\d+): (.+)$/;
const SOURCED = /^([A-Z][A-Za-z]*(?: [^\s:]+){0,2}) (Warning|Error): (.*)$/;
const BAD_BOX = /^(?:Over|Under)full \\[hv]box \(.*?\)(?:.*? at lines? (\d+))?/;
const CONTEXT_LINE = /^l\.(\d+) ?(.*)$/;
const INPUT_LINE = /on input line (\d+)/;
const CONTINUATION = /^\([A-Za-z@-]+\)(?:\s+(?=\S)|\s*$)/;

function unwrap(log: string): string[] {
  const lines: string[] = [];
  let pending = "";
  for (const line of log.split(/\r?\n/)) {
    pending += line;
    if (line.length === WRAP_WIDTH) { continue; }
    lines.push(pending);
    pending = "";
  }
  if (pending !== "") { lines.push(pending); }
  return lines;
}

function looksLikeFile(token: string): boolean {
  return /[/\\]/.test(token) || /\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(token);
}

function normalizePath(token: string): string {
  return token.replace(/^\.\//, "");
}

/** Tracks the `(file … )` nesting TeX prints as it opens and closes input files. */
class FileStack {
  private readonly frames: (string | undefined)[] = [];

  scan(line: string): void {
    for (let i = 0; i < line.length; i++) {
      if (line[i] === ")") { this.frames.pop(); continue; }
      if (line[i] !== "(") { continue; }
      const token = /^[^\s()]*/.exec(line.slice(i + 1))![0];
      this.frames.push(looksLikeFile(token) ? normalizePath(token) : undefined);
      i += token.length;
    }
  }

  current(): string | undefined {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i] !== undefined) { return this.frames[i]; }
    }
    return undefined;
  }
}

/** Lines that continue a sourced message start with the padded source name, "(hyperref)   …" or "(Font)   …". */
function continuation(lines: string[], start: number): [string, number] {
  let text = "";
  let used = 0;
  while (start + used < lines.length && CONTINUATION.test(lines[start + used]!)) {
    text += ` ${lines[start + used]!.replace(CONTINUATION, "")}`;
    used++;
  }
  return [text, used];
}

function splitSource(text: string): { source?: string; text: string } {
  const match = SOURCED.exec(text);
  return match && match[2] === "Error" ? { source: match[1]!, text: match[3]! } : { text };
}

/** Reads an error starting at `start`; returns the message and the index of the last line it used. */
function readError(lines: string[], start: number, head: string, at: { file?: string; line?: number }): [TexLogMessage, number] {
  const { source, text } = splitSource(head.replace(/^(?:! )+/, ""));
  const [more, used] = source ? continuation(lines, start + 1) : ["", 0];
  const message: TexLogMessage = { kind: "error", text: (text + more).trim(), ...at };
  if (source) { message.source = source; }
  let end = start + used;
  for (let i = end + 1; i < Math.min(lines.length, end + ERROR_CONTEXT_SEARCH); i++) {
    const context = CONTEXT_LINE.exec(lines[i]!);
    if (!context) { continue; }
    message.line ??= Number(context[1]);
    message.context = context[2]!;
    end = i + 1;
    break;
  }
  return [message, end];
}

function readWarning(lines: string[], start: number, source: string, head: string, file: string | undefined): [TexLogMessage, number] {
  const [more, used] = continuation(lines, start + 1);
  const text = (head + more).replace(/\s+/g, " ").trim();
  const message: TexLogMessage = { kind: "warning", source, text };
  if (file) { message.file = file; }
  const line = INPUT_LINE.exec(text);
  if (line) { message.line = Number(line[1]); }
  return [message, start + used];
}

/** Skips the box contents TeX prints after a bad box, which may hold unbalanced parentheses from the text. */
function skipToBlank(lines: string[], start: number): number {
  let end = start;
  while (end + 1 < lines.length && lines[end + 1]!.trim() !== "") { end++; }
  return end;
}

function readTexLog(log: string): TexLogMessage[] {
  const lines = unwrap(log);
  const files = new FileStack();
  const messages: TexLogMessage[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const file = files.current();
    const located = FILE_LINE_ERROR.exec(line);
    if (line.startsWith("! ") || located) {
      const at = located ? { file: normalizePath(located[1]!), line: Number(located[2]) } : file ? { file } : {};
      const [message, end] = readError(lines, i, located ? located[3]! : line, at);
      messages.push(message);
      i = end;
      continue;
    }
    const sourced = SOURCED.exec(line);
    if (sourced && sourced[2] === "Warning") {
      const [message, end] = readWarning(lines, i, sourced[1]!, sourced[3]!, file);
      messages.push(message);
      i = end;
      continue;
    }
    const badBox = BAD_BOX.exec(line);
    if (badBox) {
      messages.push({ kind: "badbox", text: line.trim(), ...(file ? { file } : {}), ...(badBox[1] ? { line: Number(badBox[1]) } : {}) });
      i = skipToBlank(lines, i);
      continue;
    }
    files.scan(line);
  }
  return messages;
}

// Explaining one message: a plain-language problem with a hint on how to fix it, or dropped as noise.

export type BuildProblemSeverity = "error" | "warning" | "info";

/** The problems a preview marks on the PDF. */
export type BuildProblemKind = "undefinedCitation" | "undefinedReference" | "overfull";

export interface BuildProblem {
  severity: BuildProblemSeverity;
  message: string;
  hint?: string;
  file?: string;
  line?: number;
  kind?: BuildProblemKind;
  /** The cite key or label the problem is about. */
  subject?: string;
}

type Explanation = { message: string; hint?: string; kind?: BuildProblemKind; subject?: string } | null;
type Rule = [RegExp, (match: RegExpExecArray, message: TexLogMessage, engine: LatexEngine) => Explanation];

const SPELLING_HINT = "Check the spelling, or load the package that defines it with \\usepackage.";
const LUA_ONLY = /^\\(?:directlua|luaexec|luadirect)$/;

function lastCommand(context: string | undefined): string | undefined {
  return context ? /(\\(?:[A-Za-z@]+|.))\s*$/.exec(context)?.[1] : undefined;
}

function unknownCommandHint(command: string | undefined, engine: LatexEngine): string {
  if (!command || !LUA_ONLY.test(command) || engine === "lualatex") { return SPELLING_HINT; }
  return `${command} needs LuaLaTeX. Switch the compiler to LuaLaTeX.`;
}

function missingFile(name: string): Explanation {
  const kind = /\.sty$/.test(name) ? "Package" : /\.cls$/.test(name) ? "Document class" : undefined;
  if (!kind) { return { message: `File "${name}" not found.`, hint: "Paths are relative to the folder of the main file." }; }
  const pkg = name.replace(/\.(?:sty|cls)$/, "");
  return {
    message: `${kind} "${pkg}" is not installed.`,
    hint: `Install it with \`tlmgr install ${pkg}\`. The TeX Live package name is usually the file name.`,
  };
}

const ERROR_RULES: Rule[] = [
  [/^Undefined control sequence/, (_, m, engine) => {
    const command = lastCommand(m.context);
    return { message: command ? `Unknown command ${command}.` : "Unknown command.", hint: unknownCommandHint(command, engine) };
  }],
  [/^File [`'](.+?)' not found/, (match) => missingFile(match[1]!)],
  [/^I can't find file [`'](.+?)'/, (match) => missingFile(match[1]!)],
  [/^Environment (\S+) undefined/, (match) => ({ message: `Unknown environment "${match[1]}".`, hint: SPELLING_HINT })],
  [/^Missing \$ inserted/, () => ({
    message: "A math symbol is outside math mode.",
    hint: "Put the formula between $ and $; ^ and _ only work in math.",
  })],
  [/^\\begin\{(.+?)\}(?: on input line (\d+))? ended by \\end\{(.+?)\}/, (match) => ({
    message: `\\begin{${match[1]}}${match[2] ? ` on line ${match[2]}` : ""} is closed by \\end{${match[3]}}.`,
  })],
  [/^(?:Missing [{}] inserted|Extra \}, or forgotten|Too many \}'s)/, () => ({ message: "A { or } is missing or extra." })],
  [/^(?:Paragraph ended before|File ended while scanning use of) (\\\S+?)(?: was complete)?\.?$/, (match) => ({
    message: `The argument of ${match[1]} is missing its closing brace.`,
  })],
  [/^Missing \\begin\{document\}/, () => ({
    message: "Text appears before \\begin{document}.",
    hint: "Move it below \\begin{document}; the preamble holds only settings.",
  })],
  [/^Can be used only in preamble/, () => ({ message: "This command only works before \\begin{document}." })],
  [/requires either XeTeX or LuaTeX/, () => ({ message: "This document needs XeLaTeX or LuaLaTeX.", hint: "Switch the compiler to XeLaTeX or LuaLaTeX." })],
];

// Summaries and rerun notices repeat what other messages say, and the build reruns on its own.
const NOISE = /^(?:There were (?:undefined|multiply-defined)|Label\(s\) may have changed|.*Rerun to get)/;

const WARNING_RULES: Rule[] = [
  [NOISE, () => null],
  [/^Reference [`'](.+?)' on page \S+ undefined/, (match) => ({
    message: `Reference "${match[1]}" has no matching \\label.`, kind: "undefinedReference", subject: match[1]!,
  })],
  [/^Citation [`'](.+?)' (?:on page \S+ )?undefined/, (match) => ({
    message: `Citation "${match[1]}" is not in any bibliography.`,
    hint: "Cite it through the library completion, or add it to your own .bib file.",
    kind: "undefinedCitation",
    subject: match[1]!,
  })],
  [/^Label [`'](.+?)' multiply defined/, (match) => ({ message: `Label "${match[1]}" is defined more than once.` })],
];

function rounded(points: string): string {
  return `${Math.round(Number.parseFloat(points) * 10) / 10}pt`;
}

function explainBadBox(text: string): Explanation {
  const wide = /^Overfull \\hbox \(([\d.]+)pt too wide\)/.exec(text);
  if (wide) { return { message: `A line sticks ${rounded(wide[1]!)} into the margin.`, kind: "overfull" }; }
  const high = /^Overfull \\vbox \(([\d.]+)pt too high\)/.exec(text);
  return high ? { message: `Content is ${rounded(high[1]!)} too tall for the page.` } : null;
}

function applyRules(rules: Rule[], message: TexLogMessage, engine: LatexEngine): Explanation | undefined {
  for (const [pattern, explain] of rules) {
    const match = pattern.exec(message.text);
    if (match) { return explain(match, message, engine); }
  }
  return undefined;
}

function withoutInputLine(text: string): string {
  return text.replace(/ on input line \d+\.?$/, ".");
}

function explanation(message: TexLogMessage, engine: LatexEngine): [BuildProblemSeverity, Explanation] {
  const raw = { message: withoutInputLine(message.source ? `${message.source}: ${message.text}` : message.text) };
  if (message.kind === "badbox") { return ["info", explainBadBox(message.text)]; }
  const rules = message.kind === "error" ? ERROR_RULES : WARNING_RULES;
  const explained = applyRules(rules, message, engine);
  const severity = message.kind === "error" ? "error" : message.source === "LaTeX Font" ? "info" : "warning";
  return [severity, explained === undefined ? raw : explained];
}

/** Explains one message; null for noise. Unknown messages keep TeX's own words (R4 in the writing plan). */
export function describeTexMessage(message: TexLogMessage, engine: LatexEngine): BuildProblem | null {
  const [severity, explained] = explanation(message, engine);
  if (!explained) { return null; }
  const problem: BuildProblem = { severity, message: explained.message };
  if (explained.hint) { problem.hint = explained.hint; }
  if (explained.kind) { problem.kind = explained.kind; }
  if (explained.subject !== undefined) { problem.subject = explained.subject; }
  if (message.file) { problem.file = message.file; }
  if (message.line !== undefined) { problem.line = message.line; }
  return problem;
}

// Listing the problems of a build, in the order TeX met them.

// TeX follows a fatal error with these; they say only that the run stopped.
const AFTERMATH = /^(?:Emergency stop|==> Fatal error occurred|\*\*\* \(job aborted)/;

function key(problem: BuildProblem): string {
  return `${problem.file ?? ""}:${problem.line ?? ""}:${problem.severity}:${problem.message}`;
}

export function parseTexLog(log: string, engine: LatexEngine): BuildProblem[] {
  const messages = readTexLog(log);
  const hasCause = messages.some((message) => message.kind === "error" && !AFTERMATH.test(message.text));
  const kept = (message: TexLogMessage): boolean => !(hasCause && message.kind === "error" && AFTERMATH.test(message.text));
  const seen = new Set<string>();
  const problems: BuildProblem[] = [];
  for (const message of messages.filter(kept)) {
    const problem = describeTexMessage(message, engine);
    if (!problem || seen.has(key(problem))) { continue; }
    seen.add(key(problem));
    problems.push(problem);
  }
  return problems;
}
