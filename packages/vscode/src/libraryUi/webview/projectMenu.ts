// Builds the menus of a project: a row's right-click menu and the open project's title menu, from the commands that apply to it.
import { createProjectShareMenuEntries, showMenu, type MenuEntry } from "@labshelf/core/dom";
import { OPEN_PROJECT_COMMANDS, PROJECT_COMMANDS, canApplyProjectCommand, type ProjectCommand } from "../projectCommands.js";
import type { ShareHost, SidebarProjectItem } from "@labshelf/core";
import type { SidebarToHost } from "../sidebarMessages.js";

/** The commands of a list that apply to the project, with a separator between command groups. */
function commandEntries(list: readonly ProjectCommand[], project: SidebarProjectItem, post: (m: SidebarToHost) => void): MenuEntry[] {
  const entries: MenuEntry[] = [];
  let group: number | null = null;
  for (const { command, label, group: g } of list) {
    if (!canApplyProjectCommand(command, project)) { continue; }
    if (group !== null && g !== group) { entries.push("separator"); }
    group = g;
    entries.push({ label, onSelect: () => post({ type: "projectCommand", id: project.id, command }) });
  }
  return entries;
}

/** @returns the row menu entries: the project commands, then Move to Folder and Archive */
function projectMenuEntries(project: SidebarProjectItem, post: (m: SidebarToHost) => void): MenuEntry[] {
  const entries = commandEntries(PROJECT_COMMANDS, project, post);
  if (project.kind === "ready") {
    entries.push("separator",
      { label: "Move to Folder…", icon: "folder-move", onSelect: () => post({ type: "projectEdit", id: project.id, edit: "move" }) },
      { label: "Archive", onSelect: () => post({ type: "projectEdit", id: project.id, edit: "archive" }) });
  }
  return entries;
}

/** @returns the sharing entries as their own group, with the separator that sets it apart */
function shareGroup(sharing: ShareHost, project: SidebarProjectItem): MenuEntry[] {
  const share = createProjectShareMenuEntries(sharing, { id: project.id, shared: !!project.shared });
  return share.length > 0 ? ["separator", ...share] : [];
}

export function showProjectMenu(project: SidebarProjectItem, at: { x: number; y: number }, post: (m: SidebarToHost) => void, sharing: ShareHost): void {
  showMenu(at, [...projectMenuEntries(project, post), ...shareGroup(sharing, project)]);
}

/** Opens the open project's menu below its title row, as Overleaf's project-name menu does. */
export function showOpenProjectMenu(project: SidebarProjectItem, anchor: HTMLElement, post: (m: SidebarToHost) => void, sharing: ShareHost): void {
  showMenu(anchor, [...commandEntries(OPEN_PROJECT_COMMANDS, project, post), ...shareGroup(sharing, project)]);
}
