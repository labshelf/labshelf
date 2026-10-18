// Moves papers from one library to another, clearing each from the source only after its copy is verified.
import { errorMessage, type ILogger, type LibraryFileSystem } from "@labshelf/core";
import { copyIfMissing, copyVerified, holdsCopy, removeCopies } from "./copyVerified";
import { groupByPaper, listFiles, paperIdsIn, sidecarDir, type PaperFiles } from "./libraryFiles";

const MODULE = "browser.storage.move";

export interface MoveDeps {
  from: LibraryFileSystem;
  to: LibraryFileSystem;
  logger: ILogger;
}

export interface MoveResult {
  moved: string[];
  skipped: string[];
}

/** Carries what was done before the failure, so the caller can tell the user. */
export class MoveToFolderError extends Error {
  constructor(readonly paperId: string, readonly moved: string[], readonly skipped: string[], cause: unknown) {
    super(`Moving paper ${paperId} to the folder failed: ${errorMessage(cause)}`, { cause });
    this.name = "MoveToFolderError";
  }
}

// INVARIANT: every file of the paper reads back equal in the target before the first delete.
async function clearPaper({ from, logger }: MoveDeps, paper: PaperFiles): Promise<void> {
  for (const file of paper.files) {
    await from.deleteFile(file).catch((error: unknown) => {
      void logger.error(MODULE, error, { op: "clearPaper", paperId: paper.id, file, note: "the folder holds a verified copy" });
      throw error;
    });
  }
}

async function movePaper(deps: MoveDeps, paper: PaperFiles): Promise<void> {
  const written: string[] = [];
  try {
    await copyVerified(deps.from, deps.to, paper.files, written);
  } catch (error) {
    void deps.logger.error(MODULE, error, { op: "copyPaper", paperId: paper.id, folder: paper.dir, copied: written.length, files: paper.files.length });
    // INVARIANT: both folders are new in the target, because the paper passed the check for a taken id.
    await removeCopies(deps.to, [paper.dir, sidecarDir(paper.id)], deps.logger);
    throw error;
  }
  await clearPaper(deps, paper);
}

async function holdsEvery(deps: MoveDeps, files: readonly string[]): Promise<boolean> {
  for (const file of files) if (!(await holdsCopy(deps.from, deps.to, file))) return false;
  return true;
}

/** A taken id whose files the target holds byte for byte is a paper an earlier move copied but did not finish clearing. */
async function placePaper(deps: MoveDeps, paper: PaperFiles, taken: ReadonlySet<string>): Promise<"moved" | "skipped"> {
  if (!taken.has(paper.id) && !(await deps.to.exists(paper.dir))) {
    await movePaper(deps, paper);
    return "moved";
  }
  if (await holdsEvery(deps, paper.files)) {
    void deps.logger.log("INFO", MODULE, "Paper cleared from browser storage: the folder already holds the same files", { paperId: paper.id });
    await clearPaper(deps, paper);
    return "moved";
  }
  void deps.logger.log("WARN", MODULE, "Paper kept in browser storage: the folder already holds it", { paperId: paper.id, folder: paper.dir });
  return "skipped";
}

/** Deletes from the source the files that belong to no paper and that the target holds with the same bytes. */
async function clearOthers(deps: MoveDeps, files: readonly string[]): Promise<void> {
  for (const file of files) {
    if (!(await holdsCopy(deps.from, deps.to, file))) {
      void deps.logger.log("WARN", MODULE, "File kept in browser storage: the folder holds a different copy", { file });
      continue;
    }
    await deps.from.deleteFile(file).catch((error: unknown) => deps.logger.error(MODULE, error, { op: "clearOther", file }));
  }
}

/** Stops at the first paper that fails; that paper and every paper after it stay in the source. */
export async function moveToFolder(deps: MoveDeps): Promise<MoveResult> {
  const { from, to, logger } = deps;
  const source = groupByPaper(await listFiles(from, ""));
  for (const file of source.others) await copyIfMissing(from, to, file);
  const taken = await paperIdsIn(to);
  const result: MoveResult = { moved: [], skipped: [] };
  for (const paper of source.papers) {
    try {
      result[await placePaper(deps, paper, taken)].push(paper.id);
    } catch (error) {
      throw new MoveToFolderError(paper.id, result.moved, result.skipped, error);
    }
  }
  await clearOthers(deps, source.others);
  void logger.log("INFO", MODULE, "Browser library moved to the folder", { moved: result.moved.length, skipped: result.skipped });
  return result;
}

/** Number of papers a library holds, for the offer to move them. */
export async function countPapers(fs: LibraryFileSystem): Promise<number> {
  return groupByPaper(await listFiles(fs, "")).papers.length;
}
