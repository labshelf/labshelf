/** Implements the project data port with the Node functions that read and write project folders. */
import type { ILogger } from "../../../ports/index.js";
import { projectBacklinks } from "../../backlinks/node/index.js";
import { updateProjectBibliography } from "../../citations/node/index.js";
import { readFigureStates } from "../../figures/node/index.js";
import {
  addExistingFolder, createProjectFromTemplate, latestProjectEdit, listProjects, projectBuildDir, rootFileNames,
  unregisterProjectFolder, updateProjectSettings, writeProjectCursor,
} from "../../project/node/index.js";
import { readSynctexFile } from "../../synctex/node/index.js";
import { readProjectValues } from "../../values/node/index.js";
import { listVersions, markVersion } from "../../versions/node/index.js";
import type { ProjectDataPort } from "../projectDataPort.js";

export function nodeProjectData(logger: ILogger): ProjectDataPort {
  return {
    listProjects: (libraryRoot) => listProjects(libraryRoot, logger),
    createProjectFromTemplate: (libraryRoot, request) => createProjectFromTemplate(libraryRoot, request, logger),
    addExistingFolder: (libraryRoot, request) => addExistingFolder(libraryRoot, request, logger),
    unregisterProjectFolder: (libraryRoot, folder) => unregisterProjectFolder(libraryRoot, folder, logger),
    rootFileNames,
    updateProjectSettings: (folder, patch) => updateProjectSettings(folder, patch, logger),
    writeProjectCursor,
    latestProjectEdit: (entries) => latestProjectEdit(entries, logger),
    listVersions: (folder) => listVersions(folder, logger),
    markVersion: (request) => markVersion(request, logger),
    readProjectValues: (project) => readProjectValues(project, logger),
    readFigureStates,
    updateProjectBibliography: (project, papers, open) => updateProjectBibliography(project, papers, logger, open),
    projectBacklinks: (projects, open) => projectBacklinks(projects, logger, open),
    projectBuildDir: (projectId) => projectBuildDir(projectId),
    readSynctexFile,
  };
}
