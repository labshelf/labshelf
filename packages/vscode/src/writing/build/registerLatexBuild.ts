// Registers the build that follows every save of a LaTeX project's sources.
import * as path from "node:path";
import * as vscode from "vscode";

import { owningProject } from "../mainDocument.js";
import type { WritingHost, WritingProjects } from "../projectStore.js";
import type { BuildPreviews } from "../preview/index.js";
import type { BuildDiagnostics } from "./buildDiagnostics.js";
import { LatexBuilds } from "./latexBuilds.js";

const SOURCE_EXTENSIONS = new Set([".tex", ".bib", ".sty", ".cls"]);
// Editors with auto save write several times a second while typing; one build covers a burst.
const SAVE_DEBOUNCE_MS = 300;

interface LatexBuildDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "list" | "reload">;
  previews: Pick<BuildPreviews, "building" | "finished">;
  diagnostics: Pick<BuildDiagnostics, "publish">;
}

function latexProjectOf(projects: LatexBuildDeps["projects"], file: vscode.Uri): string | undefined {
  if (file.scheme !== "file") { return undefined; }
  const project = owningProject(projects.list(), file.fsPath);
  return project?.settings.format === "latex" ? project.folder : undefined;
}

/** Registers the save listener and returns the builds, which the Build Project command also uses. */
export function registerLatexBuild(deps: LatexBuildDeps): LatexBuilds {
  const builds = new LatexBuilds({ storageDir: deps.context.globalStorageUri.fsPath, host: deps.host, projects: deps.projects, diagnostics: deps.diagnostics, previews: deps.previews });
  const timers = new Map<string, NodeJS.Timeout>();

  const onSave = (document: vscode.TextDocument): void => {
    if (!SOURCE_EXTENSIONS.has(path.extname(document.uri.fsPath).toLowerCase())) { return; }
    const folder = latexProjectOf(deps.projects, document.uri);
    if (!folder) { return; }
    clearTimeout(timers.get(folder));
    timers.set(folder, setTimeout(() => {
      timers.delete(folder);
      void builds.request(folder, "save");
    }, SAVE_DEBOUNCE_MS));
  };

  deps.context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(onSave),
    { dispose: () => { timers.forEach((timer) => clearTimeout(timer)); builds.cancelAll(); } },
  );
  return builds;
}
