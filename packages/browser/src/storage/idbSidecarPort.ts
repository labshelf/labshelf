// Implements SidecarPort over the IndexedDB file store at appdata/<paperId>/data.json.
// INVARIANT: that path is the sync "appdata" root, which VS Code maps to <library>/.research/papers.
import { APPDATA_DIR, SIDECAR_FILE, type SidecarPort } from "@labshelf/core";
import type { IndexedDbFileSystem } from "./indexedDbFileSystem";

/**
 * @returns the IndexedDB path of a paper's sidecar.
 */
export function sidecarPath(paperId: string): string {
  return `${APPDATA_DIR}/${paperId}/${SIDECAR_FILE}`;
}

/**
 * @returns a SidecarPort reading and writing UTF-8 JSON in the IndexedDB file store.
 */
export function createIdbSidecarPort(fs: Pick<IndexedDbFileSystem, "stat" | "readFile" | "writeFile">): SidecarPort {
  return {
    async read(paperId) {
      const path = sidecarPath(paperId);
      if (!(await fs.stat(path))?.isFile) return null;
      return new TextDecoder().decode(await fs.readFile(path));
    },
    async write(paperId, text) {
      await fs.writeFile(sidecarPath(paperId), new TextEncoder().encode(text));
    },
  };
}
