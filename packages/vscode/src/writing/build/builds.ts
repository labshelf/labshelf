// Holds what a build leaves and takes: the listener types, last outcome per project, Problems entries, build options, the builder types and the Build Project command.
import * as vscode from "vscode";

import type { BuildSchedule, BuildOptions, FinishedBuild, LatexEngine, LocatedProblem, ProjectFormat } from "@labshelf/core";
import type { ActiveSource } from "../activeSource.js";
import { findOwningProject, type ReadyProject } from "../projects/index.js";
import type { BuildRootOf, WritingProjects } from "../projects/index.js";
import { readAutoCompileMode } from "./autoBuild.js";
import { writeEngine, type WriteEngineDeps } from "./toolchain.js";

const MODULE = "BuildOptions";

export type BuildTrigger = "command" | "save" | "focus";

/**
 * Told when the compile of a project's root starts and when it ends; a cancelled compile never ends, the next one replaces it.
 * `root` is the compiled file relative to the project folder.
 */
export interface BuildListener {
  building(projectFolder: string, root: string): void;
  finished(project: ReadyProject, root: string, result: FinishedBuild, trigger: BuildTrigger): void;
}

/** The builder each project format offers to commands that need a fresh build. */
export type ProjectBuilders = Record<ProjectFormat, { request(projectFolder: string, root: string, trigger: "command" | "focus", includeOnly?: string): Promise<{ status: string } | undefined> }>;

export interface BuildOutcome { ok: boolean; at: Date }

/** Remembers whether the last build of each project folder succeeded, and when, for the session. */
export class BuildOutcomes implements BuildListener, vscode.Disposable {
  private readonly outcomes = new Map<string, BuildOutcome>();
  private readonly changeEmitter = new vscode.EventEmitter<string>();
  /** Fires with the project folder whose build just finished. */
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly now: () => Date = () => new Date()) {}

  last(folder: string): BuildOutcome | undefined {
    return this.outcomes.get(folder);
  }

  // A build in progress changes nothing the Projects view shows.
  building(_projectFolder: string, _root: string): void {}

  finished(project: ReadyProject, _root: string, result: FinishedBuild, _trigger: BuildTrigger): void {
    this.outcomes.set(project.folder, { ok: result.status === "succeeded", at: this.now() });
    this.changeEmitter.fire(project.folder);
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}

/** Holds a diagnostic collection whose entries belong to owners (a project or a build root), so an owner's new entries replace only its own. */
export class ProjectProblems implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly filesByOwner = new Map<string, vscode.Uri[]>();

  constructor(name: string) {
    this.collection = vscode.languages.createDiagnosticCollection(name);
  }

  /** Clears what `owner` published before, then shows `byFile` (absolute file path to its diagnostics). */
  replace(owner: string, byFile: ReadonlyMap<string, vscode.Diagnostic[]>): void {
    for (const uri of this.filesByOwner.get(owner) ?? []) { this.collection.delete(uri); }
    const uris: vscode.Uri[] = [];
    for (const [file, diagnostics] of byFile) {
      const uri = vscode.Uri.file(file);
      this.collection.set(uri, diagnostics);
      uris.push(uri);
    }
    this.filesByOwner.set(owner, uris);
  }

  dispose(): void {
    this.collection.dispose();
  }
}

const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
} as const;

function diagnostic(problem: LocatedProblem): vscode.Diagnostic {
  const line = Math.max(0, (problem.line ?? 1) - 1);
  const message = problem.hint ? `${problem.message}\n${problem.hint}` : problem.message;
  const result = new vscode.Diagnostic(new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER), message, SEVERITY[problem.severity]);
  result.source = "LabShelf";
  return result;
}

/** Shows each build root's problems in the Problems panel and replaces them on the next build of that root. */
export class BuildProblems implements vscode.Disposable {
  private readonly diagnostics = new ProjectProblems("labshelf-latex");

  /** `rootPath` is the absolute path of the compiled root; each root's problems replace only its own. */
  publish(rootPath: string, problems: readonly LocatedProblem[]): void {
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const problem of problems) {
      byFile.set(problem.file, [...byFile.get(problem.file) ?? [], diagnostic(problem)]);
    }
    this.diagnostics.replace(rootPath, byFile);
  }

  dispose(): void {
    this.diagnostics.dispose();
  }
}

/** Reads the setting that stops a LaTeX build at its first error. */
export function shouldHaltOnError(): boolean {
  return vscode.workspace.getConfiguration("labshelf.writing").get<unknown>("haltOnError", false) === true;
}

/** The engine is absent for Typst and null for a LaTeX project that has not chosen one (its first build asks). */
export function buildOptions(project: ReadyProject): Omit<BuildOptions, "includeOnly"> {
  const { settings } = project;
  return { autoCompile: readAutoCompileMode(), ...(settings.format === "latex" ? { engine: settings.engine ?? null, haltOnError: shouldHaltOnError() } : {}) };
}

export function setAutoCompile(mode: BuildSchedule): Thenable<void> {
  return vscode.workspace.getConfiguration("labshelf.writing").update("autoCompile", mode, vscode.ConfigurationTarget.Global);
}

export function setHaltOnError(on: boolean): Thenable<void> {
  return vscode.workspace.getConfiguration("labshelf.writing").update("haltOnError", on, vscode.ConfigurationTarget.Global);
}

export async function setEngine(deps: WriteEngineDeps, project: ReadyProject, engine: LatexEngine): Promise<boolean> {
  const saved = await writeEngine(deps, project, engine);
  if (!saved) { void deps.host.current()?.logger.log("WARN", MODULE, `The ${engine} engine could not be saved for ${project.folder}.`, { engine, folder: project.folder }); }
  return saved;
}

/** The file of the focused source editor: from `activeSource` (native or LabShelf) when given, else the active text editor. */
function readActiveSourceFile(activeSource?: Pick<ActiveSource, "current">): vscode.Uri | undefined {
  return activeSource ? activeSource.current()?.uri : vscode.window.activeTextEditor?.document.uri;
}

/** Finds the writing project that owns the file open in the focused source editor. */
export function readActiveProject(projects: Pick<WritingProjects, "list" | "paths">, activeSource?: Pick<ActiveSource, "current">): ReadyProject | undefined {
  const file = readActiveSourceFile(activeSource);
  return file?.scheme === "file" ? findOwningProject(projects, file.fsPath) : undefined;
}

export const BUILD_COMMAND = "labshelf.writing.build";

interface BuildCommandDeps {
  context: vscode.ExtensionContext;
  projects: Pick<WritingProjects, "list" | "paths">;
  builders: ProjectBuilders;
  buildRootOf: BuildRootOf;
  /** The focused source editor, native or LabShelf. */
  activeSource: Pick<ActiveSource, "current">;
}

async function buildActive(deps: BuildCommandDeps): Promise<void> {
  const project = readActiveProject(deps.projects, deps.activeSource);
  if (!project) {
    await vscode.window.showInformationMessage("Open a file of a writing project to build it.");
    return;
  }
  await vscode.workspace.saveAll(false);
  const main = project.main ?? "";
  const file = readActiveSourceFile(deps.activeSource)?.fsPath;
  const root = file ? await deps.buildRootOf(project.folder, main, file) : main;
  await deps.builders[project.settings.format].request(project.folder, root, "command");
}

/** Registers Build Project: saves every editor and builds the active file's project with the builder for its format. */
export function registerBuildCommand(deps: BuildCommandDeps): void {
  deps.context.subscriptions.push(vscode.commands.registerCommand(BUILD_COMMAND, () => buildActive(deps)));
}
