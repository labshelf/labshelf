// Exports the writing view: the project list, its commands and the store behind them.
export { registerMainCommands } from "./buildRootCommands.js";
export { registerMainStatusBar } from "./buildRootStatusBar.js";
export { registerAddExistingFolder, registerProjectCommands } from "./projectCommands.js";
export { duplicateProject, registerProjectItemCommands } from "./projectItemCommands.js";
export { mainPathIn, owningProject } from "./buildRootDocument.js";
export type { ReadyProject } from "./buildRootDocument.js";
export { WritingProjects } from "./session/index.js";
export type { WritingHost, WritingSession } from "./session/index.js";
export { ProjectReadingLists, registerReadingListCommands } from "./readingList/index.js";
export { ProjectBacklinkIndex } from "./citations/index.js";
export { registerEditorActions } from "./registerEditorActions.js";
export { registerInsertActions } from "./registerInsertActions.js";
export { projectZipEntries } from "./exportBundle.js";
export { registerExportCommands } from "./registerExportCommands.js";
export type { ConvertDocument } from "./exportProject.js";
export { registerInstallCommand } from "./installCommand.js";
export type { InstallServices } from "./installCommand.js";
export type { BuildRootOf, PlatformWriting, ProjectHistoryRecorder, RegisterPlatformWriting } from "./platformWritingPort.js";
