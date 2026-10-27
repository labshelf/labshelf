/** Reads and edits the device-local list of project folders outside the library, keeping keys other versions wrote. */
// CONTRACT: documents/contracts/library-format.md#device-local-files
import { parseJsonObject } from "../../../json/index.js";

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
