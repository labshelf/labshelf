// Reads and edits a project's .labshelf/checklist.json on disk.
import * as path from "node:path";

import { readOptionalFile, writeFileAtomic } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import {
  CHECKLIST_DIR, CHECKLIST_FILE, manualItems, parseChecklistFile, serializeChecklistFile,
  type ChecklistDocument, type ManualItem,
} from "../checklistFile.js";

const MODULE = "checklist";

function checklistFile(folder: string): string {
  return path.join(folder, CHECKLIST_DIR, CHECKLIST_FILE);
}

/** @returns the valid hand-added items; a missing file reads as none, an unreadable or malformed one reads as none and is logged */
export async function readManualItems(folder: string, logger: ILogger): Promise<ManualItem[]> {
  const file = checklistFile(folder);
  try {
    const text = await readOptionalFile(file);
    if (text === undefined) { return []; }
    const doc = parseChecklistFile(text);
    if (doc === undefined) {
      await logger.log("WARN", MODULE, "checklist.json is not a JSON object with an items array; its items are hidden", { file });
      return [];
    }
    return manualItems(doc);
  } catch (error) {
    await logger.error(MODULE, error, { file, action: "read" });
    return [];
  }
}

/** A file that does not parse is left untouched and the call fails, so no coauthor's item is lost. */
export async function updateChecklist(folder: string, edit: (doc: ChecklistDocument) => ChecklistDocument): Promise<void> {
  const file = checklistFile(folder);
  const text = await readOptionalFile(file);
  const current = text === undefined ? { items: [] } : parseChecklistFile(text);
  if (current === undefined) { throw new Error(`${file} is malformed; fix or delete it before the checklist can be edited`); }
  const nextText = serializeChecklistFile(edit(current));
  if (nextText !== text) { await writeFileAtomic(file, nextText); }
}
