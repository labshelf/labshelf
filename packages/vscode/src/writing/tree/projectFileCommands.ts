// Registers the Files view commands that create, rename and delete files and folders of the open project.
import * as vscode from "vscode";

import { formatError, type ILogger, type LibraryFileSystem } from "@labshelf/core";
import type { ProjectSession } from "../session/index.js";
import { createProjectFolderUri, type ProjectFileNode } from "./projectFilesProvider.js";

const MODULE = "writing/tree";

interface ProjectFileCommandsDeps {
  context: vscode.ExtensionContext;
  session: Pick<ProjectSession, "project">;
  logger: ILogger;
  fs: Pick<LibraryFileSystem, "writeFile">;
}

const uriBaseName = (uri: vscode.Uri): string => uri.path.split("/").pop() ?? uri.path;

/** Rejects names that would leave the target folder or name nothing. */
function invalidFileName(value: string): string | undefined {
  const name = value.trim();
  if (!name) { return "Enter a name."; }
  if (/[\\/]/.test(name)) { return "A name cannot contain / or \\."; }
  if (name === "." || name === "..") { return "Enter a file or folder name."; }
  return undefined;
}

async function askName(prompt: string, value?: string): Promise<string | undefined> {
  // Selects the name without its extension, as the Explorer does.
  const dot = value?.lastIndexOf(".") ?? -1;
  const name = await vscode.window.showInputBox({
    prompt, validateInput: invalidFileName, ...(value ? { value, valueSelection: [0, dot > 0 ? dot : value.length] as [number, number] } : {}),
  });
  return name === undefined || invalidFileName(name) ? undefined : name.trim();
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Runs one file operation; logs and shows its failure. `true` when it succeeded. */
async function run(logger: ILogger, action: string, uri: vscode.Uri, operation: () => Thenable<void>): Promise<boolean> {
  try {
    await operation();
    await logger.log("INFO", MODULE, `Project file ${action}`, { uri: uri.fsPath });
    return true;
  } catch (error) {
    await logger.error(MODULE, error, { action, uri: uri.fsPath });
    void vscode.window.showErrorMessage(`Could not ${action} ${uriBaseName(uri)}: ${formatError(error)}`);
    return false;
  }
}

/** Asks for a name inside the clicked folder, or the project folder when called from the view title. */
async function create(deps: ProjectFileCommandsDeps, kind: "file" | "folder", target?: ProjectFileNode): Promise<void> {
  const project = deps.session.project;
  if (!project) { return; }
  const name = await askName(kind === "file" ? "New file name" : "New folder name");
  if (!name) { return; }
  const uri = vscode.Uri.joinPath(target?.uri ?? createProjectFolderUri(project), name);
  if (await exists(uri)) {
    void vscode.window.showErrorMessage(`${name} already exists.`);
    return;
  }
  if (kind === "folder") {
    await run(deps.logger, "create folder", uri, () => vscode.workspace.fs.createDirectory(uri));
  } else if (await run(deps.logger, "create file", uri, () => deps.fs.writeFile(uri.fsPath, new Uint8Array()))) {
    await vscode.commands.executeCommand("vscode.open", uri);
  }
}

async function rename(deps: ProjectFileCommandsDeps, target: ProjectFileNode): Promise<void> {
  const name = await askName("New name", uriBaseName(target.uri));
  if (!name || name === uriBaseName(target.uri)) { return; }
  const renamed = vscode.Uri.joinPath(target.uri, "..", name);
  await run(deps.logger, "rename", target.uri, () => vscode.workspace.fs.rename(target.uri, renamed, { overwrite: false }));
}

async function remove(deps: ProjectFileCommandsDeps, target: ProjectFileNode): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    `Delete ${uriBaseName(target.uri)}?`, { modal: true, detail: "It moves to the trash." }, "Delete",
  );
  if (choice !== "Delete") { return; }
  await run(deps.logger, "delete", target.uri, () => vscode.workspace.fs.delete(target.uri, { recursive: true, useTrash: true }));
}

export function registerProjectFileCommands(deps: ProjectFileCommandsDeps): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.writing.newFile", (target?: ProjectFileNode) => create(deps, "file", target)),
    vscode.commands.registerCommand("labshelf.writing.newFolder", (target?: ProjectFileNode) => create(deps, "folder", target)),
    vscode.commands.registerCommand("labshelf.writing.renameFile", (target: ProjectFileNode) => rename(deps, target)),
    vscode.commands.registerCommand("labshelf.writing.deleteFile", (target: ProjectFileNode) => remove(deps, target)),
  );
}
