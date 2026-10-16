// Compiles Typst roots one at a time per project: live into the preview while typing, and into <root>.pdf on save and on Build Project.
import * as path from "node:path";
import * as vscode from "vscode";

import type { ProjectEntry } from "@labshelf/core";
import type { TypstBuildResult } from "@labshelf/core/typst";
import { runTypstBuild } from "@labshelf/core/typst/node";
import type { BuildListener, BuildTrigger, FinishedBuild } from "../../build/index.js";
import type { WritingHost, WritingProjects } from "../../projectStore.js";
import { tinymistInstalled } from "../tinymist/index.js";
import { typstPreviewPdf } from "../typstPreviewPdf.js";
import { recordTypstVersion } from "../typstVersionPin.js";
import type { TypstCompilerHost } from "./typstCompilerHost.js";

/** "live" compiles unsaved text for the preview only; the others write `<root>.pdf` from the files on disk. */
export type TypstTrigger = BuildTrigger | "live";

export interface TypstBuildsDeps {
  compiler: Pick<TypstCompilerHost, "get">;
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "data" | "paths" | "reload"> & { list: () => readonly ProjectEntry[] };
  diagnostics: { publish(rootPath: string, problems: TypstBuildResult["problems"]): void };
  previews: BuildListener;
}

const MODULE = "writing/typst";

function unsavedSources(projectFolder: string): Map<string, string> {
  const inside = (file: string): boolean => !path.relative(projectFolder, file).startsWith("..");
  return new Map(vscode.workspace.textDocuments
    .filter((document) => document.isDirty && document.uri.scheme === "file" && inside(document.uri.fsPath))
    .map((document) => [document.uri.fsPath, document.getText()]));
}

export class TypstBuilds {
  // `liveQueued` names the root of the live compile waiting in the chain, if any.
  private readonly chains = new Map<string, { chain: Promise<FinishedBuild | undefined>; liveQueued?: string | undefined }>();

  constructor(private readonly deps: TypstBuildsDeps) {}

  /**
   * Queues a compile of `root` (relative to the project folder); live requests for a root that arrive while one for it is
   * queued are covered by it, since it reads the newest text.
   * Resolves with the result of a saved build, or `undefined` for a live compile or a build that did not run.
   */
  request(projectFolder: string, root: string, trigger: TypstTrigger): Promise<FinishedBuild | undefined> {
    const state = this.chains.get(projectFolder) ?? { chain: Promise.resolve(undefined) };
    this.chains.set(projectFolder, state);
    if (trigger === "live") {
      if (state.liveQueued === root) { return state.chain; }
      state.liveQueued = root;
    }
    state.chain = state.chain.then(async () => {
      if (trigger === "live" && state.liveQueued === root) { state.liveQueued = undefined; }
      return this.run(projectFolder, root, trigger);
    });
    return state.chain;
  }

  private async run(projectFolder: string, root: string, trigger: TypstTrigger): Promise<FinishedBuild | undefined> {
    const session = this.deps.host.current();
    const entry = this.deps.projects.list().find((candidate) => candidate.folder === projectFolder);
    if (!session || entry?.kind !== "ready") { return undefined; }
    const project = entry;
    if (!project.main) {
      if (trigger === "command") { await vscode.window.showErrorMessage(`Project "${project.settings.id}" has no main file. Choose one from the status bar.`); }
      return undefined;
    }
    try {
      const compiler = await this.deps.compiler.get(session.logger);
      const previewPdf = typstPreviewPdf(project, root, this.deps.projects.data, this.deps.projects.paths);
      const { dir, name } = path.parse(root);
      const started = Date.now();
      const result = await runTypstBuild({
        ...compiler, projectFolder, main: root, logger: session.logger,
        sources: trigger === "live" ? unsavedSources(projectFolder) : new Map(),
        outputs: trigger === "live" ? [previewPdf] : [previewPdf, path.join(projectFolder, dir, `${name}.pdf`)],
      });
      // INVARIANT: a live compile that fails leaves the preview and its banner alone; half-typed text is not a failed build.
      if (trigger === "live") {
        if (result.status === "succeeded") { this.deps.previews.finished(project, root, result, "save"); }
        return undefined;
      }
      const errors = result.problems.filter((problem) => problem.severity === "error").length;
      // Tinymist already lists Typst errors while typing; a second copy would double every entry in Problems.
      this.deps.diagnostics.publish(path.join(projectFolder, root), tinymistInstalled() ? [] : result.problems);
      this.deps.previews.finished(project, root, result, trigger);
      vscode.window.setStatusBarMessage(result.status === "succeeded" ? `$(check) Built ${name}.pdf` : `$(error) Build of ${root} failed: ${errors} ${errors === 1 ? "error" : "errors"}`, 5000);
      await session.logger.log(result.status === "failed" ? "WARN" : "INFO", MODULE, `Typst build ${result.status}`, { projectFolder, root, trigger, errors, ms: Date.now() - started });
      if (result.status === "succeeded") { await recordTypstVersion(project, this.deps); }
      return result;
    } catch (error) {
      await session.logger.error(MODULE, error, { projectFolder, trigger });
      if (trigger !== "live") { await vscode.window.showErrorMessage(`Build of "${project.settings.id}" failed: ${String(error)}`); }
      return undefined;
    }
  }
}
