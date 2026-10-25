// Rebuilds the cached paper records from the library files, after the files changed outside the browser.
import { PAPERS_DIR, posixPathOps, scanLibrary, type ILogger, type LibraryFileSystem } from "@labshelf/core";
import { setCachedPaperRecords } from "./paperRecordStore";

const MODULE = "browser.storage.rebuild";

/** Fails without touching the cache when the scan fails, so a broken link never empties the library. */
export async function refreshPaperRecords(fs: Pick<LibraryFileSystem, "listDir" | "stat" | "readText">, logger: ILogger): Promise<void> {
  const scan = await scanLibrary(fs, posixPathOps, PAPERS_DIR, logger);
  await setCachedPaperRecords(scan.papers.map((entry) => entry.record));
  void logger.log("INFO", MODULE, "Paper records rebuilt from the library files", { papers: scan.papers.length });
}
