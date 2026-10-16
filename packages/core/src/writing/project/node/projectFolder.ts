/** Reads one project folder into a project entry and rewrites its labshelf.yaml settings. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { readOptionalFile, writeFileAtomic } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import { detectMainFile } from "../mainDetection.js";
import {
  PROJECT_FILE, parseProjectFile, updateProjectFile, type ProjectSettings, type ProjectSettingsPatch,
} from "../projectFile.js";

/** "library": under <library>/projects/; "external": a registered folder anywhere else. */
export type ProjectLocation = "library" | "external";

export type ProjectEntry =
  | {
    kind: "ready";
    folder: string;
    location: ProjectLocation;
    settings: ProjectSettings;
    /** The main file from labshelf.yaml, else the detected one; undefined when neither exists. */
    main: string | undefined;
  }
  | { kind: "broken"; folder: string; location: ProjectLocation; reason: string };

/** Names of the files at the folder's root; sources in subfolders are not main candidates. */
export async function rootFileNames(folder: string): Promise<string[]> {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

/** A project that cannot be read is returned as broken with a reason the UI can show, and logged. */
export async function readProject(folder: string, location: ProjectLocation, logger: ILogger): Promise<ProjectEntry> {
  const broken = async (reason: string): Promise<ProjectEntry> => {
    await logger.log("WARN", "project", "project cannot be read", { folder, reason });
    return { kind: "broken", folder, location, reason };
  };
  try {
    const text = await readOptionalFile(path.join(folder, PROJECT_FILE));
    if (text === undefined) {
      const exists = await fs.stat(folder).then(() => true, () => false);
      return broken(exists ? `${PROJECT_FILE} is missing` : "folder not found");
    }
    const parsed = parseProjectFile(text);
    if (!parsed.ok) { return broken(`${PROJECT_FILE}: ${parsed.reason}`); }
    const main = parsed.settings.main
      ?? await detectMainFile(parsed.settings.format, await rootFileNames(folder), (name) => readOptionalFile(path.join(folder, name)));
    return { kind: "ready", folder, location, settings: parsed.settings, main };
  } catch (error) {
    await logger.error("project", error, { folder, action: "read" });
    return { kind: "broken", folder, location, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Rewrites the given settings in place; a labshelf.yaml that does not parse is left untouched and the call fails. */
export async function updateProjectSettings(folder: string, patch: ProjectSettingsPatch, logger: ILogger): Promise<void> {
  const file = path.join(folder, PROJECT_FILE);
  const text = await fs.readFile(file, "utf8");
  const parsed = parseProjectFile(text);
  if (!parsed.ok) { throw new Error(`${file}: ${parsed.reason}`); }
  await writeFileAtomic(file, updateProjectFile(text, patch));
  await logger.log("INFO", "project", "project settings updated", { folder, keys: Object.keys(patch) });
}
