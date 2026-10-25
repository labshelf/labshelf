// Answers the shared history page in the same page: records the project, serves diffs, restores a point and marks versions.
import {
  applyRestoredFiles, readHistoryDiff, readHistoryRows, applySnapshot, type HistoryRow, type HistoryToHost, type HostToHistory, type ILogger, type LibraryFileSystem, type MessageEnd,
} from "@labshelf/core";
import { askDialog, showToast } from "@labshelf/core/dom";
import type { PageShares } from "../../collab";
import { flushProjectEditors, reloadProjectEditors } from "../session";
import { onEditRecorded } from "./historyRecorded";
import { projectHistoryTarget } from "./folderHistory";
import { markProjectVersion } from "./markProjectVersion";
import { recordProjectEdit } from "./addHistoryEvent";

const MODULE = "writing.history";
const RESTORE_ORIGIN = "history-restore";
const when = (row: HistoryRow): string => new Date(row.at).toLocaleString();

export interface HistoryHostOptions {
  fs: LibraryFileSystem;
  logger: ILogger;
  endpoint: MessageEnd<HostToHistory, HistoryToHost>;
  project: { id: string; folder: string };
  lastFullPdf(projectId: string): Uint8Array | undefined;
  shares: Pick<PageShares, "live">;
}

export function mountHistoryHost({ fs, logger, endpoint, project, lastFullPdf, shares }: HistoryHostOptions): { dispose(): void } {
  const target = projectHistoryTarget(fs, project.folder, project.id);

  const refresh = async (): Promise<void> => {
    endpoint.post({ type: "history", project: project.id, rows: await readHistoryRows(target.storage, logger) });
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

  // The restore writes to disk only, so a shared file's doc is brought to the restored text before the disk mirror writes the doc back.
  const syncShareToRestore = async (): Promise<void> => {
    const share = shares.live(project.id);
    if (!share) return;
    const restored = async (path: string): Promise<string | null> => {
      const file = `${project.folder}/${path}`;
      return (await fs.exists(file)) ? fs.readText(file) : null;
    };
    await applyRestoredFiles({ session: share.session, restored, origin: RESTORE_ORIGIN, logger });
  };

  async function restore(id: string): Promise<void> {
    const row = (await readHistoryRows(target.storage, logger)).find((entry) => entry.id === id);
    if (!row) return;
    const accepted = await askDialog(
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
        showToast(`Could not save an open file of ${project.id}, so nothing was restored.`, "error");
        return;
      }
      await applySnapshot(target, id, logger);
      await syncShareToRestore();
      await reloadProjectEditors(project.id);
    } finally {
      endpoint.post({ type: "busy", busy: false });
    }
    await refresh();
    showToast(`Restored ${project.id} to ${when(row)}.`, "ok");
  }

  async function handle(message: HistoryToHost): Promise<void> {
    if (message.type === "ready") {
      await recordProjectEdit({ fs, logger }, project);
      await refresh();
      followEdits();
    } else if (message.type === "diff") {
      endpoint.post({ ...message, lines: await readHistoryDiff(target.storage, message.id, message.path, logger) });
    } else if (message.type === "restore") {
      await restore(message.id);
    } else if (message.type === "markVersion") {
      if (await markProjectVersion({ fs, logger, lastFullPdf }, project)) await refresh();
    } else {
      showToast("Compare Versions needs the VS Code extension or the terminal app.");
    }
  }

  const stop = endpoint.subscribe((message) => {
    handle(message).catch((error: unknown) => {
      void logger.error(MODULE, error, { action: message.type, projectId: project.id, folder: project.folder });
      showToast(`History: ${error instanceof Error ? error.message : String(error)}`, "error");
    });
  });
  return { dispose: () => { disposed = true; stop(); stopEdits?.(); } };
}
