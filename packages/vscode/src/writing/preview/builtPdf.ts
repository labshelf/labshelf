// Finds the PDF the preview shows for a root: for LaTeX the one its last successful build left next to the root file, for Typst the last live compile.
import * as vscode from "vscode";

import { typstPreviewPdf } from "@labshelf/core";
import { builtPdfPath } from "@labshelf/core/node";
import type { ReadyProject } from "../mainDocument.js";
import type { WritingProjects } from "../session/index.js";

/** The PDF's path, or `undefined` when there is no root or it has not been built. */
export async function builtPdf(projects: Pick<WritingProjects, "data" | "paths">, project: ReadyProject | undefined, root: string | undefined): Promise<string | undefined> {
  if (!project || !root) { return undefined; }
  // INVARIANT: `root` is project-relative with "/" separators on every platform.
  const pdf = project.settings.format === "typst"
    ? typstPreviewPdf(project, root, projects.data, projects.paths)
    : builtPdfPath(project, root);
  if (!pdf) { return undefined; }
  return await vscode.workspace.fs.stat(vscode.Uri.file(pdf)).then(() => pdf, () => undefined);
}
