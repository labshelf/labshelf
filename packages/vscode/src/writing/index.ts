// Exports the writing view: the project list, its commands and the store behind them.
export { registerMainCommands } from "./mainCommands.js";
export { registerMainStatusBar } from "./mainStatusBar.js";
export { registerAddExistingFolder, registerProjectCommands } from "./projectCommands.js";
export { duplicateProject, registerProjectItemCommands } from "./projectItemCommands.js";
export { mainPathIn, owningProject } from "./mainDocument.js";
export { WritingProjects } from "./session/index.js";
export type { WritingHost, WritingSession } from "./session/index.js";
export { ProjectReadingLists, registerReadingListCommands } from "./readingList/index.js";
export { ProjectBacklinkIndex } from "./backlinks/index.js";
