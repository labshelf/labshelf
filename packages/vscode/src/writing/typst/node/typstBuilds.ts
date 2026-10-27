// Compiles Typst roots: live into the preview while typing, and into <root>.pdf on save and on Build Project, then shows the result; registers the triggers behind them and creates the extension's one Typst compiler.
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

import { isInside, type PathOps, type ProjectEntry } from "@labshelf/core";
import type { TypstBuildResult } from "@labshelf/core/typst";
import { TypstCompilerHost, resolveTypstPackageDirs } from "@labshelf/core/typst/node";
import { buildProject, ProjectBuildQueue, type ProjectBuildDeps } from "@labshelf/core/node";
import type { ReadyProject } from "../../commands/index.js";
import type { BuildListener, BuildTrigger, FinishedBuild } from "../../build/index.js";
import type { WritingHost, WritingProjects } from "../../projects/index.js";
import { createProjectBuildDeps, type ProjectBuildDepsSource } from "../../build/node/index.js";
import { registerTypstTriggers, writeTypstVersion, type TypstTrigger } from "../typstTriggers.js";

export interface TypstBuildsDeps {
  /** Runs the saved and command builds, one at a time per project. */
  queue: Pick<ProjectBuildQueue, "request">;
  /** What live compiles of unsaved text need; they bypass the queue. */
  buildDeps: ProjectBuildDeps;
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "data" | "paths" | "reload"> & { list: () => readonly ProjectEntry[] };
  diagnostics: { publish(rootPath: string, problems: TypstBuildResult["problems"]): void };
  previews: BuildListener;
}

interface FolderState {
  /** Live compiles, one at a time; saved builds wait for it so both never write the preview together. */
  live: Promise<unknown>;
  // `liveQueued` names the root of the live compile waiting in the chain, if any.
  liveQueued?: string | undefined;
  saved: Promise<unknown>;
}

const MODULE = "writing/typst";

function unsavedSources(paths: PathOps, projectFolder: string): Map<string, string> {
  const inside = (file: string): boolean => isInside(paths, projectFolder, file, { allowEqual: true });
  return new Map(vscode.workspace.textDocuments
    .filter((document) => document.isDirty && document.uri.scheme === "file" && inside(document.uri.fsPath))
    .map((document) => [document.uri.fsPath, document.getText()]));
}

export class TypstBuilds {
  private readonly folders = new Map<string, FolderState>();

  constructor(private readonly deps: TypstBuildsDeps) {}

  /**
   * Compiles `root` (relative to the project folder); live requests for a root that arrive while one for it is
   * queued are covered by it, since it reads the newest text.
   * Resolves with the result of a saved build, or `undefined` for a live compile or a build that did not run.
   */
  request(projectFolder: string, root: string, trigger: TypstTrigger): Promise<FinishedBuild | undefined> {
    const state = this.folders.get(projectFolder) ?? { live: Promise.resolve(), saved: Promise.resolve() };
    this.folders.set(projectFolder, state);
    if (trigger === "live") {
      if (state.liveQueued === root) { return state.live as Promise<undefined>; }
      state.liveQueued = root;
      const run = Promise.all([state.live, state.saved]).then(async () => {
        if (state.liveQueued === root) { state.liveQueued = undefined; }
        return this.runLive(projectFolder, root);
      });
      state.live = run;
      return run;
    }
    const run = state.live.then(() => this.runSaved(projectFolder, root, trigger));
    state.saved = run;
    return run;
  }

  private ready(projectFolder: string): ReadyProject | undefined {
    const entry = this.deps.projects.list().find((candidate) => candidate.folder === projectFolder);
    return this.deps.host.current() && entry?.kind === "ready" ? entry : undefined;
  }

  private async runLive(projectFolder: string, root: string): Promise<undefined> {
    const project = this.ready(projectFolder);
    if (!project?.main) { return undefined; }
    try {
      const result = await buildProject(project, this.deps.buildDeps, { root, unsaved: unsavedSources(this.deps.projects.paths, projectFolder) });
      // INVARIANT: a live compile that fails leaves the preview and its banner alone; half-typed text is not a failed build.
      if (result.status === "succeeded") { this.deps.previews.finished(project, root, result, "save"); }
    } catch (error) {
      await this.deps.host.current()?.logger.error(MODULE, error, { projectFolder, trigger: "live" });
    }
    return undefined;
  }

  private async runSaved(projectFolder: string, root: string, trigger: BuildTrigger): Promise<FinishedBuild | undefined> {
    const project = this.ready(projectFolder);
    if (!project) { return undefined; }
    if (!project.main) {
      if (trigger === "command") { await vscode.window.showErrorMessage(`Project "${project.settings.id}" has no main file. Choose one from the status bar.`); }
      return undefined;
    }
    try {
      const result = await this.deps.queue.request(project, { root });
      if (result.status === "cancelled" || result.status === "no-main" || result.status === "toolchain-missing") { return undefined; }
      const errors = result.problems.filter((problem) => problem.severity === "error").length;
      this.deps.diagnostics.publish(path.join(project.folder, root), result.problems);
      this.deps.previews.finished(project, root, result, trigger);
      vscode.window.setStatusBarMessage(result.status === "succeeded" ? `$(check) Built ${path.parse(root).name}.pdf` : `$(error) Build of ${root} failed: ${errors} ${errors === 1 ? "error" : "errors"}`, 5000);
      if (result.status === "succeeded") { await writeTypstVersion(project, this.deps); }
      return result;
    } catch (error) {
      await this.deps.host.current()?.logger.error(MODULE, error, { projectFolder: project.folder, trigger });
      if (trigger !== "command") { return undefined; }
      await vscode.window.showErrorMessage(`Build of "${project.settings.id}" failed: ${String(error)}`);
      return undefined;
    }
  }
}

function createTypstCompilerHost(storageDir: string): TypstCompilerHost {
  return new TypstCompilerHost({
    wasm: async () => new Uint8Array(await readFile(require.resolve("@myriaddreamin/typst-ts-web-compiler/wasm"))),
    fontsDir: path.join(storageDir, "typst", "fonts"),
    packageDirs: resolveTypstPackageDirs(),
    withFontDownload: (run) => Promise.resolve(vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Downloading Typst's default fonts (9 MB, once)" }, run,
    )),
  });
}

interface TypstBuildRegistration extends Omit<TypstBuildsDeps, "queue" | "buildDeps"> {
  context: vscode.ExtensionContext;
  host: WritingHost;
  tex: ProjectBuildDepsSource["tex"];
  projects: WritingProjects;
  hasPreview: (projectFolder: string) => boolean;
}

/** Registers the triggers and returns the builds, which the Build Project command also uses. */
export function registerTypstBuild(deps: TypstBuildRegistration): TypstBuilds {
  const storageDir = deps.context.globalStorageUri.fsPath;
  const buildDeps = createProjectBuildDeps({ host: deps.host, projects: deps.projects, tex: deps.tex, typst: createTypstCompilerHost(storageDir) });
  const builds = new TypstBuilds({ ...deps, buildDeps, queue: new ProjectBuildQueue(buildDeps) });
  registerTypstTriggers({ ...deps, request: (folder, root, trigger) => builds.request(folder, root, trigger) });
  return builds;
}
