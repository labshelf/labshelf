// Removes everything stored for one share, as when the user leaves it or removes its library.
import { COLLAB_STORES, collabDb, namespaceRange } from "./collabDb";

export async function deleteBrowserCollabState(ns: string): Promise<void> {
  const tx = (await collabDb()).transaction(COLLAB_STORES, "readwrite");
  await Promise.all([...COLLAB_STORES.map((name) => tx.objectStore(name).delete(namespaceRange(ns))), tx.done]);
}
