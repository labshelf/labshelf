/** Describes a writing project folder as the host lists it, ready with its settings or broken with a reason, and reads one project folder into such an entry through a folder-scoped port. */
import { formatError } from "../../errors/index.js";
import type { ILogger } from "../../ports/index.js";
import { detectEntryFile } from "./buildRoot.js";
import { PROJECT_FILE, parseProjectFile, type ProjectSettings } from "./projectFile.js";

/** "library": under <library>/projects/; "external": a registered folder anywhere else. */
export type ProjectPlacement = "library" | "external";

export type ProjectEntry =
  | {
    kind: "ready";
    folder: string;
    location: ProjectPlacement;
    settings: ProjectSettings;
    /** The main file from labshelf.yaml, else the detected one; undefined when neither exists. */
    main: string | undefined;
  }
  | { kind: "broken"; folder: string; location: ProjectPlacement; reason: string };

/** A project entry whose folder and settings were read. */
export type ReadyProject = Extract<ProjectEntry, { kind: "ready" }>;

/** One project folder as the host sees it; names are relative to the folder. */
export interface ProjectFolderReader {
  readOptionalText(name: string): Promise<string | undefined>;
  /** Names of the files at the folder's root; sources in subfolders are not main candidates. */
  rootFileNames(): Promise<string[]>;
  exists(): Promise<boolean>;
}

interface ReadProjectEntryInput {
  folder: string;
  location: ProjectPlacement;
  reader: ProjectFolderReader;
  logger: ILogger;
}

/** A project that cannot be read is returned as broken with a reason the UI can show, and logged. */
export async function readProjectEntry({ folder, location, reader, logger }: ReadProjectEntryInput): Promise<ProjectEntry> {
  const broken = async (reason: string): Promise<ProjectEntry> => {
    await logger.log("WARN", "project", "project cannot be read", { folder, reason });
    return { kind: "broken", folder, location, reason };
  };
  try {
    const text = await reader.readOptionalText(PROJECT_FILE);
    if (text === undefined) { return broken(await reader.exists() ? `${PROJECT_FILE} is missing` : "folder not found"); }
    const parsed = parseProjectFile(text);
    if (!parsed.ok) { return broken(`${PROJECT_FILE}: ${parsed.reason}`); }
    const main = parsed.settings.main
      ?? await detectEntryFile(parsed.settings.format, await reader.rootFileNames(), (name) => reader.readOptionalText(name));
    return { kind: "ready", folder, location, settings: parsed.settings, main };
  } catch (error) {
    await logger.error("project", error, { folder, action: "read" });
    return { kind: "broken", folder, location, reason: formatError(error) };
  }
}
