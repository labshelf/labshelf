// Asks for what a project action needs (a title, a folder, a confirmation), posts it to the host, and lists the actions of a project row's menu.
import { createProjectShareMenuEntries } from "../../../collab/dom/index.js";
import type { ShareHost } from "../../../share/index.js";
import { askDialog, askInputBox, pickQuickEntry, type MenuEntry, type QuickPickItem } from "../../../ui/dom/index.js";
import { listMoveFolders, type ProjectMenuCommand, type ProjectRow } from "../projectModel.js";
import type { AllProjectsToHost } from "../protocol.js";

export type Post = (message: AllProjectsToHost) => void;

const requireName = (value: string): string | null => (value.trim() ? null : "Enter a name");

async function renameProject(row: ProjectRow, post: Post): Promise<void> {
  const title = await askInputBox({ title: "Rename project", value: row.title, validate: requireName });
  if (title !== undefined && title.trim() !== row.title) post({ type: "rename", id: row.id, title: title.trim() });
}

async function copyProject(row: ProjectRow, post: Post): Promise<void> {
  const title = await askInputBox({ title: "Duplicate project", prompt: "Name of the copy", value: `${row.title} copy`, validate: requireName });
  if (title !== undefined) post({ type: "duplicate", id: row.id, title: title.trim() });
}

const NEW_FOLDER = Symbol("new folder");

/** `folder` is the "/"-joined path; segments are trimmed and empty ones dropped. */
const cleanPath = (path: string): string => path.split("/").map((s) => s.trim()).filter(Boolean).join("/");

async function moveProject(row: ProjectRow, rows: readonly ProjectRow[], post: Post): Promise<void> {
  const items: QuickPickItem<string | typeof NEW_FOLDER>[] = [
    { label: "Top level", icon: "folder", value: "" },
    ...listMoveFolders(rows).map((folder) => ({ label: folder, icon: "folder" as const, value: folder })),
    { label: "New folder…", icon: "folder-plus", value: NEW_FOLDER },
  ];
  const picked = await pickQuickEntry(items, { title: "Move to folder", placeholder: `Move ${row.title} to…` });
  if (picked === undefined) return;
  let folder = picked === NEW_FOLDER ? undefined : picked;
  if (picked === NEW_FOLDER) {
    const path = await askInputBox({ title: "New folder", prompt: "Folder path; use / to nest", value: row.folder ?? "", validate: (v) => (cleanPath(v) ? null : "Enter a folder name") });
    if (path === undefined) return;
    folder = cleanPath(path);
  }
  if ((folder || undefined) === row.folder) return;
  post(folder ? { type: "move", id: row.id, folder } : { type: "move", id: row.id });
}

async function removeProjectForever(row: ProjectRow, post: Post): Promise<void> {
  const ok = row.external
    ? await askDialog(`Remove ${row.title} from LabShelf?`, "Its files stay where they are.", "Remove", true)
    : await askDialog(`Delete ${row.title} forever?`, "Its folder is deleted from this device. The folder stays on disk.", "Delete forever", true);
  if (ok) post({ type: "deleteForever", id: row.id });
}

export async function removeAllTrash(count: number, post: Post): Promise<void> {
  const noun = count === 1 ? "project" : "projects";
  const ok = await askDialog(`Delete ${count} ${noun} forever?`,
    "Library projects are deleted from this device; the folders stay on disk. Projects outside the library only leave LabShelf.", "Empty trash", true);
  if (ok) post({ type: "emptyTrash" });
}

export interface ProjectMenuContext {
  rows: readonly ProjectRow[];
  commands: readonly ProjectMenuCommand[];
  post: Post;
  sharing?: ShareHost | undefined;
}

/** The host commands that apply to `row`, a separator between command groups. */
function hostEntries(row: ProjectRow, ctx: ProjectMenuContext): MenuEntry[] {
  const shown = ctx.commands.filter((c) => !c.externalOnly || row.external).sort((a, b) => a.group - b.group);
  const entries: MenuEntry[] = [];
  shown.forEach((c, i) => {
    if (i > 0 && shown[i - 1]!.group !== c.group) entries.push("separator");
    entries.push({ label: c.label, onSelect: () => ctx.post({ type: "command", id: row.id, command: c.command }) });
  });
  return entries;
}

function trashEntries(row: ProjectRow, ctx: ProjectMenuContext): MenuEntry[] {
  return [
    { label: "Restore", icon: "refresh", onSelect: () => ctx.post({ type: "trash", id: row.id, trashed: false }) },
    { label: "Delete forever…", icon: "trash", danger: true, onSelect: () => void removeProjectForever(row, ctx.post) },
  ];
}

const join = (...parts: MenuEntry[][]): MenuEntry[] =>
  parts.filter((p) => p.length > 0).flatMap((p, i) => (i === 0 ? p : ["separator" as const, ...p]));

export function createProjectMenuEntries(row: ProjectRow, ctx: ProjectMenuContext): MenuEntry[] {
  const { post } = ctx;
  if (row.place === "trash") return row.broken ? join(hostEntries(row, ctx), trashEntries(row, ctx)) : trashEntries(row, ctx);
  const toTrash: MenuEntry = { label: "Move to trash", icon: "trash", onSelect: () => post({ type: "trash", id: row.id, trashed: true }) };
  if (row.broken) return join(hostEntries(row, ctx), [toTrash]);
  const open: MenuEntry = { label: "Open", icon: "file-text", onSelect: () => post({ type: "open", id: row.id }) };
  const rename: MenuEntry = { label: "Rename…", icon: "edit", onSelect: () => void renameProject(row, post) };
  if (row.place === "archived") {
    return [open, rename, { label: "Unarchive", onSelect: () => post({ type: "archive", id: row.id, archived: false }) }, toTrash];
  }
  return join(
    [open, rename,
      { label: "Duplicate…", icon: "copy", onSelect: () => void copyProject(row, post) },
      { label: "Move to folder…", icon: "folder-move", onSelect: () => void moveProject(row, ctx.rows, post) }],
    hostEntries(row, ctx),
    ctx.sharing ? createProjectShareMenuEntries(ctx.sharing, { id: row.id, shared: !!row.shared }) : [],
    [{ label: "Archive", onSelect: () => post({ type: "archive", id: row.id, archived: true }) }, toTrash],
  );
}
