// Answers the shared history page in the same page: records the project, serves diffs, restores a point and marks versions.
import {
  historyDiff, historyRows, restoreSnapshot, type HistoryRow, type HistoryToHost, type HostToHistory, type ILogger, type LibraryFileSystem, type MessageEnd,
} from "@labshelf/core";
import { confirmDialog, toast } from "@labshelf/core/dom";
import { flushProjectEditors, reloadProjectEditors } from "../../openEditors";
import { onEditRecorded } from "./editRecorded";
import { projectHistoryTarget } from "./historyTarget";
import { markProjectVersion } from "./markProjectVersion";
import { recordProjectEdit } from "./recordProjectEdit";

const MODULE = "library-page.history";
const when = (row: HistoryRow): string => new Date(row.at).toLocaleString();

export interface HistoryHostOptions {
  fs: LibraryFileSystem;
  logger: ILogger;
  endpoint: MessageEnd<HostToHistory, HistoryToHost>;
  project: { id: string; folder: string };
  lastFullPdf(projectId: string): Uint8Array | undefined;
}

export function mountHistoryHost({ fs, logger, endpoint, project, lastFullPdf }: HistoryHostOptions): { dispose(): void } {
  const target = projectHistoryTarget(fs, project.folder, project.id);

  const refresh = async (): Promise<void> => {
    endpoint.post({ type: "history", project: project.id, rows: await historyRows(target.storage, logger) });
  };
  let disposed = false;
  let stopEdits: (() => void) | undefined;
  // Saves made while the page is open show up in its timeline; the page's own first record is already in its first rows.
  const followEdits = (): void => {
    if (disposed) return;
    stopEdits ??= onEditRecorded(project.id, () => {
      refresh().catch((error: unknown) => logger.error(MODULE, error, { action: "refresh after edit", projectId: project.id }));
    });
  };

  async function restore(id: string): Promise<void> {
    const row = (await historyRows(target.storage, logger)).find((entry) => entry.id === id);
    if (!row) return;
    const accepted = await confirmDialog(
      `Restore ${project.id} to ${when(row)}?`,
      "The project's files go back to that point. The current state stays in the history, so you can return to it.",
      "Restore",
    );
    if (!accepted) return;
    endpoint.post({ type: "busy", busy: true });
    try {
      // Unsaved edits are written first, so the history keeps them, and the editors reload after, so none saves its stale text over the restore.
      if (!(await flushProjectEditors(project.id))) {
        void logger.log("WARN", MODULE, "kept the project as it is: an open file could not be saved", { projectId: project.id, id });
        toast(`Could not save an open file of ${project.id}, so nothing was restored.`, "error");
        return;
      }
      await restoreSnapshot(target, id, logger);
      await reloadProjectEditors(project.id);
    } finally {
      endpoint.post({ type: "busy", busy: false });
    }
    await refresh();
    toast(`Restored ${project.id} to ${when(row)}.`, "ok");
  }

  async function handle(message: HistoryToHost): Promise<void> {
    if (message.type === "ready") {
      await recordProjectEdit({ fs, logger }, project);
      await refresh();
      followEdits();
    } else if (message.type === "diff") {
      endpoint.post({ ...message, lines: await historyDiff(target.storage, message.id, message.path, logger) });
    } else if (message.type === "restore") {
      await restore(message.id);
    } else if (message.type === "markVersion") {
      if (await markProjectVersion({ fs, logger, lastFullPdf }, project)) await refresh();
    } else {
      toast("Compare Versions needs the VS Code extension or the terminal app.");
    }
  }

  const stop = endpoint.subscribe((message) => {
    handle(message).catch((error: unknown) => {
      void logger.error(MODULE, error, { action: message.type, projectId: project.id, folder: project.folder });
      toast(`History: ${error instanceof Error ? error.message : String(error)}`, "error");
    });
  });
  return { dispose: () => { disposed = true; stop(); stopEdits?.(); } };
}
