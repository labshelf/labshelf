// Finds the raw build log of a LaTeX root in the project's build folder, when the build kept one.
import * as vscode from "vscode";

import { deriveBuildRootFolder, type PathOps, type ProjectContentPort } from "@labshelf/core";
import type { ReadyProject } from "../../buildRootDocument.js";

export interface RawLogDeps {
  paths: PathOps;
  data: Pick<ProjectContentPort, "projectBuildDir">;
}

/** The `.log` path of the root, or `undefined` for Typst (it has no log) and when the file does not exist. */
export async function readRawLogFile(deps: RawLogDeps, project: ReadyProject, root: string): Promise<string | undefined> {
  if (project.settings.format !== "latex") { return undefined; }
  const { paths } = deps;
  const base = paths.basename(root).replace(/\.[^/.]*$/, "");
  const file = paths.join(deps.data.projectBuildDir(project.settings.id), deriveBuildRootFolder(root), `${base}.log`);
  return await vscode.workspace.fs.stat(vscode.Uri.file(file)).then(() => file, () => undefined);
}
