// Starts one build of the main file of the LaTeX project open as a workspace folder, once the projects have loaded.
import * as vscode from "vscode";

import type { WritingHost, WritingProjects } from "../../session/index.js";
import { autoCompileGate } from "../options/index.js";

export interface LatexOpenBuildDeps {
  context: Pick<vscode.ExtensionContext, "subscriptions">;
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "list" | "onDidChange">;
  request(projectFolder: string, root: string): Promise<unknown>;
}

/** Builds each open LaTeX project once per session, so its PDF matches its sources without waiting for a save. */
export function registerLatexOpenBuild(deps: LatexOpenBuildDeps): void {
  const built = new Set<string>();
  const autoCompile = autoCompileGate(() => deps.host.current()?.logger);
  const buildOpened = (): void => {
    const open = new Set((vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath));
    for (const project of deps.projects.list()) {
      if (project.kind !== "ready" || project.settings.format !== "latex" || !project.main) { continue; }
      if (!open.has(project.folder) || built.has(project.folder) || !autoCompile.allows("save")) { continue; }
      built.add(project.folder);
      deps.request(project.folder, project.main).catch((error: unknown) =>
        deps.host.current()?.logger.error("writing/build", error, { projectFolder: project.folder, action: "open build" }));
    }
  };
  deps.context.subscriptions.push(deps.projects.onDidChange(buildOpened), autoCompile);
  buildOpened();
}
