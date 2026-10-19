// Records the project's files as an edit entry of its history after a save, without ever failing the save.
import { recordSnapshot, type ILogger, type LibraryFileSystem } from "@labshelf/core";
import { notifyEditRecorded } from "./editRecorded";
import { projectHistoryTarget } from "./historyTarget";

const MODULE = "library-page.history";

export async function recordProjectEdit({ fs, logger }: { fs: LibraryFileSystem; logger: ILogger }, { id, folder }: { id: string; folder: string }): Promise<void> {
  try {
    if (await recordSnapshot(projectHistoryTarget(fs, folder, id), "edit", logger)) notifyEditRecorded(id);
  } catch (error) {
    await logger.error(MODULE, error, { action: "record edit", projectId: id, folder });
  }
}
