// Edits a project's .labshelf/checklist.json, keeping every field the edit does not change.
import { readOptionalText, type ProjectReadContext } from "../project/folder/index.js";
import { CHECKLIST_DIR, CHECKLIST_FILE, parseChecklistFile, serializeChecklistFile, type ChecklistDocument } from "./checklistFile.js";

/** A file that does not parse is left untouched and the call fails, so no coauthor's item is lost. */
export async function updateChecklist(
  { fs, paths, logger }: ProjectReadContext, folder: string, edit: (doc: ChecklistDocument) => ChecklistDocument,
): Promise<void> {
  const file = paths.join(folder, CHECKLIST_DIR, CHECKLIST_FILE);
  const text = await readOptionalText(fs, file);
  const current = text === undefined ? { items: [] } : parseChecklistFile(text);
  if (current === undefined) {
    const error = new Error(`${file} is malformed; fix or delete it before the checklist can be edited`);
    await logger.error("writing/checklist", error, { file });
    throw error;
  }
  const nextText = serializeChecklistFile(edit(current));
  if (nextText !== text) { await fs.writeText(file, nextText); }
}
