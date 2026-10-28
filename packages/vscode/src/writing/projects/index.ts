// Exports the writing projects: the window session and its store, the project views and commands, the Figures view, the project values and reading list, the sidebar source and mirror, the All projects tab and the platform port types.
export { WritingProjects, ProjectSession, OPEN_PROJECT_COMMAND, registerProjectSession, registerProjectWriteEvents } from "./session.js";
export type { WritingHost, WritingSession } from "./session.js";
export { registerProjectViews } from "./tree.js";
export { SidebarProjectsSource } from "./sidebar.js";
export { ProjectTreeMirror } from "./mirror.js";
export { CHECK_COMMAND } from "./checklist.js";
export { createSignalsReader } from "./checklistSignals.js";
export { registerAllProjects } from "./allProjects.js";
export { deriveNestedSymbols } from "./outline.js";
export type { BuildRootOf, PlatformWriting, ProjectHistoryRecorder, RegisterPlatformWriting } from "./platformPort.js";
export { registerExportCommands, registerInstallCommand, type ConvertProject, type InstallServices } from "./exportInstall.js";
export {
  deriveBuildRootPath, findOwningProject, registerAddExistingFolder, registerBuildRootCommands,
  registerBuildRootStatusBar, registerProjectCommands, registerProjectItemCommands,
  type ProjectFinder, type ReadyProject,
} from "./commands.js";
export type { FigureNode } from "./projectFigures.js";
export { watchFigureFiles, ProjectFigures } from "./projectFigures.js";
export { ProjectFiguresView } from "./figuresView.js";
export { registerProjectValues } from "./projectValues.js";
export { ProjectReadingLists, registerReadingListCommands } from "./readingList.js";
