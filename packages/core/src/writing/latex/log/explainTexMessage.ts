/** Turns a TeX log message into a plain-language problem with a hint on how to fix it, or drops it as noise. */

import type { LatexEngine } from "../../project/index.js";
import type { TexLogMessage } from "./readTexLog.js";

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
export function explainTexMessage(message: TexLogMessage, engine: LatexEngine): BuildProblem | null {
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
