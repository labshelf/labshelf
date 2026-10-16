// Finds the raw build log of a LaTeX root in the project's build folder, when the build kept one.
import * as vscode from "vscode";

import { rootBuildFolder, type PathOps, type ProjectDataPort } from "@labshelf/core";
import type { ReadyProject } from "../../mainDocument.js";

export interface RawLogDeps {
  paths: PathOps;
  data: Pick<ProjectDataPort, "projectBuildDir">;
}

/** The `.log` path of the root, or `undefined` for Typst (it has no log) and when the file does not exist. */
export async function rawLogFile(deps: RawLogDeps, project: ReadyProject, root: string): Promise<string | undefined> {
  if (project.settings.format !== "latex") { return undefined; }
  const { paths } = deps;
  const base = paths.basename(root).replace(/\.[^/.]*$/, "");
  const file = paths.join(deps.data.projectBuildDir(project.settings.id), rootBuildFolder(root), `${base}.log`);
  return await vscode.workspace.fs.stat(vscode.Uri.file(file)).then(() => file, () => undefined);
}
