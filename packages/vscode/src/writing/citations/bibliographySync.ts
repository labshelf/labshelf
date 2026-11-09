// Keeps each project's labshelf.bib current, one update at a time.
import * as vscode from "vscode";

import { DEFAULT_BIBLIOGRAPHY, formatError } from "@labshelf/core";
import type { ReadyProject } from "../projects/index.js";
import { findCitingProject, openEditorSources, type CitationWorkspace } from "./backlinks.js";

export class BibliographySync {
  private queue: Promise<void> = Promise.resolve();
  private readonly warned = new Set<string>();

  constructor(private readonly workspace: CitationWorkspace) {}

  /** Updates the bibliography of the project owning the file; a file outside a ready project is ignored. */
  update(file: string): Promise<void> {
    const project = findCitingProject(this.workspace.projects, file);
    return project ? this.updateProject(project) : Promise.resolve();
  }

  /** Updates the bibliography of one ready project. */
  updateProject(project: ReadyProject): Promise<void> {
    const session = this.workspace.session();
    if (!session) { return Promise.resolve(); }
    // Runs one update at a time: two concurrent ones could both add the bibliography line to the main file.
    this.queue = this.queue.then(() => this.run(project, session));
    return this.queue;
  }

  private async run(project: ReadyProject, session: NonNullable<ReturnType<CitationWorkspace["session"]>>): Promise<void> {
    try {
      const result = await this.workspace.projects.data.updateProjectBibliography(project, await session.listPapers(), openEditorSources);
      if (result.mainLine === "conflict") { this.warnConflict(project); }
      // labshelf.yaml gained `bibliography` once the project first cited a library paper, or its papers list changed.
      const recordedBibliography = result.mainLine !== "not-needed" && project.settings.bibliography === undefined;
      if (recordedBibliography || result.papersWritten) {
        await this.workspace.projects.reload();
      }
    } catch (error) {
      await session.logger.error("writing/citations", error, { folder: project.folder, action: "update-bibliography" });
      void vscode.window.showWarningMessage(
        `Could not update the bibliography of ${project.settings.id}: ${formatError(error)}`,
      );
    }
  }

  private warnConflict(project: ReadyProject): void {
    if (this.warned.has(project.folder)) { return; }
    this.warned.add(project.folder);
    void vscode.window.showWarningMessage(
      `The main file of ${project.settings.id} already loads another bibliography. `
      + `Add "${project.settings.bibliography ?? DEFAULT_BIBLIOGRAPHY}" to it to cite library papers.`,
    );
  }
}
