// Reads a project's hand-added checklist items through the file-system port.
import { readOptionalText, type ProjectReadContext } from "../project/folder/index.js";
import { CHECKLIST_DIR, CHECKLIST_FILE, manualItems, parseChecklistFile, type ManualItem } from "./checklistFile.js";

const MODULE = "checklist";

/** @returns the valid hand-added items; a missing file reads as none, an unreadable or malformed one reads as none and is logged */
export async function readManualItems({ fs, paths, logger }: ProjectReadContext, folder: string): Promise<ManualItem[]> {
  const file = paths.join(folder, CHECKLIST_DIR, CHECKLIST_FILE);
  try {
    const text = await readOptionalText(fs, file);
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
