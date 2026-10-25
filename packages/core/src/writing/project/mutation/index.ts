// Exports the runtime-neutral writes of projects: creating, adding, deleting and changing their settings.
export { addExistingFolder } from "./addExistingFolder.js";
export { createProjectFromTemplate } from "./createProjectFromTemplate.js";
export { removeProjectFolderForever } from "./removeProjectForever.js";
export type { ProjectCatalogContext, ProjectFolderRegistry } from "./projectCatalogContext.js";
export { claimProjectId } from "./claimProjectId.js";
export { updateProjectSettings } from "./updateProjectSettings.js";
