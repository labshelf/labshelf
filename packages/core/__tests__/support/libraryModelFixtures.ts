/** Builders for the library model tests: papers as a scan reports them and a store over a fixed scan. */
import { LibraryStore, type LibraryScan, type PaperEntry, type PaperFilter } from "@labshelf/core";

export function entry(id: string, collection = "", fields: Partial<PaperEntry["record"]> = {}, modifiedMs = 0): PaperEntry {
  const path = `/lib/papers/${collection ? `${collection}/` : ""}${id}`;
  return { record: { id, title: id, path, citeKey: id, status: "unread", hasPdf: true, ...fields }, collection, modifiedMs };
}

export function scanOf(papers: PaperEntry[], folders: string[] = []): LibraryScan {
  const implied = papers.map((p) => p.collection).filter(Boolean);
  return { papers, folders: [...new Set([...folders, ...implied])], orphans: [], duplicates: [] };
}

/** A filter that matches a substring of the title (score 2) or of the first tag (score 1). */
export const substringFilter = (query: string): PaperFilter | undefined => {
  const needle = query.trim().toLowerCase();
  if (!needle) { return undefined; }
  return {
    keepsCollection: (name) => name.toLowerCase().includes(needle),
    score: (e) => (e.record.title.toLowerCase().includes(needle) ? 2 : (e.record.tags ?? []).some((t) => t.includes(needle)) ? 1 : 0),
  };
};

export async function loadedStore(papers: PaperEntry[], folders: string[] = []): Promise<LibraryStore> {
  const store = new LibraryStore({ root: "/lib", scan: async () => scanOf(papers, folders), filterFor: substringFilter });
  await store.reload();
  return store;
}
