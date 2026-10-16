// Registers the commands that add a writing project: New project and Add existing folder.
import * as vscode from "vscode";

import { PROJECT_FILE, detectFormat, type ProjectFormat } from "@labshelf/core";
import { addExistingFolder, createProject, rootFileNames } from "@labshelf/core/node";
import { executeSafely } from "../commands/index.js";
import { openProjectMain } from "./openProjectMain.js";
import type { WritingHost, WritingProjects } from "./projectStore.js";

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

async function newProject({ host, projects }: ProjectCommandsDeps): Promise<void> {
  const session = await host.require();
  if (!session) { return; }
  await executeSafely(session.logger, "labshelf.writing.newProject", async () => {
    const title = (await vscode.window.showInputBox({ prompt: "Project title", placeHolder: "Deep nets survey" }))?.trim();
    if (!title) { return; }
    const format = await pickFormat("Format of the new project");
    if (!format) { return; }
    const entry = await createProject(session.root, { title, format }, session.logger);
    await projects.reload();
    await openProjectMain(projects.paths, entry);
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
    const names = await rootFileNames(folder);
    // Core keeps an existing labshelf.yaml and ignores the format, so the user is not asked for it.
    const format = detectFormat(names)
      ?? (names.includes(PROJECT_FILE) ? "latex" : await pickFormat("This folder has no .tex or .typ file. Which format is the project?"));
    if (!format) { return; }
    await addExistingFolder(session.root, { folder, format }, session.logger);
    await projects.reload();
  });
}

export function registerProjectCommands(deps: ProjectCommandsDeps): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.writing.newProject", () => newProject(deps)),
    vscode.commands.registerCommand("labshelf.writing.addExistingFolder", () => addFolder(deps)),
    vscode.commands.registerCommand("labshelf.writing.refresh", () => deps.projects.reload()),
  );
}
