// Records the project's files as an edit entry of its history after a save, without ever failing the save.
import { writeSnapshot, type ILogger, type LibraryFileSystem } from "@labshelf/core";
import { sendUpdateRecorded } from "./historyRecorded";
import { createHistoryProject } from "./folderHistory";

const MODULE = "writing.history";

export async function addProjectUpdateEvent({ fs, logger }: { fs: LibraryFileSystem; logger: ILogger }, { id, folder }: { id: string; folder: string }): Promise<void> {
  try {
    if (await writeSnapshot(createHistoryProject(fs, folder, id), "edit", logger)) sendUpdateRecorded(id);
  } catch (error) {
    await logger.error(MODULE, error, { action: "record edit", projectId: id, folder });
  }
}
