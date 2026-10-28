// Runs the neutral project reads and writes over the local disk and the device's folder registry.
import { NodeLibraryFileSystem, createDeviceLocalLayout } from "../../../library/node/index.js";
import { nodePathOps } from "../../../path/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import type { ProjectEntry } from "../projectEntry.js";
import type { ProjectCatalogContext } from "../projectMutations.js";
import { loadProjectRegistry, createProjectFolderRegistry } from "../projectRegistry.js";
import { listProjects, type ProjectReadContext } from "../projectReads.js";

/** The file access the neutral file listings need, for Node callers that have no logger. */
export const nodeFileReads: Pick<ProjectReadContext, "fs" | "paths"> = { fs: new NodeLibraryFileSystem(), paths: nodePathOps };

export function createNodeProjectReadCompositionRoot(logger: ILogger): ProjectReadContext {
  return { fs: new NodeLibraryFileSystem(), paths: nodePathOps, logger };
}

const registryPathOf = (libraryRoot: string): string => createDeviceLocalLayout(libraryRoot).projectRegistryPath;

export function createNodeProjectCatalogCompositionRoot(logger: ILogger): ProjectCatalogContext {
  const reads = createNodeProjectReadCompositionRoot(logger);
  return { ...reads, registry: createProjectFolderRegistry(reads, registryPathOf) };
}

/** The library's own projects, then the registered folders in the order they were added. */
export async function listLibraryProjects(libraryRoot: string, logger: ILogger): Promise<ProjectEntry[]> {
  const reads = createNodeProjectReadCompositionRoot(logger);
  const registry = await loadProjectRegistry({ ...reads, registryPath: registryPathOf(libraryRoot) });
  return listProjects(reads, libraryRoot, registry.folders);
}
