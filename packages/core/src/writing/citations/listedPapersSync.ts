/** Computes the papers list of labshelf.yaml from the keys the sources cite and the library's papers. */
// CONTRACT: documents/contracts/library-format.md#labshelfyaml

import type { PaperRecord } from "../../model/index.js";
import type { ListedPaper } from "../project/index.js";

/**
 * The list after syncing, or undefined when it is already in sync. Entries the user added are never removed, a DOI
 * already listed is never changed (a coauthor may not have the paper), and new entries are appended in key order.
 */
export function syncListedPapers(
  listed: readonly ListedPaper[], citedKeys: readonly string[], library: ReadonlyMap<string, PaperRecord>,
): ListedPaper[] | undefined {
  const cited = new Set(citedKeys);
  let changed = false;
  const next: ListedPaper[] = [];
  for (const entry of listed) {
    if (entry.cited && !cited.has(entry.key)) { changed = true; continue; }
    const doi = entry.doi || library.get(entry.key)?.doi || undefined;
    if (doi !== entry.doi) { changed = true; }
    next.push(doi ? { ...entry, doi } : entry);
  }
  const present = new Set(listed.map((entry) => entry.key));
  // Only library papers join the list: other cited keys are Typst labels or entries of the user's own .bib file.
  for (const key of [...cited].filter((candidate) => !present.has(candidate) && library.has(candidate)).sort()) {
    const doi = library.get(key)?.doi || undefined;
    next.push({ key, ...doi ? { doi } : {}, cited: true });
    changed = true;
  }
  return changed ? next : undefined;
}
