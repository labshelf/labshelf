// Runs the neutral project reads and writes over the local disk and the device's folder registry.
import * as path from "node:path";

import { NodeLibraryFileSystem, createDeviceLocalLayout } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import { listProjects, type ProjectReadContext } from "../folder/index.js";
import type { ProjectEntry } from "../projectEntry.js";
import { loadProjectRegistry, projectFolderRegistry } from "../deviceLocal/index.js";
import type { ProjectCatalogContext } from "../mutation/index.js";

/** The file access the neutral file listings need, for Node callers that have no logger. */
export const nodeFileReads: Pick<ProjectReadContext, "fs" | "paths"> = { fs: new NodeLibraryFileSystem(), paths: path };

export function nodeProjectReadContext(logger: ILogger): ProjectReadContext {
  return { fs: new NodeLibraryFileSystem(), paths: path, logger };
}

const registryPathOf = (libraryRoot: string): string => createDeviceLocalLayout(libraryRoot).projectRegistryPath;

export function nodeProjectCatalogContext(logger: ILogger): ProjectCatalogContext {
  const reads = nodeProjectReadContext(logger);
  return { ...reads, registry: projectFolderRegistry(reads, registryPathOf) };
}

/** The library's own projects, then the registered folders in the order they were added. */
export async function listProjectsOnDisk(libraryRoot: string, logger: ILogger): Promise<ProjectEntry[]> {
  const reads = nodeProjectReadContext(logger);
  const registry = await loadProjectRegistry({ ...reads, registryPath: registryPathOf(libraryRoot) });
  return listProjects(reads, libraryRoot, registry.folders);
}
