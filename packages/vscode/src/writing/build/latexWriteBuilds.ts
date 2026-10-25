// Starts a build of the saved file's root after each save of a LaTeX project's sources, while auto compile is on.
import { buildRootOf } from "@labshelf/core";
import * as vscode from "vscode";

import { owningProject, type ReadyProject } from "../buildRootDocument.js";
import type { WritingHost, WritingProjects } from "../session/index.js";
import { autoCompileGate } from "./buildMode.js";
import { type IncludeOnlyTarget } from "./includeOnly.js";

const SOURCE_EXTENSIONS = new Set([".tex", ".bib", ".sty", ".cls"]);
// Editors with auto save write several times a second while typing; one build covers a burst.
const SAVE_DEBOUNCE_MS = 300;

export interface LatexSaveBuildsDeps {
  context: Pick<vscode.ExtensionContext, "subscriptions">;
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "fs">;
  /** Builds `root` of the project; `includeOnly` is the `\include` path to typeset alone. */
  request(projectFolder: string, root: string, includeOnly: string | undefined): Promise<unknown>;
  /** The `\include` path a save builds alone while the preview's include-only toggle is on. */
  includeOnlyTarget?: IncludeOnlyTarget;
}

function latexProjectOf(projects: LatexSaveBuildsDeps["projects"], file: vscode.Uri): ReadyProject | undefined {
  if (file.scheme !== "file") { return undefined; }
  const project = owningProject(projects, file.fsPath);
  return project?.settings.format === "latex" ? project : undefined;
}

export function registerLatexSaveBuilds(deps: LatexSaveBuildsDeps): void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let disposed = false;
  const autoCompile = autoCompileGate(() => deps.host.current()?.logger);

  const requestSave = async (project: ReadyProject, root: string): Promise<void> => {
    try {
      const target = await deps.includeOnlyTarget?.(project, root);
      await deps.request(project.folder, root, target);
    } catch (error) {
      await deps.host.current()?.logger.error("writing/build", error, { projectFolder: project.folder, root, action: "save build" });
    }
  };

  const onSave = async (document: vscode.TextDocument): Promise<void> => {
    if (!SOURCE_EXTENSIONS.has(deps.projects.paths.extname(document.uri.fsPath).toLowerCase())) { return; }
    const project = latexProjectOf(deps.projects, document.uri);
    if (!project || !autoCompile.allows("save")) { return; }
    const folder = project.folder;
    const root = await buildRootOf(deps.projects, folder, project.main ?? "", document.uri.fsPath);
    if (disposed) { return; } // the root resolves asynchronously, possibly after dispose
    const key = `${folder}\0${root}`;
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      void requestSave(project, root);
    }, SAVE_DEBOUNCE_MS));
  };

  deps.context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => { void onSave(document); }),
    autoCompile,
    { dispose: () => { disposed = true; timers.forEach((timer) => clearTimeout(timer)); } },
  );
}
