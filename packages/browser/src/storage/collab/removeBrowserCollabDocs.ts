// Removes everything stored for one share, as when the user leaves it or removes its library.
import { COLLAB_STORES, openCollabDb, createNamespaceRange } from "./openCollabDb";

export async function removeBrowserCollabDocs(ns: string): Promise<void> {
  const tx = (await openCollabDb()).transaction(COLLAB_STORES, "readwrite");
  await Promise.all([...COLLAB_STORES.map((name) => tx.objectStore(name).delete(createNamespaceRange(ns))), tx.done]);
}
