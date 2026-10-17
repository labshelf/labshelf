// Builds the right-click menu of a project row from the project commands that apply to it.
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
  return entries;
}

export function showProjectMenu(project: SidebarProjectItem, at: { x: number; y: number }, post: (m: SidebarToHost) => void): void {
  showMenu(at, projectMenuEntries(project, post));
}
