/** Exports runtime-neutral readers of LaTeX source: per-file facts, the include tree, undefined references, MathJax macros and word count. */
export type {
  IncludeFact, LabelFact, LatexPosition, LatexRange, LatexSourceFacts, MacroFact, RefFact, SectionFact,
} from "./facts.js";
export * from "./project/index.js";
export * from "./scan/index.js";
export * from "./words/index.js";
