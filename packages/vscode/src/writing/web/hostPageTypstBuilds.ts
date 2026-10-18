// Builds Typst projects through the editor page's compiler, live into the preview and into <root>.pdf on save, as the desktop builds do.
import * as vscode from "vscode";

import { errorMessage, typstPreviewPdf, type ProjectEntry } from "@labshelf/core";
import type { LocatedProblem } from "@labshelf/core";
import type { TypstHostOutcome, TypstHostRequest } from "@labshelf/core/helper";
import type { BuildListener, BuildTrigger, FinishedBuild } from "../build/index.js";
import type { ReadyProject } from "../mainDocument.js";
import type { WritingHost, WritingProjects } from "../session/index.js";
import { recordTypstVersion, type TypstTrigger } from "../typst/index.js";

const MODULE = "writing/typst";

export interface HostPageTypstBuildsDeps {
  compile(request: TypstHostRequest): Promise<TypstHostOutcome>;
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "fs" | "paths" | "data" | "reload"> & { list: () => readonly ProjectEntry[] };
  diagnostics: { publish(rootPath: string, problems: LocatedProblem[]): void };
  previews: BuildListener;
}

interface FolderLane {
  /** Every compile of the project, one at a time; the page's compiler holds one set of editor texts at a time. */
  chain: Promise<unknown>;
  // The root of the live compile waiting in the chain, if any; it reads the newest text when it runs.
  liveQueued?: string | undefined;
}

export class HostPageTypstBuilds {
  private readonly lanes = new Map<string, FolderLane>();

  constructor(private readonly deps: HostPageTypstBuildsDeps) {}

  /** Resolves with the result of a saved build, or `undefined` for a live compile or a build that did not run. */
  request(projectFolder: string, root: string, trigger: TypstTrigger): Promise<FinishedBuild | undefined> {
    const lane = this.lanes.get(projectFolder) ?? { chain: Promise.resolve() };
    this.lanes.set(projectFolder, lane);
    if (trigger === "live" && lane.liveQueued === root) { return lane.chain as Promise<undefined>; }
    if (trigger === "live") { lane.liveQueued = root; }
    const run = lane.chain.then(async () => {
      if (trigger === "live" && lane.liveQueued === root) { lane.liveQueued = undefined; }
      return await this.run(projectFolder, root, trigger);
    });
    lane.chain = run.catch(() => undefined);
    return run;
  }

  private async run(projectFolder: string, root: string, trigger: TypstTrigger): Promise<FinishedBuild | undefined> {
    const entry = this.deps.projects.list().find((candidate) => candidate.folder === projectFolder);
    const project = this.deps.host.current() && entry?.kind === "ready" ? entry : undefined;
    if (!project) { return undefined; }
    if (!project.main) {
      if (trigger === "command") { void vscode.window.showErrorMessage(`Project "${project.settings.id}" has no main file. Choose one from the status bar.`); }
      return undefined;
    }
    try {
      const outcome = await this.deps.compile({ projectId: project.settings.id, main: root, sources: this.editorTexts(projectFolder) });
      const result = await this.write(project, root, trigger, outcome);
      if (trigger === "live") {
        // INVARIANT: a live compile that fails leaves the preview and its banner alone; half-typed text is not a failed build.
        if (result.status === "succeeded") { this.deps.previews.finished(project, root, result, "save"); }
        return undefined;
      }
      this.finishSaved(project, root, trigger, result);
      if (result.status === "succeeded") { await recordTypstVersion(project, this.deps); }
      return result;
    } catch (error) {
      await this.deps.host.current()?.logger.error(MODULE, error, { projectFolder, root, trigger });
      if (trigger === "command") { void vscode.window.showErrorMessage(`Build of "${project.settings.id}" failed: ${errorMessage(error)}`); }
      return undefined;
    }
  }

  /** The text of every open editor in the project, by project-relative path; it wins over the page's copy of the files. */
  private editorTexts(projectFolder: string): TypstHostRequest["sources"] {
    const { paths } = this.deps.projects;
    return vscode.workspace.textDocuments
      .filter((document) => document.uri.scheme === "file" && !paths.relative(projectFolder, document.uri.fsPath).startsWith(".."))
      .map((document) => ({ path: paths.relative(projectFolder, document.uri.fsPath).split(paths.sep).join("/"), text: document.getText() }));
  }

  private async write(project: ReadyProject, root: string, trigger: TypstTrigger, outcome: TypstHostOutcome): Promise<FinishedBuild> {
    const { fs, paths, data } = this.deps.projects;
    const problems = outcome.problems.map((problem) => ({ ...problem, file: paths.join(project.folder, problem.file) }));
    if (outcome.status === "failed") { return { status: "failed", problems }; }
    const preview = typstPreviewPdf(project, root, data, paths);
    // TRAP: the web path ops join without normalising, so a root at the project top must not add a "." segment.
    const saved = paths.join(project.folder, `${root.slice(0, root.length - paths.extname(root).length)}.pdf`);
    const outputs = trigger === "live" ? [preview] : [preview, saved];
    await Promise.all(outputs.map((output) => fs.writeFile(output, outcome.pdf)));
    return { status: "succeeded", pdf: preview, problems, cites: outcome.cites };
  }

  private finishSaved(project: ReadyProject, root: string, trigger: BuildTrigger, result: FinishedBuild): void {
    const { paths } = this.deps.projects;
    this.deps.diagnostics.publish(paths.join(project.folder, root), result.problems);
    this.deps.previews.finished(project, root, result, trigger);
    const errors = result.problems.filter((problem) => problem.severity === "error").length;
    const name = paths.basename(root, paths.extname(root));
    vscode.window.setStatusBarMessage(result.status === "succeeded" ? `$(check) Built ${name}.pdf` : `$(error) Build of ${root} failed: ${errors} ${errors === 1 ? "error" : "errors"}`, 5000);
  }
}
