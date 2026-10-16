// Finds the PDF a project's preview shows: for LaTeX the one its last successful build left next to the main file, for Typst the last live compile.
import * as vscode from "vscode";

import type { ReadyProject } from "../mainDocument.js";
import { typstPreviewPdf } from "../typst/index.js";

/** The PDF's path, or `undefined` when the project has no main file or has not been built. */
export async function builtPdf(project: ReadyProject | undefined): Promise<string | undefined> {
  if (!project?.main) { return undefined; }
  // INVARIANT: `main` is project-relative with "/" separators on every platform.
  const pdf = project.settings.format === "typst"
    ? typstPreviewPdf({ ...project, main: project.main })
    : vscode.Uri.joinPath(vscode.Uri.file(project.folder), `${project.main.replace(/\.[^/.]*$/, "")}.pdf`).fsPath;
  return await vscode.workspace.fs.stat(vscode.Uri.file(pdf)).then(() => pdf, () => undefined);
}
