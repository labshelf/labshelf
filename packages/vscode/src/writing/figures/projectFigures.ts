// Reads the figures of a project as Writing view rows and tells the view when they may have changed.
import * as vscode from "vscode";

import type { ProjectContentPort } from "@labshelf/core";
import type { FigureNode, ReadyProject } from "./figureNode.js";
import type { WritingHost } from "../session/index.js";

export class ProjectFigures implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly host: Pick<WritingHost, "current">, private readonly data: ProjectContentPort) {}

  /** The project's figures in labshelf.yaml order; none when they cannot be read, after logging why. */
  async children(project: ReadyProject): Promise<FigureNode[]> {
    const figures = project.settings.figures;
    if (!figures) { return []; }
    try {
      const states = await this.data.readFigureStates(project.folder, figures);
      return Object.entries(figures).map(([path, recipe]) => ({ kind: "figure", project, path, recipe, state: states[path]! }));
    } catch (error) {
      await this.host.current()?.logger.error("writing/figures", error, { action: "read-states", folder: project.folder });
      return [];
    }
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
