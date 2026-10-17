/** Builds the text of a catalog's index.json from its template folders, refusing a catalog with any problem. */
// CONTRACT: documents/contracts/templates.md#index

import { loadCatalog } from "./loadCatalog.js";
import { readDownloadCounts } from "./readDownloadCounts.js";

/** Deterministic index text ending in a newline; throws listing every problem as `<id>: <reason>`, or naming a bad downloads.json. */
export async function buildCatalogIndex(root: string, commit: string): Promise<string> {
  const { entries, problems } = await loadCatalog(root);
  if (problems.length > 0) { throw new Error(problems.map((p) => `${p.id}: ${p.reason}`).join("\n")); }
  const counts = await readDownloadCounts(root);
  // INVARIANT: loadCatalog puts sample last, so downloads lands after it and the key order stays stable.
  const templates = entries.map((entry) => {
    const downloads = counts.get(entry.id);
    return downloads === undefined ? entry : { ...entry, downloads };
  });
  return `${JSON.stringify({ schema: 1, commit, templates }, null, 2)}\n`;
}
