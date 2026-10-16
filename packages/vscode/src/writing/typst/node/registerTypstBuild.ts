// Registers the Typst compiles: live into an open preview while the user types, and a build after every save of a Typst project's files.
import * as vscode from "vscode";

import { owningProject, type ReadyProject } from "../../mainDocument.js";
import type { WritingHost, WritingProjects } from "../../projectStore.js";
import { TypstBuilds, type TypstBuildsDeps } from "./typstBuilds.js";
import { TypstCompilerHost } from "./typstCompilerHost.js";

// Short enough to follow typing, long enough that a burst of keystrokes costs one compile.
const LIVE_DEBOUNCE_MS = 150;
const SAVE_DEBOUNCE_MS = 300;

interface TypstBuildRegistration extends Omit<TypstBuildsDeps, "compiler"> {
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
  const builds = new TypstBuilds({ ...deps, compiler: new TypstCompilerHost(deps.context.globalStorageUri.fsPath) });
  const timers = new Map<string, NodeJS.Timeout>();
  const schedule = (folder: string, trigger: "live" | "save", delay: number): void => {
    clearTimeout(timers.get(folder));
    timers.set(folder, setTimeout(() => {
      timers.delete(folder);
      void builds.request(folder, trigger);
    }, delay));
  };

  deps.context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length === 0) { return; }
      const project = typstProjectOf(deps.projects, event.document.uri);
      if (project && deps.hasPreview(project.folder)) { schedule(project.folder, "live", LIVE_DEBOUNCE_MS); }
    }),
    // Any saved file can be an image, a .bib or a data file the document reads.
    vscode.workspace.onDidSaveTextDocument((document) => {
      const project = typstProjectOf(deps.projects, document.uri);
      if (project) { schedule(project.folder, "save", SAVE_DEBOUNCE_MS); }
    }),
    { dispose: () => timers.forEach((timer) => clearTimeout(timer)) },
  );
  return builds;
}
