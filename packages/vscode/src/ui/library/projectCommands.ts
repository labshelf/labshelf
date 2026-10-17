// Lists the commands a project row offers and which of them apply to a row; shared by the host and the webview, so it imports no vscode.
import type { SidebarProjectItem } from "./sidebarMessages.js";

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

const BROKEN_COMMANDS: readonly string[] = ["labshelf.writing.reveal", "labshelf.writing.removeProject"];

/** Whether a command is offered on a row: only folders outside the library can be removed, and a broken project can only be revealed or removed. */
export function projectCommandApplies(command: string, row: Pick<SidebarProjectItem, "kind" | "external">): boolean {
  if (!PROJECT_COMMANDS.some((c) => c.command === command)) { return false; }
  if (command === "labshelf.writing.removeProject" && !row.external) { return false; }
  return row.kind === "ready" || BROKEN_COMMANDS.includes(command);
}
