// Registers the build that follows every save of a LaTeX project's sources.
import { buildRootOf } from "@labshelf/core/node";
import * as vscode from "vscode";

import { owningProject, type ReadyProject } from "../../mainDocument.js";
import type { WritingHost, WritingProjects } from "../../session/index.js";
import type { BuildPreviews } from "../../preview/index.js";
import type { BuildDiagnostics } from "../buildDiagnostics.js";
import { LatexBuilds } from "./latexBuilds.js";

const SOURCE_EXTENSIONS = new Set([".tex", ".bib", ".sty", ".cls"]);
// Editors with auto save write several times a second while typing; one build covers a burst.
const SAVE_DEBOUNCE_MS = 300;

interface LatexBuildDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "reload">;
  previews: Pick<BuildPreviews, "building" | "finished">;
  diagnostics: Pick<BuildDiagnostics, "publish">;
}

function latexProjectOf(projects: LatexBuildDeps["projects"], file: vscode.Uri): ReadyProject | undefined {
  if (file.scheme !== "file") { return undefined; }
  const project = owningProject(projects, file.fsPath);
  return project?.settings.format === "latex" ? project : undefined;
}

/** Registers the save listener and returns the builds, which the Build Project command also uses. */
export function registerLatexBuild(deps: LatexBuildDeps): LatexBuilds {
  const builds = new LatexBuilds({ storageDir: deps.context.globalStorageUri.fsPath, host: deps.host, projects: deps.projects, diagnostics: deps.diagnostics, previews: deps.previews });
  const timers = new Map<string, NodeJS.Timeout>();
  let disposed = false;

  const onSave = async (document: vscode.TextDocument): Promise<void> => {
    if (!SOURCE_EXTENSIONS.has(deps.projects.paths.extname(document.uri.fsPath).toLowerCase())) { return; }
    const project = latexProjectOf(deps.projects, document.uri);
    if (!project) { return; }
    const folder = project.folder;
    const root = await buildRootOf(folder, project.main ?? "", document.uri.fsPath);
    if (disposed) { return; } // the root resolves asynchronously, possibly after dispose
    const key = `${folder}\0${root}`;
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      void builds.request(folder, root, "save");
    }, SAVE_DEBOUNCE_MS));
  };

  deps.context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => { void onSave(document); }),
    { dispose: () => { disposed = true; timers.forEach((timer) => clearTimeout(timer)); builds.cancelAll(); } },
  );
  return builds;
}
