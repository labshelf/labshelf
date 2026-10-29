// Exports the writing view: the project list, its commands and the store behind them.
export {
  findOwningProject, registerBuildRootCommands, registerBuildRootStatusBar,
  registerExportCommands, registerInstallCommand, registerProjectCommands, registerProjectItemCommands, ProjectReadingLists, registerReadingListCommands,
  type ConvertProject, type ReadyProject,
} from "./projects/index.js";
export { registerBibliographyCheck } from "./bibliographyCheck.js";
export { registerEditorActions, registerInsertActions, registerPaperLinks, ProjectBacklinks } from "./citations/index.js";
export { registerNoteLinks } from "./noteLinks.js";
export { readActiveProject } from "./build/index.js";
export { WritingProjects } from "./projects/index.js";
export type { WritingHost, WritingSession } from "./projects/index.js";
export type { BuildRootOf, PlatformWriting, RegisterPlatformWriting } from "./projects/index.js";
