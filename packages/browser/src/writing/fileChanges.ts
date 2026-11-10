// Tells the library page's source tabs that another page (the reader's cite popup) wrote a project file, and reloads the tab's editor of that file.
import { isRecord, isString } from "@labshelf/core";
import { showToast } from "@labshelf/core/dom";
import { reloadOpenEditor } from "./session";

/** A project file another page wrote; `path` is relative to the project folder. */
export interface ProjectFileChange { projectId: string; path: string }

const CHANNEL = "labshelf-file-changed";

/** PLATFORM: the reader runs in its own browser tab or in a frame of the library page, so the change crosses pages on a BroadcastChannel. */
export function sendProjectFileChange(change: ProjectFileChange): void {
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage({ projectId: change.projectId, path: change.path });
  channel.close();
}

/** Calls `listener` with each well-formed change; returns the function that stops listening. */
export function onProjectFileChange(listener: (change: ProjectFileChange) => void): () => void {
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (isRecord(data) && isString(data["projectId"]) && isString(data["path"])) listener({ projectId: data["projectId"], path: data["path"] });
  };
  return () => channel.close();
}

/**
 * Reloads the open editor of `file` when another page changes it; unsaved edits elsewhere in the text keep the change merged
 * in, and `onConflict` runs when the change overlaps them, which the editor then keeps. Returns the function that stops it.
 */
export function followProjectFileChanges(file: ProjectFileChange, onConflict: () => void): () => void {
  return onProjectFileChange((change) => {
    if (change.projectId !== file.projectId || change.path !== file.path) return;
    void reloadOpenEditor(file.projectId, file.path).then((taken) => { if (!taken) onConflict(); });
  });
}

/** The warning a source tab shows when it kept its unsaved edits over another page's change of the file. */
export function warnFileChangeConflict(path: string): void {
  showToast(`${path} changed in another tab where you were editing. Your edits are kept; saving them replaces that change.`, "error");
}
