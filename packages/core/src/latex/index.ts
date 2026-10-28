/** Exports the LaTeX domain: its build command, toolchain and build log, plus reading its source and its command catalog.
 * Math preview is the `@labshelf/core/math` entry, kept out of this barrel so MathJax stays out of every bundle that does not render math. */
export { createLatexBuildCommand, createLatexPreviewCommand } from "./build.js";
export type { BuildCommand, LatexBuildOptions, LatexBuildResult, LocatedProblem, PartialBuild } from "./build.js";
export { deriveTexProblemClass } from "./problems.js";
export type { TexProblemClass } from "./problems.js";
export {
  createSectionBuildStatePackage, createSectionBuildStateRestore, deriveSectionBuildStateFileName, parseSectionBuildStates, SECTION_STATE_PACKAGE,
} from "./sectionState.js";
export type { ParsedSectionStates, SectionState } from "./sectionState.js";
export type { LatexCatalogEntry } from "./catalog.js";
export { LATEX_COMMANDS, LATEX_ENVIRONMENTS } from "./catalog.js";
export { deriveSnippetTemplate, findEnvironmentToClose, findLatexCompletionSpan, type LatexCompletionSpan } from "./catalogCompletion.js";
export { createProjectLabels, type ProjectLabel, type ProjectLabels } from "./projectLabels.js";
export type { BuildProblem, BuildProblemKind, BuildProblemSeverity } from "./log.js";
export { parseTexLog } from "./log.js";
export type {
  LatexInclude, LabelFact, LatexPosition, LatexRange, LatexSourceFacts, MacroFact, ReferenceFact, SectionFact,
} from "./source.js";
export { countWords, removeComments, scanLatexSource } from "./source.js";
export { readDelimited, findSpaceEnd } from "./sourceCommands.js";
export {
  readLatexProjectSources, readLatexProjectTexts, deriveMathJaxMacros, resolveIncludePath, findUndefinedReferences,
} from "./sourceProject.js";
export type {
  MissingSource, ProjectSourceFile, ProjectSourceReader, ProjectSources, MathJaxMacros, UndefinedReference,
} from "./sourceProject.js";
export { createBiberAssignment, type BiberCommand, BIBER_FLAG, parseBiberArgs, BIBER_ASSET_FILES, parseBiberReleaseManifest, type BiberWasmAssets, extractBiberErrors, parseControlFile } from "./biber/index.js";
export * from "./toolchain.js";
