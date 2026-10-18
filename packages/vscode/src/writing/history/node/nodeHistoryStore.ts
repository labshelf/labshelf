// Keeps each project's history in the extension's storage, one folder per project id, and reads it for the history page.
import * as path from "node:path";

import { historyDiff, historyRows, recordSnapshot, restoreSnapshot, type DiffLine, type HistoryKind, type ILogger } from "@labshelf/core";
import { nodeHistoryTarget } from "@labshelf/core/node";
import type { ReadyProject } from "../../mainDocument.js";
import type { ProjectHistoryStore } from "../historyPanel.js";

export class NodeHistoryStore implements ProjectHistoryStore {
  constructor(private readonly storageDir: string, private readonly logger: ILogger) {}

  // History is per device: it lives outside the project folder, so the user's sync tool never copies it between devices.
  private target(project: ReadyProject) {
    return nodeHistoryTarget(project.folder, path.join(this.storageDir, "history", encodeURIComponent(project.settings.id)));
  }

  record(project: ReadyProject, kind: HistoryKind, label?: string): Promise<unknown> {
    return recordSnapshot(this.target(project), kind, this.logger, label);
  }

  rows(project: ReadyProject) {
    return historyRows(this.target(project).storage, this.logger);
  }

  diff(project: ReadyProject, id: string, file: string): Promise<DiffLine[] | null> {
    return historyDiff(this.target(project).storage, id, file, this.logger);
  }

  async restore(project: ReadyProject, id: string): Promise<void> {
    await restoreSnapshot(this.target(project), id, this.logger);
  }
}
