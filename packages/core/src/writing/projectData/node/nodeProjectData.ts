// Implements the project data port with the neutral project functions over the local disk.
import type { ILogger } from "../../../ports/index.js";
import { projectBacklinks } from "../../backlinks/index.js";
import { updateProjectBibliography } from "../../citations/index.js";
import { readFigureStates } from "../../figures/index.js";
import {
  addExistingFolder, createProjectFromTemplate, deleteProjectForever, lastModified, listProjectFiles, rootFileNames, updateProjectSettings,
} from "../../project/index.js";
import {
  listProjectsOnDisk, nodeProjectCatalogContext, projectBuildDir, unregisterProjectFolder,
} from "../../project/node/index.js";
import { readSynctexFile } from "../../synctex/index.js";
import { readProjectValues } from "../../values/index.js";
import { listVersions, markVersion } from "../../versions/index.js";
import type { ProjectDataPort } from "../projectDataPort.js";

export function nodeProjectData(logger: ILogger): ProjectDataPort {
  const reads = nodeProjectCatalogContext(logger);
  return {
    listProjects: (libraryRoot) => listProjectsOnDisk(libraryRoot, logger),
    createProjectFromTemplate: (libraryRoot, request) => createProjectFromTemplate(reads, libraryRoot, request),
    addExistingFolder: (libraryRoot, request) => addExistingFolder(reads, libraryRoot, request),
    unregisterProjectFolder: (libraryRoot, folder) => unregisterProjectFolder(libraryRoot, folder, logger),
    deleteProjectForever: (libraryRoot, folder) => deleteProjectForever(reads, libraryRoot, folder),
    lastModified: (folder) => lastModified(reads, folder),
    rootFileNames: (folder) => rootFileNames(reads, folder),
    listProjectFiles: (folder) => listProjectFiles(reads, folder),
    updateProjectSettings: (folder, patch) => updateProjectSettings(reads, folder, patch),
    listVersions: (folder) => listVersions(reads, folder),
    markVersion: (request) => markVersion(reads, request),
    readProjectValues: (project) => readProjectValues(project, reads),
    readFigureStates: (folder, figures) => readFigureStates(reads, folder, figures),
    updateProjectBibliography: (project, papers, open) => updateProjectBibliography(reads, project, papers, open),
    projectBacklinks: (projects, open) => projectBacklinks(reads, projects, open),
    projectBuildDir: (projectId) => projectBuildDir(projectId),
    readSynctexFile: (outDir, base, cwd) => readSynctexFile(reads, outDir, base, cwd),
  };
}
