// Reads and writes the library's device-local registry of project folders, projects.json in the state directory.
import type { PathOps } from "../../../library/mutations/index.js";
import type { ILogger, LibraryFileSystem } from "../../../ports/index.js";
import type { ProjectFolderRegistry } from "../writes/index.js";
import {
  parseProjectRegistry, serializeProjectRegistry, withFolder, withoutFolder, type ProjectRegistry,
} from "./projectRegistry.js";

const MODULE = "projectRegistry";

export interface ProjectRegistryFileContext {
  fs: LibraryFileSystem;
  paths: PathOps;
  logger: ILogger;
  registryPath: string;
}

// PLATFORM: adapters report a missing file differently (ENOENT, a bridge `notFound`, a plain Error), so absence is asked of `exists`.
async function readRegistryText(fs: LibraryFileSystem, file: string): Promise<string | undefined> {
  if (!(await fs.exists(file))) { return undefined; }
  return fs.readText(file);
}

/** @returns the registered folders; an unreadable or corrupt registry reads as empty and is logged */
export async function loadProjectRegistry(ctx: ProjectRegistryFileContext): Promise<ProjectRegistry> {
  const file = ctx.registryPath;
  let text: string | undefined;
  try {
    text = await readRegistryText(ctx.fs, file);
  } catch (error) {
    await ctx.logger.error(MODULE, error, { file, action: "read" });
    return { folders: [] };
  }
  if (text === undefined) { return { folders: [] }; }
  const registry = parseProjectRegistry(text);
  if (registry === undefined) {
    await ctx.logger.log("WARN", MODULE, "projects.json is not a JSON object; external projects are hidden", { file });
    return { folders: [] };
  }
  return registry;
}

// A corrupt registry is never overwritten: the user's list would be lost for good, so the edit fails instead.
async function updateRegistry(ctx: ProjectRegistryFileContext, edit: (registry: ProjectRegistry) => ProjectRegistry): Promise<void> {
  const file = ctx.registryPath;
  const text = await readRegistryText(ctx.fs, file);
  const current = text === undefined ? { folders: [] } : parseProjectRegistry(text);
  if (current === undefined) { throw new Error(`${file} is corrupt; fix or delete it before changing projects`); }
  const next = edit(current);
  const nextText = serializeProjectRegistry(next);
  if (nextText === text) { return; }
  await ctx.fs.writeText(file, nextText);
  await ctx.logger.log("INFO", MODULE, "project registry updated", { file, folders: next.folders.length });
}

export async function registerProjectFolder(ctx: ProjectRegistryFileContext, folder: string): Promise<void> {
  await updateRegistry(ctx, (registry) => withFolder(registry, ctx.paths.resolve(folder)));
}

/** Forgets a folder; its files stay where they are. */
export async function unregisterProjectFolder(ctx: ProjectRegistryFileContext, folder: string): Promise<void> {
  await updateRegistry(ctx, (registry) => withoutFolder(registry, ctx.paths.resolve(folder)));
}

/** The registry of each library root lives at `registryPathOf(root)`, read at every call. */
export function projectFolderRegistry(
  ctx: Omit<ProjectRegistryFileContext, "registryPath">, registryPathOf: (libraryRoot: string) => string,
): ProjectFolderRegistry {
  const at = (libraryRoot: string): ProjectRegistryFileContext => ({ ...ctx, registryPath: registryPathOf(libraryRoot) });
  return {
    folders: async (libraryRoot) => (await loadProjectRegistry(at(libraryRoot))).folders,
    register: (libraryRoot, folder) => registerProjectFolder(at(libraryRoot), folder),
    unregister: (libraryRoot, folder) => unregisterProjectFolder(at(libraryRoot), folder),
  };
}
