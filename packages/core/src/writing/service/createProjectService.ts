// Implements the project data port with the neutral project functions over an injected library file system.
import type { PathOps } from "../../path/index.js";
import type { ILogger, LibraryFileSystem } from "../../ports/index.js";
import { deriveProjectBacklinks } from "../citations/index.js";
import { updateProjectBibliography } from "../citations/index.js";
import { readFigureBuildStates } from "../figures/index.js";
import {
  addExistingFolder, createProjectFromTemplate, removeProjectFolderForever, readLastModified, listProjectFiles, listProjects,
  createProjectFolderRegistry, listBuildRootFileNames, updateProjectSettings, type ProjectCatalogContext,
} from "../project/index.js";
import { readSynctexFile } from "../synctex/index.js";
import { readProjectValues } from "../projectValue/index.js";
import { listVersions, addProjectVersion } from "../versions/index.js";
import type { ProjectContentPort } from "./projectServicePort.js";
import type { ProjectDeviceDirs } from "./projectDeviceDirs.js";

export interface ProjectContentDeps {
  fs: LibraryFileSystem;
  path: PathOps;
  logger: ILogger;
  /** Read at every call: a host whose library root changes passes getters. */
  deviceDirs: ProjectDeviceDirs;
}

// A device without a registry path lists only the library's own projects and refuses to remember outside folders.
function registryOf(reads: Omit<ProjectCatalogContext, "registry">, deviceDirs: ProjectDeviceDirs): ProjectCatalogContext["registry"] {
  const filed = createProjectFolderRegistry(reads, () => deviceDirs.projectRegistryPath ?? "");
  const refuse = (): never => { throw new Error("This device keeps no project folder registry, so only projects inside the library can be used"); };
  const keeps = (): boolean => deviceDirs.projectRegistryPath !== undefined;
  return {
    folders: (root) => (keeps() ? filed.folders(root) : Promise.resolve([])),
    register: (root, folder) => (keeps() ? filed.register(root, folder) : refuse()),
    unregister: (root, folder) => (keeps() ? filed.unregister(root, folder) : Promise.resolve()),
  };
}

export function createProjectContent({ fs, path, logger, deviceDirs }: ProjectContentDeps): ProjectContentPort {
  const reads = { fs, paths: path, logger };
  // deviceDirs already names the current library's registry, so the root argument is not needed to locate it.
  const registry = registryOf(reads, deviceDirs);
  const catalog: ProjectCatalogContext = { ...reads, registry };
  return {
    listProjects: async (libraryRoot) => listProjects(reads, libraryRoot, await registry.folders(libraryRoot)),
    createProjectFromTemplate: (libraryRoot, request) => createProjectFromTemplate(catalog, libraryRoot, request),
    addExistingFolder: (libraryRoot, request) => addExistingFolder(catalog, libraryRoot, request),
    unregisterProjectFolder: (libraryRoot, folder) => registry.unregister(libraryRoot, folder),
    deleteProjectForever: (libraryRoot, folder) => removeProjectFolderForever(catalog, libraryRoot, folder),
    lastModified: (folder) => readLastModified(reads, folder),
    rootFileNames: (folder) => listBuildRootFileNames(reads, folder),
    listProjectFiles: (folder) => listProjectFiles(reads, folder),
    updateProjectSettings: (folder, patch) => updateProjectSettings(reads, folder, patch),
    listVersions: (folder) => listVersions(reads, folder),
    markVersion: (request) => addProjectVersion(reads, request),
    readProjectValues: (project) => readProjectValues(project, reads),
    readFigureStates: (folder, figures) => readFigureBuildStates(reads, folder, figures),
    updateProjectBibliography: (project, papers, open) => updateProjectBibliography(reads, project, papers, open),
    projectBacklinks: (projects, open) => deriveProjectBacklinks(reads, projects, open),
    projectBuildDir: (projectId) => path.join(deviceDirs.buildCacheDir, projectId),
    readSynctexFile: (outDir, base, cwd) => readSynctexFile(reads, outDir, base, cwd),
  };
}
