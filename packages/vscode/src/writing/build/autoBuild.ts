// Starts LaTeX builds without the Build command: on open, on save, after typing stops, per the auto compile mode; also the LaTeX Workshop notice.
import * as vscode from "vscode";

import { AUTO_COMPILE_MODES, AUTO_SAVE_DELAY_MS, buildRootOf, formatError, type BuildSchedule, type ILogger } from "@labshelf/core";
import { findOwningProject, type ReadyProject } from "../buildRootDocument.js";
import type { WritingHost, WritingProjects } from "../session/index.js";
import type { FindIncludeOnly } from "./includeOnly.js";

const MODULE = "writing/build";
const SECTION = "labshelf.writing";
const KEY = "autoCompile";
const AUTO_COMPILE_MODULE = "AutoCompile";
const DEFAULT_MODE: BuildSchedule = "typing";

/** Configuration is untrusted input: an unknown value reads as the default mode. */
export function readAutoCompileMode(): BuildSchedule {
  const value = vscode.workspace.getConfiguration(SECTION).get<unknown>(KEY, DEFAULT_MODE);
  return AUTO_COMPILE_MODES.find((mode) => mode === value) ?? DEFAULT_MODE;
}

export function onAutoCompileChange(fn: (mode: BuildSchedule) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(`${SECTION}.${KEY}`)) { fn(readAutoCompileMode()); }
  });
}

/** What started the build: "typing" is an edit, "save" is a save or opening the project. */
export type BuildCause = "typing" | "save";

/** Decides per save or edit whether a build may start; when it may not it logs the skip once until the setting changes. */
export function createAutoCompileGate(logger: () => ILogger | undefined): vscode.Disposable & { allows(trigger: BuildCause): boolean } {
  let logged = false;
  const subscription = onAutoCompileChange(() => { logged = false; });
  return {
    allows(trigger): boolean {
      const mode = readAutoCompileMode();
      if (mode === "typing" || (mode === "save" && trigger === "save")) { return true; }
      if (!logged) {
        logged = true;
        void logger()?.log("INFO", AUTO_COMPILE_MODULE, `Auto compile is ${mode}: ${trigger === "typing" ? "edits" : "saves and edits"} start no build; use Build Project or Recompile.`);
      }
      return false;
    },
    dispose: () => subscription.dispose(),
  };
}

export interface LatexOpenBuildDeps {
  context: Pick<vscode.ExtensionContext, "subscriptions">;
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "list" | "onDidChange">;
  request(projectFolder: string, root: string): Promise<unknown>;
}

/** Builds each open LaTeX project once per session, so its PDF matches its sources without waiting for a save. */
export function registerLatexOpenBuild(deps: LatexOpenBuildDeps): void {
  const built = new Set<string>();
  const autoCompile = createAutoCompileGate(() => deps.host.current()?.logger);
  const buildOpened = (): void => {
    const open = new Set((vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath));
    for (const project of deps.projects.list()) {
      if (project.kind !== "ready" || project.settings.format !== "latex" || !project.main) { continue; }
      if (!open.has(project.folder) || built.has(project.folder) || !autoCompile.allows("save")) { continue; }
      built.add(project.folder);
      deps.request(project.folder, project.main).catch((error: unknown) =>
        deps.host.current()?.logger.error(MODULE, error, { projectFolder: project.folder, action: "open build" }));
    }
  };
  deps.context.subscriptions.push(deps.projects.onDidChange(buildOpened), autoCompile);
  buildOpened();
}

export interface LatexTypingWritesDeps {
  context: Pick<vscode.ExtensionContext, "subscriptions">;
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "fs">;
}

function isLatexSource(projects: LatexTypingWritesDeps["projects"], file: vscode.Uri): boolean {
  if (file.scheme !== "file") { return false; }
  return findOwningProject(projects, file.fsPath)?.settings.format === "latex";
}

/** Saves a LaTeX source shortly after typing stops, so the save trigger compiles it, while auto compile is in typing mode. */
export function registerLatexTypingWrites(deps: LatexTypingWritesDeps): void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const autoCompile = createAutoCompileGate(() => deps.host.current()?.logger);

  const saveIfDirty = async (document: vscode.TextDocument): Promise<void> => {
    if (!document.isDirty) { return; }
    try {
      await document.save();
    } catch (error) {
      await deps.host.current()?.logger.error(MODULE, error, { file: document.uri.fsPath, action: "save after typing" });
    }
  };

  deps.context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const { document } = event;
      if (event.contentChanges.length === 0 || !isLatexSource(deps.projects, document.uri) || !autoCompile.allows("typing")) { return; }
      const key = document.uri.fsPath;
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => {
        timers.delete(key);
        void saveIfDirty(document);
      }, AUTO_SAVE_DELAY_MS));
    }),
    autoCompile,
    { dispose: () => timers.forEach((timer) => clearTimeout(timer)) },
  );
}

const SOURCE_EXTENSIONS = new Set([".tex", ".bib", ".sty", ".cls"]);
// Editors with auto save write several times a second while typing; one build covers a burst.
const SAVE_DEBOUNCE_MS = 300;

export interface LatexWriteBuildsDeps {
  context: Pick<vscode.ExtensionContext, "subscriptions">;
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "fs">;
  /** Builds `root` of the project; `includeOnly` is the `\include` path to typeset alone. */
  request(projectFolder: string, root: string, includeOnly: string | undefined): Promise<unknown>;
  /** The `\include` path a save builds alone while the preview's include-only toggle is on. */
  includeOnlyTarget?: FindIncludeOnly;
}

function latexProjectOf(projects: LatexWriteBuildsDeps["projects"], file: vscode.Uri): ReadyProject | undefined {
  if (file.scheme !== "file") { return undefined; }
  const project = findOwningProject(projects, file.fsPath);
  return project?.settings.format === "latex" ? project : undefined;
}

/** Starts a build of the saved file's root after each save of a LaTeX project's sources, while auto compile is on. */
export function registerLatexWriteBuilds(deps: LatexWriteBuildsDeps): void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let disposed = false;
  const autoCompile = createAutoCompileGate(() => deps.host.current()?.logger);

  const requestSave = async (project: ReadyProject, root: string): Promise<void> => {
    try {
      const target = await deps.includeOnlyTarget?.(project, root);
      await deps.request(project.folder, root, target);
    } catch (error) {
      await deps.host.current()?.logger.error(MODULE, error, { projectFolder: project.folder, root, action: "save build" });
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

const LATEX_WORKSHOP_ID = "James-Yu.latex-workshop";
const SHOWN_KEY = "labshelf.writing.latexWorkshopNoticeShown";
const TURN_OFF = "Turn off its auto build";

interface NoticeDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "list" | "paths">;
}

async function turnOffAutoBuild(host: WritingHost): Promise<void> {
  const logger = host.current()?.logger;
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  try {
    await vscode.workspace.getConfiguration("latex-workshop").update("latex.autoBuild.run", "never", target);
    await logger?.log("INFO", MODULE, "Turned off LaTeX Workshop auto build", { target });
  } catch (error) {
    await logger?.error(MODULE, error, { action: "turn-off-latex-workshop-auto-build", target });
    await vscode.window.showErrorMessage(
      `LaTeX Workshop's auto build could not be turned off: ${formatError(error)}`,
    );
  }
}

async function showNotice(deps: NoticeDeps): Promise<void> {
  // Set before the message resolves so a second editor change cannot show it again while it is open.
  await deps.context.workspaceState.update(SHOWN_KEY, true);
  const choice = await vscode.window.showInformationMessage(
    "LaTeX Workshop is also installed. LabShelf builds, previews and reports errors for LabShelf projects, so both would build on save.",
    TURN_OFF,
  );
  await deps.host.current()?.logger.log("INFO", MODULE, "LaTeX Workshop notice answered", { choice: choice ?? "dismissed" });
  if (choice === TURN_OFF) { await turnOffAutoBuild(deps.host); }
}

/** Tells the user once per workspace that LaTeX Workshop builds on save too, and offers to turn that off. */
export function registerLatexWorkshopNotice(deps: NoticeDeps): void {
  const check = (): void => {
    if (deps.context.workspaceState.get<boolean>(SHOWN_KEY)) { return; }
    if (!vscode.extensions.getExtension(LATEX_WORKSHOP_ID)) { return; }
    const file = vscode.window.activeTextEditor?.document.uri;
    const project = file?.scheme === "file" ? findOwningProject(deps.projects, file.fsPath) : undefined;
    if (project?.settings.format === "latex") { void showNotice(deps); }
  };
  deps.context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(check));
  check();
}
