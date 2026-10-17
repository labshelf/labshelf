/** Reads and writes the library's device-local registry of project folders, projects.json in the state directory. */
import * as path from "node:path";

import { deviceLocalLayout, readOptionalFile, writeFileAtomic } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import {
  parseProjectRegistry, serializeProjectRegistry, withFolder, withoutFolder, type ProjectRegistry,
} from "../deviceLocal/index.js";

const MODULE = "projectRegistry";

function registryPath(libraryRoot: string): string {
  return deviceLocalLayout(libraryRoot).projectRegistryPath;
}

/** @returns the registered folders; an unreadable or corrupt registry reads as empty and is logged */
export async function loadProjectRegistry(libraryRoot: string, logger: ILogger): Promise<ProjectRegistry> {
  const file = registryPath(libraryRoot);
  let text: string | undefined;
  try {
    text = await readOptionalFile(file);
  } catch (error) {
    await logger.error(MODULE, error, { file, action: "read" });
    return { folders: [] };
  }
  if (text === undefined) { return { folders: [] }; }
  const registry = parseProjectRegistry(text);
  if (registry === undefined) {
    await logger.log("WARN", MODULE, "projects.json is not a JSON object; external projects are hidden", { file });
    return { folders: [] };
  }
  return registry;
}

// A corrupt registry is never overwritten: the user's list would be lost for good, so the edit fails instead.
async function updateRegistry(
  libraryRoot: string,
  edit: (registry: ProjectRegistry) => ProjectRegistry,
  logger: ILogger,
): Promise<void> {
  const file = registryPath(libraryRoot);
  const text = await readOptionalFile(file);
  const current = text === undefined ? { folders: [] } : parseProjectRegistry(text);
  if (current === undefined) { throw new Error(`${file} is corrupt; fix or delete it before changing projects`); }
  const next = edit(current);
  const nextText = serializeProjectRegistry(next);
  if (nextText === text) { return; }
  await writeFileAtomic(file, nextText);
  await logger.log("INFO", MODULE, "project registry updated", { file, folders: next.folders.length });
}

export async function registerProjectFolder(libraryRoot: string, folder: string, logger: ILogger): Promise<void> {
  await updateRegistry(libraryRoot, (registry) => withFolder(registry, path.resolve(folder)), logger);
}

/** Forgets a folder; its files stay where they are. */
export async function unregisterProjectFolder(libraryRoot: string, folder: string, logger: ILogger): Promise<void> {
  await updateRegistry(libraryRoot, (registry) => withoutFolder(registry, path.resolve(folder)), logger);
}
