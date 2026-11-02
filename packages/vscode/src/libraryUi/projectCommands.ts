// Lists the commands a project row's menu and the open project's panel offer, and which of them apply to a row; shared by the host and the webview, so it imports no vscode.
import type { IconName, SidebarProjectItem } from "@labshelf/core";

export interface ProjectCommand {
  command: string;
  label: string;
  /** Commands of one group sit together in the menu; groups are separated. */
  group: number;
}

export const PROJECT_COMMANDS: readonly ProjectCommand[] = [
  { command: "labshelf.writing.openProject", label: "Open Project", group: 1 },
  { command: "labshelf.writing.checkBeforeSubmitting", label: "Check Before Submitting", group: 1 },
  { command: "labshelf.writing.reveal", label: "Reveal Project Folder", group: 1 },
  { command: "labshelf.writing.markVersion", label: "Mark Version", group: 1 },
  { command: "labshelf.writing.compareVersions", label: "Compare Versions", group: 1 },
  { command: "labshelf.installProjectPapers", label: "Install Project Papers", group: 1 },
  { command: "labshelf.templates.saveProject", label: "Save Project as Template…", group: 1 },
  { command: "labshelf.templates.publish", label: "Publish Project as Template…", group: 1 },
  { command: "labshelf.writing.removeProject", label: "Remove Project from LabShelf", group: 2 },
  { command: "labshelf.writing.addToReadingList", label: "Add Paper to Reading List…", group: 3 },
];

/** A section of the open project's panel: its title, its commands, and whether they sit side by side as chips. */
export interface ProjectPanelSpec {
  title: string;
  layout?: "chips";
  commands: readonly { command: string; label: string; icon: IconName }[];
}

/**
 * The open project's panel, opened from its title row. It leaves out what the editor already offers (history, Share,
 * Close) and the row-only and rarely used commands, which stay in the row menu and the command palette.
 */
export const OPEN_PROJECT_PANEL: readonly ProjectPanelSpec[] = [
  { title: "Download", layout: "chips", commands: [
    { command: "labshelf.writing.downloadPdf", label: "PDF", icon: "download" },
    { command: "labshelf.writing.downloadSource", label: "Source", icon: "download" },
    { command: "labshelf.writing.downloadArxiv", label: "arXiv", icon: "download" },
  ] },
  { title: "Export", layout: "chips", commands: [
    { command: "labshelf.writing.exportWord", label: "Word", icon: "file-text" },
    { command: "labshelf.writing.exportMarkdown", label: "Markdown", icon: "file-text" },
    { command: "labshelf.writing.exportHtml", label: "HTML", icon: "file-text" },
  ] },
  { title: "Versions", commands: [
    { command: "labshelf.writing.markVersion", label: "Save a version…", icon: "history" },
    { command: "labshelf.writing.compareVersions", label: "Compare versions…", icon: "git-compare" },
  ] },
  { title: "Project", commands: [
    { command: "labshelf.writing.checkBeforeSubmitting", label: "Check before submitting", icon: "check-square" },
    { command: "labshelf.writing.copyProject", label: "Make a copy…", icon: "copy" },
    { command: "labshelf.templates.saveProject", label: "Save as template…", icon: "layers" },
    { command: "labshelf.templates.publish", label: "Publish as template…", icon: "upload" },
    { command: "labshelf.writing.reveal", label: "Show folder on disk", icon: "folder-open" },
  ] },
];

/** The panel's destructive command, shown apart and only where it applies (a folder outside the library). */
export const OPEN_PROJECT_REMOVE: ProjectCommand = { command: "labshelf.writing.removeProject", label: "Remove from LabShelf", group: 0 };

const OPEN_PROJECT_COMMANDS: readonly ProjectCommand[] = [
  ...OPEN_PROJECT_PANEL.flatMap((section) => section.commands.map(({ command, label }) => ({ command, label, group: 0 }))),
  OPEN_PROJECT_REMOVE,
];

/** Whether the sidebar may ask for a command: one of the row menu or the open project's menu. */
export const isSidebarProjectCommand = (command: string): boolean =>
  PROJECT_COMMANDS.some((c) => c.command === command) || OPEN_PROJECT_COMMANDS.some((c) => c.command === command);

const BROKEN_COMMANDS: readonly string[] = ["labshelf.writing.reveal", "labshelf.writing.removeProject"];

/** Whether a command is offered on a row: only folders outside the library can be removed, and a broken project can only be revealed or removed. */
export function canApplyProjectCommand(command: string, row: Pick<SidebarProjectItem, "kind" | "external">): boolean {
  if (!isSidebarProjectCommand(command)) { return false; }
  if (command === "labshelf.writing.removeProject" && !row.external) { return false; }
  return row.kind === "ready" || BROKEN_COMMANDS.includes(command);
}
