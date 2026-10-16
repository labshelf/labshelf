// Keeps the open project's preview on the PDF of the focused file's build root, building the root only when it has no PDF.
import * as vscode from "vscode";

import type { ProjectFormat } from "@labshelf/core";
import { owningProject, type ReadyProject } from "../mainDocument.js";
import type { BuildRootOf } from "../nodePort/index.js";
import type { WritingHost, WritingProjects } from "../session/index.js";
import { builtPdf } from "./builtPdf.js";
import { PREVIEW_LOG_MODULE } from "./previewStrings.js";

export interface FocusFollowerDeps {
  session: { readonly project: ReadyProject | undefined };
  projects: Pick<WritingProjects, "list" | "paths" | "data">;
  buildRootOf: BuildRootOf;
  builders: Record<ProjectFormat, { request(projectFolder: string, root: string, trigger: "focus"): Promise<unknown> }>;
  previews: { show(project: ReadyProject, root: string, pdf: string, options: { beside: boolean }): void };
  host: Pick<WritingHost, "current">;
}

export class FocusFollower implements vscode.Disposable {
  private readonly subscription: vscode.Disposable;

  constructor(private readonly deps: FocusFollowerDeps) {
    this.subscription = vscode.window.onDidChangeActiveTextEditor((editor) => {
      const uri = editor?.document.uri;
      if (uri?.scheme === "file") { void this.follow(uri.fsPath); }
    });
  }

  /** Shows the PDF of the root the file belongs to; asks for a build only when that root has none. */
  async follow(file: string): Promise<void> {
    const { session, projects, previews } = this.deps;
    const project = session.project;
    if (!project?.main || owningProject(projects, file)?.folder !== project.folder) { return; }
    try {
      const root = await this.deps.buildRootOf(project.folder, project.main, file);
      const pdf = await builtPdf(projects, project, root);
      if (pdf) {
        previews.show(project, root, pdf, { beside: true });
        return;
      }
      const mainPdf = await builtPdf(projects, project, project.main);
      if (mainPdf) { previews.show(project, project.main, mainPdf, { beside: true }); }
      void this.deps.host.current()?.logger.log("INFO", PREVIEW_LOG_MODULE, "Building the focused root", { projectFolder: project.folder, root });
      await this.deps.builders[project.settings.format].request(project.folder, root, "focus");
    } catch (error) {
      void this.deps.host.current()?.logger.error(PREVIEW_LOG_MODULE, error, { projectFolder: project.folder, file });
    }
  }

  dispose(): void {
    this.subscription.dispose();
  }
}
