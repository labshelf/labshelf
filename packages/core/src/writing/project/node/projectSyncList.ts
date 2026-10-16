/** Lists the projects of a library as the sync engine takes them: id, folder and ignore patterns. */
import type { ILogger } from "../../../ports/index.js";
import type { SyncProject } from "../../../sync/index.js";
import { listProjects } from "./projectCatalog.js";

/** Projects that cannot be read (broken or on an unmounted disk) are left out, which keeps their Drive folders untouched. */
export async function listSyncProjects(libraryRoot: string, logger: ILogger): Promise<SyncProject[]> {
  const entries = await listProjects(libraryRoot, logger);
  return entries.flatMap((entry) =>
    entry.kind === "ready" ? [{ id: entry.settings.id, root: entry.folder, ignore: entry.settings.ignore ?? [] }] : []);
}
