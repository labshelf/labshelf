/**
 * Prompts for a new or renamed folder's name, checked as the user types, and confirms before a folder and its
 * papers are deleted. The host does the work once the user agrees.
 */
import { PAPERS_DIR, baseName, countPapersUnder, parentDir } from "../../../library/index.js";
import { confirmDialog, inputBox } from "../../../ui/dom/index.js";
import { folderNameProblem } from "../../derive/index.js";
import type { UiContext } from "../uiContext.js";

export async function promptNewFolder(ctx: UiContext, parent: string): Promise<void> {
  const name = await inputBox({
    title: parent === PAPERS_DIR ? "New folder" : `New folder in ${baseName(parent, "/")}`,
    prompt: "Folder name",
    placeholder: "e.g. Reading group",
    validate: (v) => folderNameProblem(ctx.store.get(), parent, v),
  });
  if (name) ctx.transport.post({ type: "folder.create", parent, name });
}

export async function promptRenameFolder(ctx: UiContext, path: string): Promise<void> {
  if (path === PAPERS_DIR) return;
  const current = baseName(path, "/");
  const parent = parentDir(path, "/");
  const name = await inputBox({
    title: "Rename folder",
    prompt: "New name",
    value: current,
    validate: (v) => folderNameProblem(ctx.store.get(), parent, v, current),
  });
  if (name && name !== current) ctx.transport.post({ type: "folder.rename", path, name });
}

export async function confirmDeleteFolder(ctx: UiContext, path: string): Promise<void> {
  if (path === PAPERS_DIR) return;
  const count = countPapersUnder(ctx.store.get().papers.map((p) => p.path), path, "/");
  const ok = await confirmDialog(
    `Delete "${baseName(path, "/")}"?`,
    count > 0
      ? `The folder and the ${count} paper${count === 1 ? "" : "s"} inside it are deleted from the library on this device and on every synced device.`
      : "The folder is empty. It is deleted from the library on this device and on every synced device.",
    "Delete",
    true,
  );
  if (ok) ctx.transport.post({ type: "folder.delete", path });
}
