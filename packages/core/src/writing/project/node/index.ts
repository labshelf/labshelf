/** Exports the Node side of writing projects: project folders, their build folders, the library's project catalog and the folder registry. */
export { addExistingFolder, createProjectFromTemplate, listProjects } from "./projectCatalog.js";
export { deleteProjectForever } from "./deleteProjectForever.js";
export { lastModified } from "./lastModified.js";
export { listProjectFiles } from "./projectFiles.js";
export { projectBuildDir } from "./projectBuildDir.js";
export { readProject, rootFileNames, updateProjectSettings } from "./projectFolder.js";
export { loadProjectRegistry, registerProjectFolder, unregisterProjectFolder } from "./projectRegistryFile.js";
