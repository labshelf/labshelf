// Regenerates a writing project's labshelf.bib after a citation is accepted or a source is saved.
import * as vscode from "vscode";

import { DEFAULT_BIBLIOGRAPHY } from "@labshelf/core";
import { updateProjectBibliography } from "@labshelf/core/node";
import { citingProject, type CitationWorkspace } from "./citationWorkspace.js";
import { openEditorSources } from "./openEditorSources.js";
import type { ReadyProject } from "../mainDocument.js";

export class BibliographySync {
  private queue: Promise<void> = Promise.resolve();
  private readonly warned = new Set<string>();

  constructor(private readonly workspace: CitationWorkspace) {}

  /** Updates the bibliography of the project owning the file; a file outside a ready project is ignored. */
  update(file: string): Promise<void> {
    const project = citingProject(this.workspace.projects, file);
    const session = this.workspace.session();
    if (!project || !session) { return Promise.resolve(); }
    // Runs one update at a time: two concurrent ones could both add the bibliography line to the main file.
    this.queue = this.queue.then(() => this.run(project, session));
    return this.queue;
  }

  private async run(project: ReadyProject, session: NonNullable<ReturnType<CitationWorkspace["session"]>>): Promise<void> {
    try {
      const result = await updateProjectBibliography(project, await session.listPapers(), session.logger, openEditorSources);
      if (result.mainLine === "conflict") { this.warnConflict(project); }
      // labshelf.yaml gained `bibliography` once the project first cited a library paper.
      if (result.mainLine !== "not-needed" && project.settings.bibliography === undefined) {
        await this.workspace.projects.reload();
      }
    } catch (error) {
      await session.logger.error("writing/citations", error, { folder: project.folder, action: "update-bibliography" });
      void vscode.window.showWarningMessage(
        `Could not update the bibliography of ${project.settings.id}: ${error instanceof Error ? error.message : String(error)}`,
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
