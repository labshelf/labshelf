// The included files of a multi-file talk in the workspace: their texts read once through the host's files port, the tree across the
// files, and the writing of an edit of an included node straight to its file (outside the main editor's undo history).
import { readSourceDeckProject, type SourceDeckChange, type SourceDeckNode } from "../../index.js";
import type { WorkspaceState } from "./workspaceState.js";

/** The text a node's ranges index: its included file's from the cache, else the main editor's. */
export const textOf = (ws: WorkspaceState, file: string | undefined): string => (file === undefined ? ws.ports.editing.text() : ws.files.get(file) ?? "");

/** The block tree across the main text and the included files read so far; `missing` collects the includes not read yet. */
export function projectTree(ws: WorkspaceState, missing?: Set<string>): SourceDeckNode[] {
  const { path } = ws.ports;
  return readSourceDeckProject(ws.format, ws.kind, path, (file) => {
    if (file === path) return ws.text;
    if (!ws.files.has(file)) missing?.add(file);
    return ws.files.get(file);
  });
}

/**
 * Reads the includes the tree names that are not cached yet, following includes of included files, and calls `changed` once when any
 * arrived. Without a files port, or for a poster, nothing is read.
 */
export async function loadIncludes(ws: WorkspaceState, changed: () => void): Promise<void> {
  const { files } = ws.ports;
  if (!files || ws.kind !== "talk") return;
  let arrived = false;
  for (;;) {
    const missing = new Set<string>();
    projectTree(ws, missing);
    if (!missing.size) break;
    const texts = await Promise.all([...missing].map((file) => files.read(file).catch(() => undefined)));
    [...missing].forEach((file, i) => ws.files.set(file, texts[i]));
    arrived ||= texts.some((text) => text !== undefined);
  }
  if (arrived) changed();
}

/** Writes an edit of an included file; on success the cache takes the new text and `done` runs, on failure the message is shown. */
export function writeIncluded(ws: WorkspaceState, file: string, change: SourceDeckChange, done: () => void, failed: (message: string) => void): void {
  const { files } = ws.ports;
  if (!files) { failed("This host cannot write other files."); return; }
  files.write(file, change.text).then(() => { ws.files.set(file, change.text); done(); }, (error: unknown) => failed(error instanceof Error ? error.message : String(error)));
}
