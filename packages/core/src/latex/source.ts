/** Scans one LaTeX source for labels, references, headings, macro definitions and includes, and holds the text helpers the scan shares: comment blanking and word count. */
import {
  createTextScan, INCLUDE_COMMANDS, MACRO_COMMANDS, readInclude, readLabel, readMacro, readReferences, readSection,
  REF_COMMANDS, SECTION_LEVELS,
} from "./sourceCommands.js";

/** Zero-based line and UTF-16 column, as VS Code counts them. */
export interface LatexPosition {
  line: number;
  character: number;
}

export interface LatexRange {
  start: LatexPosition;
  end: LatexPosition;
}

export interface LabelFact {
  name: string;
  /** Covers the name only, without braces. */
  range: LatexRange;
}

export interface ReferenceFact {
  /** The command without backslash or star, such as "ref" or "Cref". */
  command: string;
  name: string;
  /** Covers this name only; a `\cref{a,b}` yields one fact per name. */
  range: LatexRange;
}

/** Heading depth: part -1, chapter 0, section 1, subsection 2, subsubsection 3, paragraph 4, subparagraph 5. */
export interface SectionFact {
  command: string;
  level: number;
  starred: boolean;
  /** The mandatory argument with whitespace collapsed; the optional short title is dropped. */
  title: string;
  /** From the backslash to the closing brace of the title. */
  range: LatexRange;
}

export interface MacroFact {
  /** The defining command: newcommand, renewcommand, providecommand or DeclareMathOperator. */
  command: string;
  /** The macro name without backslash. */
  name: string;
  argCount: number;
  /** The default for the first argument, when the definition has one. */
  defaultArg: string | undefined;
  body: string;
  range: LatexRange;
}

export interface LatexInclude {
  command: string;
  /** The path as written, trimmed. */
  path: string;
  range: LatexRange;
}

export interface LatexSourceFacts {
  labels: LabelFact[];
  refs: ReferenceFact[];
  sections: SectionFact[];
  macros: MacroFact[];
  includes: LatexInclude[];
}

const COMMAND = /\\([A-Za-z]+)(\*?)/g;

export function scanLatexSource(text: string): LatexSourceFacts {
  const ctx = createTextScan(removeComments(text));
  const facts: LatexSourceFacts = { labels: [], refs: [], sections: [], macros: [], includes: [] };
  for (const match of ctx.text.matchAll(COMMAND)) {
    const [whole, command, star] = match as unknown as [string, string, string];
    const from = match.index;
    const after = from + whole.length;
    const starred = star === "*";
    if (command === "label") { push(facts.labels, readLabel(ctx, after)); }
    else if (REF_COMMANDS.has(command)) { facts.refs.push(...readReferences(ctx, command, after)); }
    else if (SECTION_LEVELS.has(command)) { push(facts.sections, readSection(ctx, command, from, after, starred)); }
    else if (MACRO_COMMANDS.has(command)) { push(facts.macros, readMacro(ctx, command, from, after, starred)); }
    else if (INCLUDE_COMMANDS.has(command)) { push(facts.includes, readInclude(ctx, command, after)); }
  }
  return facts;
}

function push<T>(into: T[], fact: T | undefined): void {
  if (fact) { into.push(fact); }
}

// INVARIANT: the result has the same length as the input; only comment characters change, to spaces.
export function removeComments(text: string): string {
  // `\\.` is matched first so an escaped `\%` is not a comment start.
  return text.replace(/\\.|%[^\n]*/g, (match) => (match.startsWith("%") ? " ".repeat(match.length) : match));
}

const MATH_ENVIRONMENTS = "equation|align|alignat|flalign|gather|multline|eqnarray|math|displaymath";
const CODE_ENVIRONMENTS = "verbatim|lstlisting|comment";
const IGNORED_ARGUMENT_COMMANDS =
  "label|ref|eqref|pageref|autoref|nameref|cref|Cref|vref|Vref|cpageref|Cpageref|[A-Za-z]*cite[A-Za-z]*" +
  "|usepackage|RequirePackage|documentclass|includegraphics|input|include|subfile|bibliography|bibliographystyle";

// Order matters: the alternatives are tried left to right at each offset.
const SKIPPED = new RegExp([
  String.raw`\\\\(?:\[[^\]]*\])?`,
  String.raw`\\begin\{((?:${MATH_ENVIRONMENTS}|${CODE_ENVIRONMENTS})\*?)\}[\s\S]*?\\end\{\1\}`,
  String.raw`\$\$[\s\S]*?\$\$`,
  String.raw`\\\[[\s\S]*?\\\]`,
  String.raw`\\\([\s\S]*?\\\)`,
  String.raw`\\\$`,
  String.raw`\$[^$]*\$`,
  String.raw`\\(?:${IGNORED_ARGUMENT_COMMANDS})\*?(?:\s*\[[^\]]*\])*\s*\{[^}]*\}`,
  String.raw`\\begin\{[^}]*\}(?:\[[^\]]*\])?`,
  String.raw`\\end\{[^}]*\}`,
].join("|"), "g");

const ACCENTED = /\\["'`^~=.]\{?([A-Za-z])\}?/g;
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

/** Counts words between `\begin{document}` and `\end{document}` when present, else in the whole text. */
export function countWords(text: string): number {
  let body = removeComments(text);
  const begin = body.indexOf("\\begin{document}");
  if (begin >= 0) {
    body = body.slice(begin + "\\begin{document}".length);
    const end = body.indexOf("\\end{document}");
    if (end >= 0) { body = body.slice(0, end); }
  }
  const prose = body
    .replace(SKIPPED, " ")
    .replace(ACCENTED, "$1")
    .replace(/\\[A-Za-z@]+\*?|\\./g, " ");
  return prose.match(WORD)?.length ?? 0;
}
