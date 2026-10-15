// Compiles Typst projects one at a time per project: live into the preview while typing, and into <main>.pdf on save and on Build Project.
import * as path from "node:path";
import * as vscode from "vscode";

import { projectBuildDir, type ProjectEntry } from "@labshelf/core/node";
import { runTypstBuild, type TypstBuildResult } from "@labshelf/core/typst/node";
import type { BuildListener, BuildTrigger } from "../build/index.js";
import type { ReadyProject } from "../mainDocument.js";
import type { WritingHost, WritingProjects } from "../projectStore.js";
import { tinymistInstalled } from "./tinymist/index.js";
import type { TypstCompilerHost } from "./typstCompilerHost.js";
import { recordTypstVersion } from "./typstVersionPin.js";

/** "live" compiles unsaved text for the preview only; the others write `<main>.pdf` from the files on disk. */
export type TypstTrigger = BuildTrigger | "live";

export interface TypstBuildsDeps {
  compiler: Pick<TypstCompilerHost, "get">;
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "reload"> & { list: () => readonly ProjectEntry[] };
  diagnostics: { publish(projectFolder: string, problems: TypstBuildResult["problems"]): void };
  previews: BuildListener;
}

const MODULE = "writing/typst";

/** The preview's PDF: the build folder keeps it apart from `<main>.pdf`, which only a saved build writes. */
export function typstPreviewPdf(project: ReadyProject & { main: string }): string {
  return path.join(projectBuildDir(project.settings.id), `${path.parse(project.main).name}.pdf`);
}

function unsavedSources(projectFolder: string): Map<string, string> {
  const inside = (file: string): boolean => !path.relative(projectFolder, file).startsWith("..");
  return new Map(vscode.workspace.textDocuments
    .filter((document) => document.isDirty && document.uri.scheme === "file" && inside(document.uri.fsPath))
    .map((document) => [document.uri.fsPath, document.getText()]));
}

export class TypstBuilds {
  private readonly chains = new Map<string, { chain: Promise<void>; liveQueued: boolean }>();

  constructor(private readonly deps: TypstBuildsDeps) {}

  /** Queues a compile; live requests that arrive while one is queued are covered by it, since it reads the newest text. */
  request(projectFolder: string, trigger: TypstTrigger): Promise<void> {
    const state = this.chains.get(projectFolder) ?? { chain: Promise.resolve(), liveQueued: false };
    this.chains.set(projectFolder, state);
    if (trigger === "live") {
      if (state.liveQueued) { return state.chain; }
      state.liveQueued = true;
    }
    state.chain = state.chain.then(async () => {
      if (trigger === "live") { state.liveQueued = false; }
      await this.run(projectFolder, trigger);
    });
    return state.chain;
  }

  private async run(projectFolder: string, trigger: TypstTrigger): Promise<void> {
    const session = this.deps.host.current();
    const entry = this.deps.projects.list().find((candidate) => candidate.folder === projectFolder);
    if (!session || entry?.kind !== "ready") { return; }
    const project = entry;
    if (!project.main) {
      if (trigger === "command") { await vscode.window.showErrorMessage(`Project "${project.settings.id}" has no main file. Choose one from the status bar.`); }
      return;
    }
    const main = project.main;
    try {
      const compiler = await this.deps.compiler.get(session.logger);
      const previewPdf = typstPreviewPdf({ ...project, main });
      const { dir, name } = path.parse(main);
      const started = Date.now();
      const result = await runTypstBuild({
        ...compiler, projectFolder, main, logger: session.logger,
        sources: trigger === "live" ? unsavedSources(projectFolder) : new Map(),
        outputs: trigger === "live" ? [previewPdf] : [previewPdf, path.join(projectFolder, dir, `${name}.pdf`)],
      });
      // INVARIANT: a live compile that fails leaves the preview and its banner alone; half-typed text is not a failed build.
      if (trigger === "live") {
        if (result.status === "succeeded") { this.deps.previews.finished(project, result, "save"); }
        return;
      }
      const errors = result.problems.filter((problem) => problem.severity === "error").length;
      // Tinymist already lists Typst errors while typing; a second copy would double every entry in Problems.
      this.deps.diagnostics.publish(projectFolder, tinymistInstalled() ? [] : result.problems);
      this.deps.previews.finished(project, result, trigger);
      vscode.window.setStatusBarMessage(result.status === "succeeded" ? `$(check) Built ${name}.pdf` : `$(error) Build of ${main} failed: ${errors} ${errors === 1 ? "error" : "errors"}`, 5000);
      await session.logger.log(result.status === "failed" ? "WARN" : "INFO", MODULE, `Typst build ${result.status}`, { projectFolder, main, trigger, errors, ms: Date.now() - started });
      if (result.status === "succeeded") { await recordTypstVersion(project, this.deps); }
    } catch (error) {
      await session.logger.error(MODULE, error, { projectFolder, trigger });
      if (trigger !== "live") { await vscode.window.showErrorMessage(`Build of "${project.settings.id}" failed: ${String(error)}`); }
    }
  }
}
