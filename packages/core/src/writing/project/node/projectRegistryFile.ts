/** Reads and writes the library's device-local registry of project folders, .research/projects.json. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { joinWith, libraryLayout } from "../../../library/index.js";
import { writeFileAtomic } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import {
  parseProjectRegistry, serializeProjectRegistry, withFolder, withoutFolder, type ProjectRegistry,
} from "../projectRegistry.js";

const MODULE = "projectRegistry";

function registryPath(libraryRoot: string): string {
  return libraryLayout(libraryRoot, joinWith(path.sep as "/" | "\\")).projectRegistryPath();
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return undefined; }
    throw error;
  }
}

/** @returns the registered folders; an unreadable or corrupt registry reads as empty and is logged */
export async function loadProjectRegistry(libraryRoot: string, logger: ILogger): Promise<ProjectRegistry> {
  const file = registryPath(libraryRoot);
  let text: string | undefined;
  try {
    text = await readText(file);
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
  const text = await readText(file);
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
