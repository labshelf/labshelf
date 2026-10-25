/**
 * Prompts for a new or renamed folder's name, checked as the user types, and confirms before a folder and its
 * papers are deleted. The host does the work once the user agrees.
 */
import { PAPERS_DIR, deriveBaseName, countPapersUnder, deriveParentDir } from "../../../library/index.js";
import { confirmDialog, inputBox } from "../../../ui/dom/index.js";
import { checkSiblingFolderName } from "../../viewModel/index.js";
import type { UiContext } from "../uiContext.js";

export async function askCreateFolder(ctx: UiContext, parent: string): Promise<void> {
  const name = await inputBox({
    title: parent === PAPERS_DIR ? "New folder" : `New folder in ${deriveBaseName(parent, "/")}`,
    prompt: "Folder name",
    placeholder: "e.g. Reading group",
    validate: (v) => checkSiblingFolderName(ctx.store.get(), parent, v),
  });
  if (name) ctx.transport.post({ type: "folder.create", parent, name });
}

export async function askRenameFolder(ctx: UiContext, path: string): Promise<void> {
  if (path === PAPERS_DIR) return;
  const current = deriveBaseName(path, "/");
  const parent = deriveParentDir(path, "/");
  const name = await inputBox({
    title: "Rename folder",
    prompt: "New name",
    value: current,
    validate: (v) => checkSiblingFolderName(ctx.store.get(), parent, v, current),
  });
  if (name && name !== current) ctx.transport.post({ type: "folder.rename", path, name });
}

export async function askRemoveFolder(ctx: UiContext, path: string): Promise<void> {
  if (path === PAPERS_DIR) return;
  const count = countPapersUnder(ctx.store.get().papers.map((p) => p.path), path, "/");
  const ok = await confirmDialog(
    `Delete "${deriveBaseName(path, "/")}"?`,
    count > 0
      ? `The folder and the ${count} paper${count === 1 ? "" : "s"} inside it are deleted from the library on this device and on every synced device.`
      : "The folder is empty. It is deleted from the library on this device and on every synced device.",
    "Delete",
    true,
  );
  if (ok) ctx.transport.post({ type: "folder.delete", path });
}
