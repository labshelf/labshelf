/** Describes what a scan of one LaTeX source file finds: labels, references, headings, macros and includes with their positions. */

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

export interface IncludeFact {
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
  includes: IncludeFact[];
}
