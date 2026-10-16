/** Brings the papers list of a project's labshelf.yaml in line with the keys its sources cite. */
// CONTRACT: documents/contracts/library-format.md#labshelfyaml

import * as path from "node:path";

import { readOptionalFile } from "../../../library/node/index.js";
import type { PaperRecord } from "../../../model/index.js";
import type { ILogger } from "../../../ports/index.js";
import { PROJECT_FILE, parseProjectFile } from "../../project/index.js";
import { updateProjectSettings } from "../../project/node/index.js";
import { papersByCiteKey, syncListedPapers } from "../index.js";

/**
 * Writes `papers` when it differs from the sync of `citedKeys`; true when it wrote. The list is read from disk, so a
 * stale caller cannot drop an entry added since it loaded the project. A labshelf.yaml that does not parse fails the call.
 */
export async function syncProjectPapers(
  folder: string, citedKeys: readonly string[], library: readonly PaperRecord[], logger: ILogger,
): Promise<boolean> {
  const file = path.join(folder, PROJECT_FILE);
  const text = await readOptionalFile(file);
  if (text === undefined) { return false; }
  const parsed = parseProjectFile(text);
  if (!parsed.ok) { throw new Error(`${file}: ${parsed.reason}`); }
  const next = syncListedPapers(parsed.settings.papers ?? [], citedKeys, papersByCiteKey(library));
  if (next === undefined) { return false; }
  await updateProjectSettings(folder, { papers: next.length > 0 ? next : undefined }, logger);
  return true;
}
