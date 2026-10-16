/** Reads and writes a project's .labshelf/state.json and finds the project edited last. */
import * as path from "node:path";

import { readOptionalFile, writeFileAtomic } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import {
  PROJECT_STATE_DIR, PROJECT_STATE_FILE, cursorOf, newestCursor, parseProjectState, serializeProjectState, withCursor,
  type ProjectCursor,
} from "../deviceLocal/index.js";
import type { ProjectEntry } from "../projectEntry.js";

const MODULE = "projectState";

/** A project and where its user last edited. */
export interface ProjectLastEdit {
  id: string;
  folder: string;
  cursor: ProjectCursor;
}

function stateFile(folder: string): string {
  return path.join(folder, PROJECT_STATE_DIR, PROJECT_STATE_FILE);
}

/** @returns the saved cursor; a missing file reads as none, an unreadable or corrupt one reads as none and is logged */
export async function readProjectCursor(folder: string, logger: ILogger): Promise<ProjectCursor | undefined> {
  const file = stateFile(folder);
  try {
    const text = await readOptionalFile(file);
    if (text === undefined) { return undefined; }
    const state = parseProjectState(text);
    if (state === undefined) {
      await logger.log("WARN", MODULE, "state.json is not a JSON object; the last edit is ignored", { file });
      return undefined;
    }
    return cursorOf(state);
  } catch (error) {
    await logger.error(MODULE, error, { file, action: "read" });
    return undefined;
  }
}

/** A state file that does not parse is left untouched and the call fails, so nothing a user kept in it is lost. */
export async function writeProjectCursor(folder: string, cursor: ProjectCursor): Promise<void> {
  const file = stateFile(folder);
  const text = await readOptionalFile(file);
  const current = text === undefined ? {} : parseProjectState(text);
  if (current === undefined) { throw new Error(`${file} is corrupt; fix or delete it before the last edit can be saved`); }
  const nextText = serializeProjectState(withCursor(current, cursor));
  if (nextText !== text) { await writeFileAtomic(file, nextText); }
}

/** @returns the ready project edited last, or undefined when none has a saved cursor */
export async function latestProjectEdit(entries: readonly ProjectEntry[], logger: ILogger): Promise<ProjectLastEdit | undefined> {
  const edits = await Promise.all(entries.map(async (entry): Promise<ProjectLastEdit | undefined> => {
    if (entry.kind !== "ready") { return undefined; }
    const cursor = await readProjectCursor(entry.folder, logger);
    return cursor && { id: entry.settings.id, folder: entry.folder, cursor };
  }));
  return newestCursor(edits.filter((edit): edit is ProjectLastEdit => edit !== undefined));
}
