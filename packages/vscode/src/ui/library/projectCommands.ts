// Lists the commands a project row and the open project's title menu offer, and which of them apply to a row; shared by the host and the webview, so it imports no vscode.
import type { SidebarProjectItem } from "./sidebarMessages.js";

export interface ProjectCommand {
  command: string;
  label: string;
  /** Commands of one group sit together in the menu; groups are separated. */
  group: number;
  /** The command is registered only on the desktop host (`enablement: "!isWeb"` in package.json). */
  desktopOnly?: true;
}

export const PROJECT_COMMANDS: readonly ProjectCommand[] = [
  { command: "labshelf.writing.openProject", label: "Open Project", group: 1 },
  { command: "labshelf.writing.checkBeforeSubmitting", label: "Check Before Submitting", group: 1, desktopOnly: true },
  { command: "labshelf.writing.reveal", label: "Reveal Project Folder", group: 1 },
  { command: "labshelf.writing.markVersion", label: "Mark Version", group: 1 },
  { command: "labshelf.writing.compareVersions", label: "Compare Versions", group: 1, desktopOnly: true },
  { command: "labshelf.installProjectPapers", label: "Install Project Papers", group: 1 },
  { command: "labshelf.templates.saveProject", label: "Save Project as Template…", group: 1, desktopOnly: true },
  { command: "labshelf.templates.publish", label: "Publish Project as Template…", group: 1, desktopOnly: true },
  { command: "labshelf.writing.removeProject", label: "Remove Project from LabShelf", group: 2 },
  { command: "labshelf.writing.addToReadingList", label: "Add Paper to Reading List…", group: 3 },
];

const ROW_ONLY: readonly string[] = ["labshelf.writing.openProject", "labshelf.templates.publish"];

/** The open project's title menu: publishing, downloads and exports, a copy, the row's other commands, then Close Project. */
export const OPEN_PROJECT_COMMANDS: readonly ProjectCommand[] = [
  { command: "labshelf.templates.publish", label: "Publish as Template…", group: 1, desktopOnly: true },
  { command: "labshelf.writing.downloadPdf", label: "Download PDF", group: 2 },
  { command: "labshelf.writing.openPdfExternally", label: "Open PDF in System Viewer", group: 2 },
  { command: "labshelf.writing.downloadSource", label: "Download Source (.zip)", group: 2 },
  { command: "labshelf.writing.downloadArxiv", label: "Download for arXiv (.zip)", group: 2 },
  { command: "labshelf.writing.exportWord", label: "Export as Word (.docx)", group: 3, desktopOnly: true },
  { command: "labshelf.writing.exportMarkdown", label: "Export as Markdown (.md)", group: 3, desktopOnly: true },
  { command: "labshelf.writing.exportHtml", label: "Export as HTML (.html)", group: 3, desktopOnly: true },
  { command: "labshelf.writing.copyProject", label: "Make a Copy…", group: 4 },
  ...PROJECT_COMMANDS.filter((c) => !ROW_ONLY.includes(c.command)).map((c) => ({ ...c, group: c.group + 4 })),
  { command: "labshelf.writing.showHistory", label: "Show Project History", group: 5, desktopOnly: true },
  { command: "labshelf.writing.closeProject", label: "Close Project", group: 8 },
];

/** Whether the sidebar may ask for a command: one of the row menu or the open project's menu. */
export const isSidebarProjectCommand = (command: string): boolean =>
  PROJECT_COMMANDS.some((c) => c.command === command) || OPEN_PROJECT_COMMANDS.some((c) => c.command === command);

const BROKEN_COMMANDS: readonly string[] = ["labshelf.writing.reveal", "labshelf.writing.removeProject"];

/** Whether a command is offered on a row: only folders outside the library can be removed, and a broken project can only be revealed or removed. */
export function projectCommandApplies(command: string, row: Pick<SidebarProjectItem, "kind" | "external">): boolean {
  if (!isSidebarProjectCommand(command)) { return false; }
  if (command === "labshelf.writing.removeProject" && !row.external) { return false; }
  return row.kind === "ready" || BROKEN_COMMANDS.includes(command);
}

/** The commands of a list that the host registers: on the web host the desktop-only ones are left out. */
export const hostCommands = (list: readonly ProjectCommand[], desktop: boolean): ProjectCommand[] =>
  list.filter((c) => desktop || !c.desktopOnly);
