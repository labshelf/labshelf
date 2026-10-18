// Exports the runtime-neutral writes of projects: creating, adding, deleting and changing their settings.
export { addExistingFolder } from "./addExistingFolder.js";
export { createProjectFromTemplate } from "./createProjectFromTemplate.js";
export { deleteProjectForever } from "./deleteProjectForever.js";
export type { ProjectCatalogContext, ProjectFolderRegistry } from "./projectCatalogContext.js";
export { claimProjectId } from "./claimProjectId.js";
export { updateProjectSettings } from "./updateProjectSettings.js";
