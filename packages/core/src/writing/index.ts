/** Exports the writing domain's runtime-neutral API: projects written in LaTeX or Typst, their citations and backlinks, figures and values, the pre-submission check, the Checklist, versions and their comparison, the project history, SyncTeX and the citations behind a compiled PDF, and the project data port over them. */
export * from "./citations/index.js";
export * from "./project/index.js";
export * from "./synctex/index.js";
export * from "./figures/index.js";
export * from "./checks/index.js";
export * from "./history/index.js";
export { createProjectContent, createProjectFileRow, listVisibleEntries } from "./projectService.js";
export type {
  ProjectContentDeps, ProjectContentPort, ProjectDeviceDirs, DirEntry, ProjectFileContext, ProjectFileKind, ProjectFileRow,
} from "./projectService.js";
export * from "./snippet/index.js";
export * from "./search/index.js";
export * from "./allProjects/index.js";
export * from "./build/index.js";
export * from "./conflict/index.js";
export { createTextMerge, deriveLineSimilarity } from "./text/index.js";
export * from "./outline/index.js";
