/** Reads one project folder into a ready or broken project entry through a folder-scoped port. */
import type { ILogger } from "../../ports/index.js";
import { detectMainFile } from "./roots/index.js";
import type { ProjectEntry, ProjectLocation } from "./projectEntry.js";
import { PROJECT_FILE, parseProjectFile } from "./projectFile.js";

/** One project folder as the host sees it; names are relative to the folder. */
export interface ProjectFolderReader {
  readOptionalText(name: string): Promise<string | undefined>;
  /** Names of the files at the folder's root; sources in subfolders are not main candidates. */
  rootFileNames(): Promise<string[]>;
  exists(): Promise<boolean>;
}

interface ReadProjectEntryInput {
  folder: string;
  location: ProjectLocation;
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
      ?? await detectMainFile(parsed.settings.format, await reader.rootFileNames(), (name) => reader.readOptionalText(name));
    return { kind: "ready", folder, location, settings: parsed.settings, main };
  } catch (error) {
    await logger.error("project", error, { folder, action: "read" });
    return { kind: "broken", folder, location, reason: error instanceof Error ? error.message : String(error) };
  }
}
