/** Lists the problems of every template folder in a catalog checkout. */
// CONTRACT: documents/contracts/templates.md#manifest

import { loadCatalog, type CatalogProblem } from "./loadCatalog.js";

/** One problem per broken template folder, sorted by id; empty for a good catalog. */
export async function checkCatalog(root: string): Promise<CatalogProblem[]> {
  return (await loadCatalog(root)).problems;
}
