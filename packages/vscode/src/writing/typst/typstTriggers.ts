// Starts Typst compiles from the editor: live into an open preview while the user types, and a build after every save of a project's files; records the Typst version a build used.
import { buildRootOf } from "@labshelf/core";
import { TYPST_VERSION } from "@labshelf/core/typst";
import * as vscode from "vscode";

import { createAutoCompileGate } from "../build/index.js";
import type { BuildTrigger } from "../build/index.js";
import { findOwningProject, type ReadyProject } from "../buildRootDocument.js";
import type { WritingHost, WritingProjects } from "../session/index.js";

/** "live" compiles unsaved text for the preview only; the others write `<root>.pdf` from the saved files. */
export type TypstTrigger = BuildTrigger | "live";

// Short enough to follow typing, long enough that a burst of keystrokes costs one compile.
const MODULE = "writing/typst";

const LIVE_DEBOUNCE_MS = 150;
const SAVE_DEBOUNCE_MS = 300;

export interface TypstTriggerDeps {
  context: Pick<vscode.ExtensionContext, "subscriptions">;
  host: Pick<WritingHost, "current">;
  projects: WritingProjects;
  hasPreview(projectFolder: string): boolean;
  request(projectFolder: string, root: string, trigger: "live" | "save"): unknown;
}

function typstProjectOf(projects: WritingProjects, file: vscode.Uri): ReadyProject | undefined {
  if (file.scheme !== "file") { return undefined; }
  const project = findOwningProject(projects, file.fsPath);
  return project?.settings.format === "typst" ? project : undefined;
}

export function registerTypstTriggers(deps: TypstTriggerDeps): void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let disposed = false;
  const autoCompile = createAutoCompileGate(() => deps.host.current()?.logger);
  const schedule = async (project: ReadyProject, file: vscode.Uri, trigger: "live" | "save", delay: number): Promise<void> => {
    if (!autoCompile.allows(trigger === "live" ? "typing" : "save")) { return; }
    const folder = project.folder;
    const root = await buildRootOf(deps.projects, folder, project.main ?? "", file.fsPath);
    if (disposed) { return; } // the root resolves asynchronously, possibly after dispose
    const key = `${folder}\0${root}`;
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      void deps.request(folder, root, trigger);
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
}

interface VersionPinDeps {
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "data" | "reload">;
}

/** Folders already warned about in this session, so a project warns once however often it builds. */
const warnedFolders = new Set<string>();

function warnOnce(project: ReadyProject, recorded: string): void {
  if (warnedFolders.has(project.folder)) { return; }
  warnedFolders.add(project.folder);
  void vscode.window.showWarningMessage(
    `Project "${project.settings.id}" was last built with Typst ${recorded}; LabShelf compiles it with Typst ${TYPST_VERSION}. Check the PDF for differences.`,
  );
}

/** Called after every successful Typst build; writes labshelf.yaml only when the recorded version differs. */
export async function writeTypstVersion(project: ReadyProject, deps: VersionPinDeps): Promise<void> {
  const recorded = project.settings.typst;
  if (recorded === TYPST_VERSION) { return; }
  const logger = deps.host.current()?.logger;
  if (recorded !== undefined) { warnOnce(project, recorded); }
  if (!logger) { return; }
  try {
    await deps.projects.data.updateProjectSettings(project.folder, { typst: TYPST_VERSION });
    await deps.projects.reload();
  } catch (error) {
    await logger.error(MODULE, error, { action: "record-typst-version", folder: project.folder });
  }
}
