// Moves this browser's library into the library folder the bridge serves, and counts the papers the move would carry.
import { countPapers, moveToFolder, type MoveResult } from "@labshelf/core";
import { createBrowserLogger } from "../../platform";
import { IdbFileSystem } from "../idb";
import { readFolderFileSystem, refreshStoredLibraryLocation } from "../libraryFileSystem";
import { refreshPaperRecords } from "../records";

const MODULE = "browser.storage.move";

/** Throws when the folder is not the library source; the paper cache is rebuilt from the folder either way. */
export async function moveBrowserLibraryToFolder(): Promise<MoveResult> {
  const logger = createBrowserLogger();
  const source = await refreshStoredLibraryLocation();
  if (source.kind !== "folder") {
    throw new Error(`The library folder is not reachable (${source.reason}), so the browser library stays where it is`);
  }
  try {
    return await moveToFolder({ from: new IdbFileSystem(), to: readFolderFileSystem(), logger });
  } finally {
    await refreshPaperRecords(readFolderFileSystem(), logger).catch((error: unknown) => logger.error(MODULE, error, { op: "rebuildAfterMove" }));
  }
}

export function countBrowserPapers(): Promise<number> {
  return countPapers(new IdbFileSystem());
}
