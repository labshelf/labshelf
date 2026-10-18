// Registers the build that follows every save of a LaTeX project's sources.
import { buildRootOf } from "@labshelf/core";
import { ProjectBuildQueue } from "@labshelf/core/node";
import * as vscode from "vscode";

import { owningProject, type ReadyProject } from "../../mainDocument.js";
import type { WritingHost, WritingProjects } from "../../session/index.js";
import type { BuildPreviews } from "../../preview/index.js";
import type { BuildDiagnostics } from "../buildDiagnostics.js";
import { autoCompileGate } from "../options/index.js";
import { LatexBuilds } from "./latexBuilds.js";
import { projectBuildDeps } from "./projectBuildDeps.js";
import type { IncludeOnlyTarget } from "../options/index.js";

const SOURCE_EXTENSIONS = new Set([".tex", ".bib", ".sty", ".cls"]);
// Editors with auto save write several times a second while typing; one build covers a burst.
const SAVE_DEBOUNCE_MS = 300;

interface LatexBuildDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "fs" | "reload">;
  previews: Pick<BuildPreviews, "building" | "finished">;
  diagnostics: Pick<BuildDiagnostics, "publish">;
  /** The `\include` path a save builds alone while the preview's include-only toggle is on. */
  includeOnlyTarget?: IncludeOnlyTarget;
}

function latexProjectOf(projects: LatexBuildDeps["projects"], file: vscode.Uri): ReadyProject | undefined {
  if (file.scheme !== "file") { return undefined; }
  const project = owningProject(projects, file.fsPath);
  return project?.settings.format === "latex" ? project : undefined;
}

/** Registers the save listener and returns the builds, which the Build Project command also uses. */
export function registerLatexBuild(deps: LatexBuildDeps): LatexBuilds {
  const queue = new ProjectBuildQueue(projectBuildDeps({
    host: deps.host, projects: deps.projects, storageDir: deps.context.globalStorageUri.fsPath,
    // INVARIANT: this queue only builds LaTeX projects (latexProjectOf), so the Typst compiler is never requested.
    typst: { get: () => Promise.reject(new Error("The LaTeX build queue does not compile Typst projects.")) },
  }));
  const builds = new LatexBuilds({ host: deps.host, projects: deps.projects, queue, diagnostics: deps.diagnostics, previews: deps.previews });
  const timers = new Map<string, NodeJS.Timeout>();
  let disposed = false;
  const autoCompile = autoCompileGate(() => deps.host.current()?.logger);

  const requestSave = async (project: ReadyProject, root: string): Promise<void> => {
    try {
      const target = await deps.includeOnlyTarget?.(project, root);
      await builds.request(project.folder, root, "save", target);
    } catch (error) {
      await deps.host.current()?.logger.error("writing/build", error, { projectFolder: project.folder, root, action: "save build" });
    }
  };

  const onSave = async (document: vscode.TextDocument): Promise<void> => {
    if (!SOURCE_EXTENSIONS.has(deps.projects.paths.extname(document.uri.fsPath).toLowerCase())) { return; }
    const project = latexProjectOf(deps.projects, document.uri);
    if (!project || !autoCompile.allows()) { return; }
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
    { dispose: () => { disposed = true; timers.forEach((timer) => clearTimeout(timer)); builds.cancelAll(); } },
  );
  return builds;
}
