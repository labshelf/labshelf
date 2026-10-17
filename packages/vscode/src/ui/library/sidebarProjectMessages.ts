// Runs the project requests of the Library sidebar webview by executing the matching LabShelf command.
import * as vscode from "vscode";
import type { ProjectEntry } from "@labshelf/core";
import type { ProjectAction, SidebarToHost } from "./sidebarMessages.js";
import { projectCommandApplies } from "./projectCommands.js";

/** What the host needs to know about the projects the sidebar lists. */
export interface SidebarProjectsPort {
  find(id: string): ProjectEntry | undefined;
}

const ACTION_COMMANDS: Record<ProjectAction, string> = {
  browseTemplates: "labshelf.templates.open",
  newBlank: "labshelf.writing.newBlankProject",
  addExisting: "labshelf.writing.addExistingFolder",
  refresh: "labshelf.writing.refresh",
};

type ProjectMessage = Extract<SidebarToHost, { type: "openProject" | "projectCommand" | "projectAction" }>;

export const isProjectMessage = (m: SidebarToHost): m is ProjectMessage =>
  m.type === "openProject" || m.type === "projectCommand" || m.type === "projectAction";

/** Runs one project message; a row the host does not list, or a command that does not apply to it, is ignored. */
export async function handleProjectMessage(m: ProjectMessage, projects: SidebarProjectsPort): Promise<void> {
  if (m.type === "projectAction") { await vscode.commands.executeCommand(ACTION_COMMANDS[m.action]); return; }
  const entry = projects.find(m.id);
  if (!entry) { return; }
  const command = m.type === "openProject" ? "labshelf.writing.openProject" : m.command;
  if (!projectCommandApplies(command, { kind: entry.kind, external: entry.location === "external" })) { return; }
  await vscode.commands.executeCommand(command, entry);
}
