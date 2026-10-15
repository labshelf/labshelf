/** Exports the Node side of writing projects: project folders, their build folders, the library's project catalog and the folder registry. */
export { addExistingFolder, createProject, listProjects } from "./projectCatalog.js";
export { projectBuildDir } from "./projectBuildDir.js";
export { readProject, rootFileNames, updateProjectSettings } from "./projectFolder.js";
export type { ProjectEntry, ProjectLocation } from "./projectFolder.js";
export { loadProjectRegistry, registerProjectFolder, unregisterProjectFolder } from "./projectRegistryFile.js";
