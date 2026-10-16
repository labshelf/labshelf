/** Builds the text of a catalog's index.json from its template folders, refusing a catalog with any problem. */
// CONTRACT: documents/contracts/templates.md#index

import { loadCatalog } from "./loadCatalog.js";

/** Deterministic index text ending in a newline; throws listing every problem as `<id>: <reason>`. */
export async function buildCatalogIndex(root: string, commit: string): Promise<string> {
  const { entries, problems } = await loadCatalog(root);
  if (problems.length > 0) { throw new Error(problems.map((p) => `${p.id}: ${p.reason}`).join("\n")); }
  return `${JSON.stringify({ schema: 1, commit, templates: entries }, null, 2)}\n`;
}
