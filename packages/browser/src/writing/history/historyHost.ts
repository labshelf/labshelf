// Answers the shared history page in the same page: records the project, serves diffs, restores a point and marks versions.
import {
  applyRestoredFiles, readHistoryDiff, readHistoryRows, applySnapshot, type HistoryToHost, type HostToHistory, type ILogger, type LibraryFileSystem, type MessageEnd,
  formatError, formatLocaleDateTime,
} from "@labshelf/core";
import { askDialog, showToast } from "@labshelf/core/dom";
import type { PageShares } from "../../collab";
import { writeProjectEditors, refreshProjectEditors } from "../session";
import { onUpdateRecorded } from "./historyRecorded";
import { createHistoryProject } from "./folderHistory";
import { writeProjectVersion } from "./writeProjectVersion";
import { addProjectUpdateEvent } from "./addHistoryEvent";

const MODULE = "writing.history";
const RESTORE_ORIGIN = "history-restore";

export interface HistoryHostOptions {
  fs: LibraryFileSystem;
  logger: ILogger;
  endpoint: MessageEnd<HostToHistory, HistoryToHost>;
  project: { id: string; folder: string };
  lastFullPdf(projectId: string): Uint8Array | undefined;
  shares: Pick<PageShares, "live">;
}

interface RestoreContext extends Pick<HistoryHostOptions, "fs" | "logger" | "endpoint" | "project" | "shares"> {
  target: ReturnType<typeof createHistoryProject>;
  refresh(): Promise<void>;
}

// The restore writes to disk only, so a shared file's doc is brought to the restored text before the disk mirror writes the doc back.
async function syncShareToRestore({ fs, logger, project, shares }: RestoreContext): Promise<void> {
  const share = shares.live(project.id);
  if (!share) return;
  const restored = async (path: string): Promise<string | null> => {
    const file = `${project.folder}/${path}`;
    return (await fs.exists(file)) ? fs.readText(file) : null;
  };
  await applyRestoredFiles({ session: share.session, restored, origin: RESTORE_ORIGIN, logger });
}

async function restore(context: RestoreContext, id: string): Promise<void> {
  const { logger, endpoint, project, target } = context;
  const row = (await readHistoryRows(target.storage, logger)).find((entry) => entry.id === id);
  if (!row) return;
  const accepted = await askDialog(
    `Restore ${project.id} to ${formatLocaleDateTime(row.at)}?`,
    "The project's files go back to that point. The current state stays in the history, so you can return to it.",
    "Restore",
  );
  if (!accepted) return;
  endpoint.post({ type: "busy", busy: true });
  try {
    // Unsaved edits are written first, so the history keeps them, and the editors reload after, so none saves its stale text over the restore.
    if (!(await writeProjectEditors(project.id))) {
      void logger.log("WARN", MODULE, "kept the project as it is: an open file could not be saved", { projectId: project.id, id });
      showToast(`Could not save an open file of ${project.id}, so nothing was restored.`, "error");
      return;
    }
    await applySnapshot(target, id, logger);
    await syncShareToRestore(context);
    await refreshProjectEditors(project.id);
  } finally {
    endpoint.post({ type: "busy", busy: false });
  }
  await context.refresh();
  showToast(`Restored ${project.id} to ${formatLocaleDateTime(row.at)}.`, "ok");
}

export function mountHistoryHost({ fs, logger, endpoint, project, lastFullPdf, shares }: HistoryHostOptions): { dispose(): void } {
  const target = createHistoryProject(fs, project.folder, project.id);

  const refresh = async (): Promise<void> => {
    endpoint.post({ type: "history", project: project.id, rows: await readHistoryRows(target.storage, logger) });
  };
  let disposed = false;
  let stopEdits: (() => void) | undefined;
  // Saves made while the page is open show up in its timeline; the page's own first record is already in its first rows.
  const followEdits = (): void => {
    if (disposed) return;
    stopEdits ??= onUpdateRecorded(project.id, () => {
      refresh().catch((error: unknown) => logger.error(MODULE, error, { action: "refresh after edit", projectId: project.id }));
    });
  };

  async function handle(message: HistoryToHost): Promise<void> {
    if (message.type === "ready") {
      await addProjectUpdateEvent({ fs, logger }, project);
      await refresh();
      followEdits();
    } else if (message.type === "diff") {
      endpoint.post({ ...message, lines: await readHistoryDiff(target.storage, message.id, message.path, logger) });
    } else if (message.type === "restore") {
      await restore({ fs, logger, endpoint, project, shares, target, refresh }, message.id);
    } else if (message.type === "markVersion") {
      if (await writeProjectVersion({ fs, logger, lastFullPdf }, project)) await refresh();
    } else {
      showToast("Compare Versions needs the VS Code extension or the terminal app.");
    }
  }

  const stop = endpoint.subscribe((message) => {
    handle(message).catch((error: unknown) => {
      void logger.error(MODULE, error, { action: message.type, projectId: project.id, folder: project.folder });
      showToast(`History: ${formatError(error)}`, "error");
    });
  });
  return { dispose: () => { disposed = true; stop(); stopEdits?.(); } };
}
