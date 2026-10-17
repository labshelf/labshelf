// Keeps each project's history in the extension's storage, one folder per project id, and reads it for the history page.
import * as path from "node:path";

import { entryChanges, lineDiff, type DiffLine, type HistoryKind, type ILogger } from "@labshelf/core";
import { readHistory, readHistoryObject, recordSnapshot, restoreSnapshot, type HistoryTarget } from "@labshelf/core/node";
import type { ReadyProject } from "../../mainDocument.js";
import type { ProjectHistoryStore } from "../historyPanel.js";

/** A NUL byte in the first 8 KiB marks a file as binary, as git does. */
const isBinary = (content: Buffer): boolean => content.subarray(0, 8192).includes(0);

export class NodeHistoryStore implements ProjectHistoryStore {
  constructor(private readonly storageDir: string, private readonly logger: ILogger) {}

  // History is per device: it lives outside the project folder, so sync never uploads or merges it.
  target(project: ReadyProject): HistoryTarget {
    return { folder: project.folder, historyDir: path.join(this.storageDir, "history", encodeURIComponent(project.settings.id)) };
  }

  record(project: ReadyProject, kind: HistoryKind, label?: string): Promise<unknown> {
    return recordSnapshot(this.target(project), kind, this.logger, label);
  }

  async rows(project: ReadyProject) {
    const entries = await readHistory(this.target(project).historyDir, this.logger);
    return entries.map((entry, index) => ({
      id: entry.id, at: entry.at, kind: entry.kind, ...(entry.label !== undefined && { label: entry.label }), changes: entryChanges(entries[index - 1], entry),
    })).reverse();
  }

  async diff(project: ReadyProject, id: string, file: string): Promise<DiffLine[] | null> {
    const { historyDir } = this.target(project);
    const entries = await readHistory(historyDir, this.logger);
    const index = entries.findIndex((entry) => entry.id === id);
    if (index < 0) { return []; }
    const read = async (hash: string | undefined): Promise<Buffer> => (hash ? readHistoryObject(historyDir, hash) : Buffer.alloc(0));
    const [before, after] = await Promise.all([read(entries[index - 1]?.files[file]), read(entries[index]!.files[file])]);
    if (isBinary(before) || isBinary(after)) { return null; }
    return lineDiff(before.toString("utf8"), after.toString("utf8"));
  }

  async restore(project: ReadyProject, id: string): Promise<void> {
    await restoreSnapshot(this.target(project), id, this.logger);
  }
}
