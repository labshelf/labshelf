// Registers the commands that add a writing project from a blank template or an existing folder.
import * as vscode from "vscode";

import { PROJECT_FILE, blankTemplate, detectFormat, type ProjectFormat } from "@labshelf/core";
import { executeSafely } from "../commands/index.js";
import type { WritingHost, WritingProjects } from "./session/index.js";
import { OPEN_PROJECT_COMMAND } from "./session/index.js";

interface ProjectCommandsDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: WritingProjects;
}

async function pickFormat(placeHolder: string): Promise<ProjectFormat | undefined> {
  const picked = await vscode.window.showQuickPick(
    [{ label: "LaTeX", format: "latex" as const }, { label: "Typst", format: "typst" as const }],
    { placeHolder },
  );
  return picked?.format;
}

async function newBlankProject({ host, projects }: ProjectCommandsDeps): Promise<void> {
  const session = await host.require();
  if (!session) { return; }
  await executeSafely(session.logger, "labshelf.writing.newBlankProject", async () => {
    const title = (await vscode.window.showInputBox({ prompt: "Project title", placeHolder: "Deep nets survey" }))?.trim();
    if (!title) { return; }
    const format = await pickFormat("Format of the new project");
    if (!format) { return; }
    const entry = await projects.data.createProjectFromTemplate(session.root, { title, ...blankTemplate(format, title) });
    await projects.reload();
    await vscode.commands.executeCommand(OPEN_PROJECT_COMMAND, entry);
  });
}

async function addFolder({ host, projects }: ProjectCommandsDeps): Promise<void> {
  const session = await host.require();
  if (!session) { return; }
  await executeSafely(session.logger, "labshelf.writing.addExistingFolder", async () => {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: "Add project folder",
    });
    const folder = picked?.[0]?.fsPath;
    if (!folder) { return; }
    const names = await projects.data.rootFileNames(folder);
    // Core keeps an existing labshelf.yaml and ignores the format, so the user is not asked for it.
    const format = detectFormat(names)
      ?? (names.includes(PROJECT_FILE) ? "latex" : await pickFormat("This folder has no .tex or .typ file. Which format is the project?"));
    if (!format) { return; }
    await projects.data.addExistingFolder(session.root, { folder, format });
    await projects.reload();
  });
}

export function registerProjectCommands(deps: ProjectCommandsDeps): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.writing.newBlankProject", () => newBlankProject(deps)),
    vscode.commands.registerCommand("labshelf.writing.refresh", () => deps.projects.reload()),
  );
}

/** Registered by the desktop only: a folder outside the library is reachable by path there, not in a web page. */
export function registerAddExistingFolder(deps: ProjectCommandsDeps): void {
  deps.context.subscriptions.push(vscode.commands.registerCommand("labshelf.writing.addExistingFolder", () => addFolder(deps)));
}
