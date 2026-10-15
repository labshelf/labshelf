// Registers the Build Project command and the build that follows every save of a LaTeX project's sources.
import * as path from "node:path";
import * as vscode from "vscode";

import { owningProject } from "../mainDocument.js";
import type { WritingHost, WritingProjects } from "../projectStore.js";
import { BuildDiagnostics } from "./buildDiagnostics.js";
import { LatexBuilds } from "./latexBuilds.js";

export const BUILD_COMMAND = "labshelf.writing.build";

const SOURCE_EXTENSIONS = new Set([".tex", ".bib", ".sty", ".cls"]);
// Editors with auto save write several times a second while typing; one build covers a burst.
const SAVE_DEBOUNCE_MS = 300;

interface LatexBuildDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "list" | "reload">;
}

function latexProjectOf(projects: LatexBuildDeps["projects"], file: vscode.Uri): string | undefined {
  if (file.scheme !== "file") { return undefined; }
  const project = owningProject(projects.list(), file.fsPath);
  return project?.settings.format === "latex" ? project.folder : undefined;
}

async function buildActive(deps: LatexBuildDeps, builds: LatexBuilds): Promise<void> {
  const file = vscode.window.activeTextEditor?.document.uri;
  const project = file?.scheme === "file" ? owningProject(deps.projects.list(), file.fsPath) : undefined;
  if (!project) {
    await vscode.window.showInformationMessage("Open a file of a LaTeX project to build it.");
    return;
  }
  if (project.settings.format !== "latex") {
    await vscode.window.showInformationMessage(`Project "${project.settings.id}" is written in Typst; Research: Build Project compiles LaTeX projects.`);
    return;
  }
  await vscode.workspace.saveAll(false);
  await builds.request(project.folder, "command");
}

export function registerLatexBuild(deps: LatexBuildDeps): void {
  const diagnostics = new BuildDiagnostics();
  const builds = new LatexBuilds({ storageDir: deps.context.globalStorageUri.fsPath, host: deps.host, projects: deps.projects, diagnostics });
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
    diagnostics,
    vscode.commands.registerCommand(BUILD_COMMAND, () => buildActive(deps, builds)),
    vscode.workspace.onDidSaveTextDocument(onSave),
    { dispose: () => { timers.forEach((timer) => clearTimeout(timer)); builds.cancelAll(); } },
  );
}
