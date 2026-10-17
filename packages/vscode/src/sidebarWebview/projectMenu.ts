// Builds the right-click menu of a project row: the project commands that apply to it, then Move to Folder and Archive.
import { showMenu, type MenuEntry } from "@labshelf/core/dom";
import { PROJECT_COMMANDS, projectCommandApplies } from "../ui/library/projectCommands.js";
import type { SidebarProjectItem, SidebarToHost } from "../ui/library/sidebarMessages.js";

/** @returns the menu entries for a row, with a separator between command groups */
export function projectMenuEntries(project: SidebarProjectItem, post: (m: SidebarToHost) => void): MenuEntry[] {
  const entries: MenuEntry[] = [];
  let group: number | null = null;
  for (const { command, label, group: g } of PROJECT_COMMANDS) {
    if (!projectCommandApplies(command, project)) { continue; }
    if (group !== null && g !== group) { entries.push("separator"); }
    group = g;
    entries.push({ label, onSelect: () => post({ type: "projectCommand", id: project.id, command }) });
  }
  if (project.kind === "ready") {
    entries.push("separator",
      { label: "Move to Folder…", icon: "folder-move", onSelect: () => post({ type: "projectEdit", id: project.id, edit: "move" }) },
      project.archived
        ? { label: "Unarchive", onSelect: () => post({ type: "projectEdit", id: project.id, edit: "unarchive" }) }
        : { label: "Archive", onSelect: () => post({ type: "projectEdit", id: project.id, edit: "archive" }) });
  }
  return entries;
}

export function showProjectMenu(project: SidebarProjectItem, at: { x: number; y: number }, post: (m: SidebarToHost) => void): void {
  showMenu(at, projectMenuEntries(project, post));
}
