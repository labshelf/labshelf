/** Exports runtime-neutral readers of LaTeX source: per-file facts, the include tree, undefined references, MathJax macros and word count. */
export type {
  IncludeFact, LabelFact, LatexPosition, LatexRange, LatexSourceFacts, MacroFact, RefFact, SectionFact,
} from "./facts.js";
export * from "./project/index.js";
export { readDelimited, skipSpace } from "./commands/index.js";
export { countWords } from "./countWords.js";
export { scanLatexSource } from "./scanLatexSource.js";
export { stripComments } from "./stripComments.js";
