/** Reads and edits the device-local list of project folders outside the library, keeping keys other versions wrote, and reads and writes it as projects.json in the state directory. */
// CONTRACT: documents/contracts/library-format.md#device-local-files
import { parseJsonObject } from "../../json/index.js";
import type { PathOps } from "../../path/index.js";
import type { ILogger, LibraryFileSystem } from "../../ports/index.js";
import type { ProjectFolderRegistry } from "./projectMutations.js";

const MODULE = "projectRegistry";

export interface ProjectRegistry {
  /** Absolute paths, in the order they were added. */
  folders: string[];
  [key: string]: unknown;
}

/**
 * Entries that are not text are dropped.
 * @returns undefined when the text is not a JSON object, so the caller can refuse to overwrite it
 */
export function parseProjectRegistry(text: string): ProjectRegistry | undefined {
  const record = parseJsonObject(text);
  if (!record) { return undefined; }
  const folders = Array.isArray(record["folders"])
    ? record["folders"].filter((folder): folder is string => typeof folder === "string")
    : [];
  return { ...record, folders };
}

export function serializeProjectRegistry(registry: ProjectRegistry): string {
  return `${JSON.stringify(registry, null, 2)}\n`;
}

/** Adds a folder once; the same path added twice stays a single entry. */
export function withFolder(registry: ProjectRegistry, folder: string): ProjectRegistry {
  return registry.folders.includes(folder) ? registry : { ...registry, folders: [...registry.folders, folder] };
}

export function withProjectFolderRemoved(registry: ProjectRegistry, folder: string): ProjectRegistry {
  return { ...registry, folders: registry.folders.filter((entry) => entry !== folder) };
}

// --- The registry file ---

export interface ProjectRegistryFileContext {
  fs: LibraryFileSystem;
  paths: PathOps;
  logger: ILogger;
  registryPath: string;
}

// PLATFORM: adapters report a missing file differently (ENOENT, a bridge `createNotFoundAnswer`, a plain Error), so absence is asked of `exists`.
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
export async function removeProjectFolder(ctx: ProjectRegistryFileContext, folder: string): Promise<void> {
  await updateRegistry(ctx, (registry) => withProjectFolderRemoved(registry, ctx.paths.resolve(folder)));
}

/** The registry of each library root lives at `registryPathOf(root)`, read at every call. */
export function createProjectFolderRegistry(
  ctx: Omit<ProjectRegistryFileContext, "registryPath">, registryPathOf: (libraryRoot: string) => string,
): ProjectFolderRegistry {
  const at = (libraryRoot: string): ProjectRegistryFileContext => ({ ...ctx, registryPath: registryPathOf(libraryRoot) });
  return {
    folders: async (libraryRoot) => (await loadProjectRegistry(at(libraryRoot))).folders,
    register: (libraryRoot, folder) => registerProjectFolder(at(libraryRoot), folder),
    unregister: (libraryRoot, folder) => removeProjectFolder(at(libraryRoot), folder),
  };
}
