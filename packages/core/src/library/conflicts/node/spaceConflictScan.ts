// Lists sync-tool conflict copies of space.json and glossary.json inside each Space folder.
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import { GLOSSARY_FILE, SPACES_DIR, SPACE_FILE } from "../../layout.js";
import type { ConflictCopy } from "../conflictCopy.js";
import { parseConflictName } from "../conflictNames.js";
import { readDirOrEmpty } from "./readDirOrEmpty.js";

const SPACE_FILES: ReadonlySet<string> = new Set([SPACE_FILE, GLOSSARY_FILE]);

/** Reads a folder, logging instead of throwing so one unreadable Space does not hide the others. */
async function readVisible(dir: string, logger: ILogger) {
  try {
    return (await readDirOrEmpty(dir)).filter((entry) => !entry.name.startsWith("."));
  } catch (error) {
    void logger.error("conflicts", error, { dir });
    return [];
  }
}

/** @returns the conflict copies sitting directly in `spaces/<id>/`; deeper folders are ignored. */
export async function scanSpaceConflicts(root: string, logger: ILogger): Promise<ConflictCopy[]> {
  const found: ConflictCopy[] = [];
  const spacesRoot = path.join(root, SPACES_DIR);
  for (const space of await readVisible(spacesRoot, logger)) {
    if (!space.isDirectory()) { continue; }
    const dir = path.join(spacesRoot, space.name);
    for (const entry of await readVisible(dir, logger)) {
      const parsed = entry.isFile() ? parseConflictName(entry.name) : null;
      if (!parsed || !SPACE_FILES.has(parsed.original)) { continue; }
      found.push({ owner: { kind: "space", id: space.name }, original: path.join(dir, parsed.original), copy: path.join(dir, entry.name), tool: parsed.tool });
    }
  }
  return found;
}
