/** Builders for the library model tests: papers as a scan reports them and a store over a fixed scan. */
import { LibraryStore, type LibraryScan, type PaperEntry } from "@labshelf/core";

export function entry(id: string, collection = "", fields: Partial<PaperEntry["record"]> = {}, modifiedMs = 0): PaperEntry {
  const path = `/lib/papers/${collection ? `${collection}/` : ""}${id}`;
  return { record: { id, title: id, path, citeKey: id, status: "unread", hasPdf: true, ...fields }, collection, modifiedMs };
}

export function scanOf(papers: PaperEntry[], folders: string[] = []): LibraryScan {
  const implied = papers.map((p) => p.collection).filter(Boolean);
  return { papers, folders: [...new Set([...folders, ...implied])], orphans: [], duplicates: [] };
}

export async function loadedStore(papers: PaperEntry[], folders: string[] = []): Promise<LibraryStore> {
  const store = new LibraryStore({ root: "/lib", scan: async () => scanOf(papers, folders) });
  await store.reload();
  return store;
}
