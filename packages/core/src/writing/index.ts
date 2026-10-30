/** Exports the writing domain's runtime-neutral API: projects written in LaTeX or Typst, their citations and backlinks, figures and values, the pre-submission check, the Checklist, versions and their comparison, the project history, SyncTeX and the citations behind a compiled PDF, the problems and stale sources of a build preview, and the project data port over them, and links from manuscript equations back to their notes. */
export * from "./citations/index.js";
export * from "./project/index.js";
export { parseSynctex, readSynctexFile } from "./synctexFile.js";
export type { SourcePosition, SynctexMap, SynctexRead } from "./synctexFile.js";
export { findPagePoint, findSourcePosition } from "./synctexLookup.js";
export * from "./figures/index.js";
export * from "./checks/index.js";
export * from "./noteLinks/index.js";
export * from "./history/index.js";
export { createProjectContent, createProjectFileRow, listVisibleEntries, listProjectFileTree } from "./projectService.js";
export type {
  ProjectContentDeps, ProjectContentPort, ProjectDeviceDirs, DirEntry, ProjectFileContext, ProjectFileKind, ProjectFileRow,
} from "./projectService.js";
export { MATH_SYMBOLS, deriveSymbolSource } from "./symbolCatalog.js";
export type { MathSymbol, SymbolKind } from "./symbolCatalog.js";
export {
  MAX_TABLE_SIDE, parseTableSize, createTableSnippet, createImageSnippet, deriveSelectionWrap,
  IMAGE_EXTENSIONS, IMAGE_FOLDER, findFreeImageName, deriveImageBaseFolder,
} from "./snippets.js";
export type { EmptyTableSpec, WrapResult, WrapKind } from "./snippets.js";
export * from "./search/index.js";
export * from "./allProjects/index.js";
export * from "./build/index.js";
export * from "./conflict/index.js";
export { createTextMerge, deriveLineSimilarity } from "./textMerge.js";
export * from "./outline/index.js";
// collab already exports a TextChange of another shape, so the source editor's goes out as SourceTextChange.
export { createSourceAuthority } from "./authority.js";
export type { SourceAuthority, SourceUpdate, TextChange as SourceTextChange } from "./authority.js";
export { SOURCE_EDITOR_ACTIONS, parseSourceEditorInbound, parseSourceEditorOutbound } from "./protocol.js";
export type { SourceEditorAction, SourceEditorInbound, SourceEditorOutbound } from "./protocol.js";
export { StaleSources, type SourceEvents, type StaleSourcesState } from "./staleSources.js";
export { ProjectSynctex, type SynctexFinder, type SynctexLogHost } from "./projectSynctex.js";
export { BuildRootBuilds, type BuildRootBuildState, type FinishedBuild } from "./buildRootBuilds.js";
export { createBuildRootsMessage, type BuildRootsMessageInput } from "./buildRootsMessage.js";
export { CheckCounts } from "./checkCounts.js";
export { deriveCheckLimitsPatch, countBuildRootWords, type PreviewLimits } from "./checkLimits.js";
export { createProjectSources, type SourcesProject } from "./projectSources.js";
