// Builds the menus of a project: a row's right-click menu and the open project's title menu, from the commands that apply to it.
import { createProjectShareMenuEntries, showMenu, showProjectPanel, type MenuEntry, type ProjectPanelItem } from "@labshelf/core/dom";
import { OPEN_PROJECT_PANEL, OPEN_PROJECT_REMOVE, PROJECT_COMMANDS, canApplyProjectCommand, type ProjectCommand } from "../projectCommands.js";
import type { ShareHost, SidebarProjectItem, SidebarToHost } from "@labshelf/core";

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

/** Opens the open project's panel below its title row: its sections, the sharing of a shared project, then what removes it. */
export function showOpenProjectMenu(project: SidebarProjectItem, anchor: HTMLElement, post: (m: SidebarToHost) => void, sharing: ShareHost): void {
  const run = (command: string) => () => post({ type: "projectCommand", id: project.id, command });
  const sections = OPEN_PROJECT_PANEL.map(({ title, layout, commands }) => ({
    title, ...(layout ? { layout } : {}),
    items: commands.filter((c) => canApplyProjectCommand(c.command, project)).map(({ label, icon, command }) => ({ label, icon, run: run(command) })),
  }));
  // An unshared project is shared from the editor's Share button, so only a shared one lists its sharing here.
  const share = project.shared ? createProjectShareMenuEntries(sharing, { id: project.id, shared: true }).filter((e): e is Exclude<MenuEntry, "separator"> => e !== "separator") : [];
  const toItem = (e: Exclude<MenuEntry, "separator">): ProjectPanelItem => ({ label: e.label, ...(e.icon ? { icon: e.icon } : {}), run: e.onSelect });
  const danger = [
    ...share.filter((e) => e.danger).map(toItem),
    ...(canApplyProjectCommand(OPEN_PROJECT_REMOVE.command, project) ? [{ label: OPEN_PROJECT_REMOVE.label, icon: "trash" as const, run: run(OPEN_PROJECT_REMOVE.command) }] : []),
  ];
  showProjectPanel(anchor, {
    name: project.name,
    ...(project.format ? { detail: project.format === "latex" ? "LaTeX project" : "Typst project" } : {}),
    sections: [...sections, { title: "Sharing", items: share.filter((e) => !e.danger).map(toItem) }],
    danger,
  });
}
