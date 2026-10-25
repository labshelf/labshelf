// Finds the writing project that owns the file open in the active editor.
import * as vscode from "vscode";

import { findOwningProject, type ReadyProject } from "../buildRootDocument.js";
import type { WritingProjects } from "../session/index.js";

export function readActiveProject(projects: Pick<WritingProjects, "list" | "paths">): ReadyProject | undefined {
  const file = vscode.window.activeTextEditor?.document.uri;
  return file?.scheme === "file" ? findOwningProject(projects, file.fsPath) : undefined;
}
