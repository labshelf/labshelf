// Finds the active file editor when it shows a file of the project, and the build root that editor focuses.
import * as vscode from "vscode";

import type { PathOps } from "@labshelf/core";
import { isInside, type ReadyProject } from "../../mainDocument.js";
import type { BuildRootOf } from "../../nodePort/index.js";

/** The active editor, or `undefined` when there is none or its file is not inside the project folder. */
export function activeProjectEditor(paths: PathOps, folder: string): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  const uri = editor?.document.uri;
  return editor && uri?.scheme === "file" && isInside(paths, folder, uri.fsPath) ? editor : undefined;
}

/** The root the active project editor builds into; the project's main root when no project file is active. */
export async function focusedRoot(paths: PathOps, buildRootOf: BuildRootOf, project: ReadyProject): Promise<string> {
  const main = project.main ?? "";
  const editor = activeProjectEditor(paths, project.folder);
  return editor ? await buildRootOf(project.folder, main, editor.document.uri.fsPath) : main;
}
