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
export * from "./catalog/index.js";
export * from "./log/index.js";
export type {
  LatexInclude, LabelFact, LatexPosition, LatexRange, LatexSourceFacts, MacroFact, ReferenceFact, SectionFact,
} from "./source.js";
export { countWords, removeComments, scanLatexSource } from "./source.js";
export { readDelimited, findSpaceEnd } from "./sourceCommands.js";
export {
  readLatexProjectSources, deriveMathJaxMacros, resolveIncludePath, findUndefinedReferences,
} from "./sourceProject.js";
export type {
  MissingSource, ProjectSourceFile, ProjectSourceReader, ProjectSources, MathJaxMacros, UndefinedReference,
} from "./sourceProject.js";
export { createBiberAssignment, type BiberCommand, BIBER_FLAG, parseBiberArgs, BIBER_ASSET_FILES, parseBiberReleaseManifest, type BiberWasmAssets, extractBiberErrors, parseControlFile } from "./biber.js";
export * from "./toolchain.js";
