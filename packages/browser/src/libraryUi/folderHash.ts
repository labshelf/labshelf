/**
 * Binds the open folder to the URL hash (`#/papers/Project/Refs`), so back/forward walk the folder history and a reload
 * lands on the same folder. The host tells the UI about hash changes and follows the UI's own navigation.
 */
import { createFolderHash, createFolderTitle, deriveParentDir, parseFolderHash, type HostEndpoint } from "@labshelf/core";
import { JOIN_PREFIX } from "./editorArea";

/**
 * Starts syncing the UI's folder with location.hash; returns a disposer. A hash that is the path of a paper opens the
 * paper's folder and selects it.
 */
export function attachHashHandlers(endpoint: HostEndpoint, paperIdAtPath: (path: string) => Promise<string | null>): () => void {
  let latest = 0;
  // The folder the UI reports after opening a paper's hash must not replace that hash, so a reload keeps the paper.
  let paperHash: { hash: string; folder: string } | null = null;
  const onHash = async (): Promise<void> => {
    // A tabs hash (`#/tabs/...`) belongs to the workspace and a join hash carries an invite; neither names a folder, so the open folder stays.
    if (location.hash.startsWith("#/tabs/") || location.hash.startsWith(JOIN_PREFIX)) return;
    const hash = location.hash;
    const path = parseFolderHash(hash);
    const turn = ++latest;
    const id = await paperIdAtPath(path);
    if (turn !== latest) return;
    if (!id) { paperHash = null; endpoint.post({ type: "navigate", folder: path }); return; }
    const folder = deriveParentDir(path, "/");
    paperHash = { hash, folder };
    endpoint.post({ type: "navigate", folder });
    endpoint.post({ type: "select", id });
  };
  const run = (): void => { void onHash(); };
  window.addEventListener("hashchange", run);
  const off = endpoint.subscribe((m) => {
    if (m.type === "ready") run();
    if (m.type !== "navigate") return;
    const next = createFolderHash(m.folder);
    const keepsPaperHash = paperHash && location.hash === paperHash.hash && m.folder === paperHash.folder;
    if (location.hash !== next && !keepsPaperHash) history.pushState(null, "", next);
    document.title = createFolderTitle(m.folder);
  });
  return () => { window.removeEventListener("hashchange", run); off(); };
}
