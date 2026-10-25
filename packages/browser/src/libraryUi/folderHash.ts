/**
 * Binds the open folder to the URL hash (`#/papers/Project/Refs`), so back/forward walk the folder history and a reload
 * lands on the same folder. The host tells the UI about hash changes and follows the UI's own navigation.
 */
import { PAPERS_DIR, isLibraryPath, parentDir, type HostEndpoint } from "@labshelf/core";
import { JOIN_PREFIX } from "./editorArea";

/** Parses a location hash into a folder path, falling back to the root. */
export function folderFromHash(hash: string): string {
  const raw = decodeURIComponent(hash.replace(/^#\/?/, "")).replace(/\/+$/, "");
  return isLibraryPath(raw) ? raw : PAPERS_DIR;
}

/** Builds the hash for a folder path. */
export function hashForFolder(folder: string): string {
  return `#/${folder.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Starts syncing the UI's folder with location.hash; returns a disposer. A hash that is the path of a paper opens the
 * paper's folder and selects it.
 */
export function attachRouter(endpoint: HostEndpoint, paperIdAtPath: (path: string) => Promise<string | null>): () => void {
  let latest = 0;
  // The folder the UI reports after opening a paper's hash must not replace that hash, so a reload keeps the paper.
  let paperHash: { hash: string; folder: string } | null = null;
  const onHash = async (): Promise<void> => {
    // A tabs hash (`#/tabs/...`) belongs to the workspace and a join hash carries an invite; neither names a folder, so the open folder stays.
    if (location.hash.startsWith("#/tabs/") || location.hash.startsWith(JOIN_PREFIX)) return;
    const hash = location.hash;
    const path = folderFromHash(hash);
    const turn = ++latest;
    const id = await paperIdAtPath(path);
    if (turn !== latest) return;
    if (!id) { paperHash = null; endpoint.post({ type: "navigate", folder: path }); return; }
    const folder = parentDir(path, "/");
    paperHash = { hash, folder };
    endpoint.post({ type: "navigate", folder });
    endpoint.post({ type: "select", id });
  };
  const run = (): void => { void onHash(); };
  window.addEventListener("hashchange", run);
  const off = endpoint.subscribe((m) => {
    if (m.type === "ready") run();
    if (m.type !== "navigate") return;
    const next = hashForFolder(m.folder);
    const keepsPaperHash = paperHash && location.hash === paperHash.hash && m.folder === paperHash.folder;
    if (location.hash !== next && !keepsPaperHash) history.pushState(null, "", next);
    document.title = m.folder === PAPERS_DIR ? "LabShelf" : `${m.folder.slice(m.folder.lastIndexOf("/") + 1)} — LabShelf`;
  });
  return () => { window.removeEventListener("hashchange", run); off(); };
}
