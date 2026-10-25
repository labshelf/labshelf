/** Exports the port through which a writing host reads and writes project data, its implementation and the Files tree rows of a project. */
export { createProjectData, type ProjectDataDeps } from "./createProjectService.js";
export type { ProjectDataPort } from "./projectServicePort.js";
export type { ProjectDeviceDirs } from "./projectDeviceDirs.js";
export { projectFileRow, visibleEntries } from "./projectFileNodes.js";
export type { DirectoryEntry, ProjectFileContext, ProjectFileKind, ProjectFileRow } from "./projectFileNodes.js";
