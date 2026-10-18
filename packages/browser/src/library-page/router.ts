/**
 * Binds the open folder to the URL hash (`#/papers/Project/Refs`), so back/forward walk the folder history and a reload
 * lands on the same folder. The host tells the UI about hash changes and follows the UI's own navigation.
 */
import { PAPERS_DIR, isLibraryPath, type HostEndpoint } from "@labshelf/core";

/** Parses a location hash into a folder path, falling back to the root. */
export function folderFromHash(hash: string): string {
  const raw = decodeURIComponent(hash.replace(/^#\/?/, "")).replace(/\/+$/, "");
  return isLibraryPath(raw) ? raw : PAPERS_DIR;
}

/** Builds the hash for a folder path. */
export function hashForFolder(folder: string): string {
  return `#/${folder.split("/").map(encodeURIComponent).join("/")}`;
}

/** Starts syncing the UI's folder with location.hash; returns a disposer. */
export function attachRouter(endpoint: HostEndpoint): () => void {
  const onHash = (): void => { endpoint.post({ type: "navigate", folder: folderFromHash(location.hash) }); };
  window.addEventListener("hashchange", onHash);
  const off = endpoint.subscribe((m) => {
    if (m.type === "ready") onHash();
    if (m.type !== "navigate") return;
    const next = hashForFolder(m.folder);
    if (location.hash !== next) history.pushState(null, "", next);
    document.title = m.folder === PAPERS_DIR ? "LabShelf" : `${m.folder.slice(m.folder.lastIndexOf("/") + 1)} — LabShelf`;
  });
  return () => { window.removeEventListener("hashchange", onHash); off(); };
}
