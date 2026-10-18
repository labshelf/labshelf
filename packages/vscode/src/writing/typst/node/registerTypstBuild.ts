// Registers the Typst compiles: live into an open preview while the user types, and a build after every save of a Typst project's files.
import { buildRootOf } from "@labshelf/core";
import { ProjectBuildQueue } from "@labshelf/core/node";
import * as vscode from "vscode";

import { owningProject, type ReadyProject } from "../../mainDocument.js";
import type { WritingHost, WritingProjects } from "../../session/index.js";
import { autoCompileGate } from "../../build/options/index.js";
import { projectBuildDeps } from "../../build/node/index.js";
import { TypstBuilds, type TypstBuildsDeps } from "./typstBuilds.js";
import { TypstCompilerHost } from "./typstCompilerHost.js";

// Short enough to follow typing, long enough that a burst of keystrokes costs one compile.
const LIVE_DEBOUNCE_MS = 150;
const SAVE_DEBOUNCE_MS = 300;

interface TypstBuildRegistration extends Omit<TypstBuildsDeps, "queue" | "buildDeps"> {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: WritingProjects;
  hasPreview: (projectFolder: string) => boolean;
}

function typstProjectOf(projects: WritingProjects, file: vscode.Uri): ReadyProject | undefined {
  if (file.scheme !== "file") { return undefined; }
  const project = owningProject(projects, file.fsPath);
  return project?.settings.format === "typst" ? project : undefined;
}

/** Registers the listeners and returns the builds, which the Build Project command also uses. */
export function registerTypstBuild(deps: TypstBuildRegistration): TypstBuilds {
  const storageDir = deps.context.globalStorageUri.fsPath;
  const buildDeps = projectBuildDeps({ host: deps.host, projects: deps.projects, storageDir, typst: new TypstCompilerHost(storageDir) });
  const builds = new TypstBuilds({ ...deps, buildDeps, queue: new ProjectBuildQueue(buildDeps) });
  const timers = new Map<string, NodeJS.Timeout>();
  let disposed = false;
  const autoCompile = autoCompileGate(() => deps.host.current()?.logger);
  const schedule = async (project: ReadyProject, file: vscode.Uri, trigger: "live" | "save", delay: number): Promise<void> => {
    if (!autoCompile.allows()) { return; }
    const folder = project.folder;
    const root = await buildRootOf(deps.projects, folder, project.main ?? "", file.fsPath);
    if (disposed) { return; } // the root resolves asynchronously, possibly after dispose
    const key = `${folder}\0${root}`;
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      void builds.request(folder, root, trigger);
    }, delay));
  };

  deps.context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length === 0) { return; }
      const project = typstProjectOf(deps.projects, event.document.uri);
      if (project && deps.hasPreview(project.folder)) { void schedule(project, event.document.uri, "live", LIVE_DEBOUNCE_MS); }
    }),
    // Any saved file can be an image, a .bib or a data file the document reads.
    vscode.workspace.onDidSaveTextDocument((document) => {
      const project = typstProjectOf(deps.projects, document.uri);
      if (project) { void schedule(project, document.uri, "save", SAVE_DEBOUNCE_MS); }
    }),
    autoCompile,
    { dispose: () => { disposed = true; timers.forEach((timer) => clearTimeout(timer)); } },
  );
  return builds;
}
