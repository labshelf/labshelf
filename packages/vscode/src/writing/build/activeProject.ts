// Finds the writing project that owns the file open in the active editor.
import * as vscode from "vscode";

import { owningProject, type ReadyProject } from "../mainDocument.js";
import type { WritingProjects } from "../projectStore.js";

export function activeProject(projects: Pick<WritingProjects, "list" | "paths">): ReadyProject | undefined {
  const file = vscode.window.activeTextEditor?.document.uri;
  return file?.scheme === "file" ? owningProject(projects, file.fsPath) : undefined;
}
