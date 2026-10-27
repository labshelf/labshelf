// Brings the papers list of a project's labshelf.yaml in line with the keys its sources cite.
// CONTRACT: documents/contracts/library-format.md#labshelfyaml
import type { PaperRecord } from "../../model/index.js";
import { readOptionalText, type ProjectReadContext } from "../project/projectReads.js";
import { PROJECT_FILE, parseProjectFile, updateProjectSettings } from "../project/index.js";
import { syncListedPapers } from "./listedPapersSync.js";
import { derivePapersByCiteKey } from "./derivePapersByCiteKey.js";

/**
 * Writes `papers` when it differs from the sync of `findCiteKeyOccurrences`; true when it wrote. The list is read from disk, so a
 * stale caller cannot drop an entry added since it loaded the project. A labshelf.yaml that does not parse fails the call.
 */
export async function syncProjectPapers(
  context: ProjectReadContext, folder: string, citedKeys: readonly string[], library: readonly PaperRecord[],
): Promise<boolean> {
  const file = context.paths.join(folder, PROJECT_FILE);
  const text = await readOptionalText(context.fs, file);
  if (text === undefined) { return false; }
  const parsed = parseProjectFile(text);
  if (!parsed.ok) { throw new Error(`${file}: ${parsed.reason}`); }
  const next = syncListedPapers(parsed.settings.papers ?? [], citedKeys, derivePapersByCiteKey(library));
  if (next === undefined) { return false; }
  await updateProjectSettings(context, folder, { papers: next.length > 0 ? next : undefined });
  return true;
}
