// Lists the actions of a project row's menu for the place it sits in, including the host's own commands.
import { projectShareMenuEntries } from "../../../collab/dom/index.js";
import type { SharingHost } from "../../../libraryUi/sharing/index.js";
import type { MenuEntry } from "../../../ui/dom/index.js";
import type { ProjectMenuCommand, ProjectRow } from "../projectRow.js";
import { deleteProjectForever, duplicateProject, moveProject, renameProject, type Post } from "./projectActions.js";

export interface ProjectMenuContext {
  rows: readonly ProjectRow[];
  commands: readonly ProjectMenuCommand[];
  post: Post;
  sharing?: SharingHost | undefined;
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
    { label: "Delete forever…", icon: "trash", danger: true, onSelect: () => void deleteProjectForever(row, ctx.post) },
  ];
}

const join = (...parts: MenuEntry[][]): MenuEntry[] =>
  parts.filter((p) => p.length > 0).flatMap((p, i) => (i === 0 ? p : ["separator" as const, ...p]));

export function projectMenuEntries(row: ProjectRow, ctx: ProjectMenuContext): MenuEntry[] {
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
      { label: "Duplicate…", icon: "copy", onSelect: () => void duplicateProject(row, post) },
      { label: "Move to folder…", icon: "folder-move", onSelect: () => void moveProject(row, ctx.rows, post) }],
    hostEntries(row, ctx),
    ctx.sharing ? projectShareMenuEntries(ctx.sharing, { id: row.id, shared: !!row.shared }) : [],
    [{ label: "Archive", onSelect: () => post({ type: "archive", id: row.id, archived: true }) }, toTrash],
  );
}
