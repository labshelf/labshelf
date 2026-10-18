// Runs the neutral project reads and writes over the local disk and the device's folder registry.
import * as path from "node:path";

import { NodeLibraryFileSystem } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import { listProjects, type ProjectReadContext } from "../folder/index.js";
import type { ProjectEntry } from "../projectEntry.js";
import type { ProjectCatalogContext, ProjectFolderRegistry } from "../writes/index.js";
import { loadProjectRegistry, registerProjectFolder, unregisterProjectFolder } from "./projectRegistryFile.js";

/** The file access the neutral file listings need, for Node callers that have no logger. */
export const nodeFileReads: Pick<ProjectReadContext, "fs" | "paths"> = { fs: new NodeLibraryFileSystem(), paths: path };

export function nodeProjectReadContext(logger: ILogger): ProjectReadContext {
  return { fs: new NodeLibraryFileSystem(), paths: path, logger };
}

function nodeProjectFolderRegistry(logger: ILogger): ProjectFolderRegistry {
  return {
    folders: async (libraryRoot) => (await loadProjectRegistry(libraryRoot, logger)).folders,
    register: (libraryRoot, folder) => registerProjectFolder(libraryRoot, folder, logger),
    unregister: (libraryRoot, folder) => unregisterProjectFolder(libraryRoot, folder, logger),
  };
}

export function nodeProjectCatalogContext(logger: ILogger): ProjectCatalogContext {
  return { ...nodeProjectReadContext(logger), registry: nodeProjectFolderRegistry(logger) };
}

/** The library's own projects, then the registered folders in the order they were added. */
export async function listProjectsOnDisk(libraryRoot: string, logger: ILogger): Promise<ProjectEntry[]> {
  const registry = await loadProjectRegistry(libraryRoot, logger);
  return listProjects(nodeProjectReadContext(logger), libraryRoot, registry.folders);
}
