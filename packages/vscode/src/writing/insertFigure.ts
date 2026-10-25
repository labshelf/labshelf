// Inserts a figure for an image the user picks, copying the image into the project when it lies outside.
import * as vscode from "vscode";

import { IMAGE_EXTENSIONS, IMAGE_FOLDER, freeImageName, imageBaseFolder, imageSnippet, type ILogger } from "@labshelf/core";

import { isInside, owningProject, type ProjectLookup, type ReadyProject } from "./buildRootDocument.js";
import type { WritingLanguage } from "./editorLanguage.js";

async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

/** Copies into the project's images folder under a free name; an existing file is never overwritten. */
async function copyIntoProject(projects: ProjectLookup, project: ReadyProject, source: string): Promise<string> {
  const { paths } = projects;
  const folder = paths.join(project.folder, IMAGE_FOLDER);
  const target = await freeImageName(paths, folder, paths.basename(source), (path) => exists(vscode.Uri.file(path)));
  await vscode.workspace.fs.copy(vscode.Uri.file(source), vscode.Uri.file(target), { overwrite: false });
  return target;
}

export async function insertImage(editor: vscode.TextEditor, language: WritingLanguage, projects: ProjectLookup, logger: ILogger | undefined): Promise<void> {
  const documentPath = editor.document.uri.fsPath;
  const project = owningProject(projects, documentPath);
  if (!project) { return; }
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: vscode.Uri.file(project.folder),
    filters: { Images: IMAGE_EXTENSIONS[language] },
    openLabel: "Insert Image",
  });
  const source = picked?.[0]?.fsPath;
  if (!source) { return; }
  const { paths } = projects;
  let image = source;
  if (!isInside(paths, project.folder, source)) {
    try {
      image = await copyIntoProject(projects, project, source);
      await logger?.log("INFO", "writing/editorActions", "Copied an image into the project", { source, image });
    } catch (error) {
      await logger?.log("ERROR", "writing/editorActions", "Could not copy the image into the project", { source, folder: project.folder, error: String(error) });
      void vscode.window.showErrorMessage(`Could not copy the image into the project: ${String(error)}`);
      return;
    }
  }
  const relative = paths.relative(imageBaseFolder(language, project.folder, project.main, documentPath, paths), image).split(paths.sep).join("/");
  await editor.insertSnippet(new vscode.SnippetString(imageSnippet(language, relative)));
}
