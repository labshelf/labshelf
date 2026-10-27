// Exports the writing view: the project list, its commands and the store behind them.
export {
  copyProjectEntry, findOwningProject, registerAddExistingFolder, registerBibliographyCheck, registerBuildRootCommands, registerBuildRootStatusBar,
  registerEditorActions, registerExportCommands, registerInsertActions, registerInstallCommand, registerPaperLinks, registerProjectCommands,
  registerProjectItemCommands,
  type ConvertProject, type InstallServices, type ReadyProject,
} from "./commands/index.js";
export { readActiveProject } from "./build/index.js";
export { WritingProjects } from "./projects/index.js";
export type { WritingHost, WritingSession } from "./projects/index.js";
export { ProjectBacklinks, ProjectReadingLists, registerReadingListCommands } from "./citations/index.js";
export type { BuildRootOf, PlatformWriting, RegisterPlatformWriting } from "./projects/index.js";
