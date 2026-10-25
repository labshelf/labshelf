// Asks for what a project action needs (a title, a folder, a confirmation) and posts the action to the host.
import { confirmDialog, inputBox, quickPick, type QuickPickItem } from "../../../ui/dom/index.js";
import { moveTargets } from "../viewModel/index.js";
import type { AllProjectsToHost } from "../protocol/index.js";
import type { ProjectRow } from "../projectRow.js";

export type Post = (message: AllProjectsToHost) => void;

const requireName = (value: string): string | null => (value.trim() ? null : "Enter a name");

export async function renameProject(row: ProjectRow, post: Post): Promise<void> {
  const title = await inputBox({ title: "Rename project", value: row.title, validate: requireName });
  if (title !== undefined && title.trim() !== row.title) post({ type: "rename", id: row.id, title: title.trim() });
}

export async function duplicateProject(row: ProjectRow, post: Post): Promise<void> {
  const title = await inputBox({ title: "Duplicate project", prompt: "Name of the copy", value: `${row.title} copy`, validate: requireName });
  if (title !== undefined) post({ type: "duplicate", id: row.id, title: title.trim() });
}

const NEW_FOLDER = Symbol("new folder");

/** `folder` is the "/"-joined path; segments are trimmed and empty ones dropped. */
const cleanPath = (path: string): string => path.split("/").map((s) => s.trim()).filter(Boolean).join("/");

export async function moveProject(row: ProjectRow, rows: readonly ProjectRow[], post: Post): Promise<void> {
  const items: QuickPickItem<string | typeof NEW_FOLDER>[] = [
    { label: "Top level", icon: "folder", value: "" },
    ...moveTargets(rows).map((folder) => ({ label: folder, icon: "folder" as const, value: folder })),
    { label: "New folder…", icon: "folder-plus", value: NEW_FOLDER },
  ];
  const picked = await quickPick(items, { title: "Move to folder", placeholder: `Move ${row.title} to…` });
  if (picked === undefined) return;
  let folder = picked === NEW_FOLDER ? undefined : picked;
  if (picked === NEW_FOLDER) {
    const path = await inputBox({ title: "New folder", prompt: "Folder path; use / to nest", value: row.folder ?? "", validate: (v) => (cleanPath(v) ? null : "Enter a folder name") });
    if (path === undefined) return;
    folder = cleanPath(path);
  }
  if ((folder || undefined) === row.folder) return;
  post(folder ? { type: "move", id: row.id, folder } : { type: "move", id: row.id });
}

export async function deleteProjectForever(row: ProjectRow, post: Post): Promise<void> {
  const ok = row.external
    ? await confirmDialog(`Remove ${row.title} from LabShelf?`, "Its files stay where they are.", "Remove", true)
    : await confirmDialog(`Delete ${row.title} forever?`, "Its folder is deleted from this device. The folder stays on disk.", "Delete forever", true);
  if (ok) post({ type: "deleteForever", id: row.id });
}

export async function emptyTrash(count: number, post: Post): Promise<void> {
  const noun = count === 1 ? "project" : "projects";
  const ok = await confirmDialog(`Delete ${count} ${noun} forever?`,
    "Library projects are deleted from this device; the folders stay on disk. Projects outside the library only leave LabShelf.", "Empty trash", true);
  if (ok) post({ type: "emptyTrash" });
}
