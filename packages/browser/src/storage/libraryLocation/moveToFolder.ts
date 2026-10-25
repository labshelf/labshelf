// Moves papers from one library to another, clearing each from the source only after its copy is verified.
import {
  formatError,
  type ILogger,
  type LibraryFileSystem,
  METADATA_FILE,
  PAPERS_DIR,
  RESEARCH_DIR,
  posixPathOps,
} from "@labshelf/core";
import { copyIfMissing, copyVerified, hasCopy, removeCopies } from "./copyVerified";

/** A paper's folder under papers/ and its sidecar folder under .research/papers/, as file paths. */
interface PaperFiles {
  id: string;
  dir: string;
  files: string[];
}

interface GroupedFiles {
  papers: PaperFiles[];
  /** Files outside every paper and outside .research/, which holds only sidecars and device-local scratch. */
  others: string[];
}

type ListingFs = Pick<LibraryFileSystem, "listDir" | "stat">;

/** Every file path below `dir`, sorted. */
async function listFiles(fs: ListingFs, dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const name of await fs.listDir(dir)) {
    const path = posixPathOps.join(dir, name);
    const stat = await fs.stat(path);
    if (stat?.isFile) files.push(path);
    else if (stat?.isDirectory) files.push(...(await listFiles(fs, path)));
  }
  return files.sort();
}

const sidecarDir = (id: string): string => `${RESEARCH_DIR}/${PAPERS_DIR}/${id}`;

/** Folders under papers/ that hold a metadata.yaml; a paper inside another paper's folder is that paper's attachment. */
function paperDirs(files: readonly string[]): string[] {
  const dirs = files
    .filter((path) => path.startsWith(`${PAPERS_DIR}/`) && posixPathOps.basename(path) === METADATA_FILE)
    .map((path) => posixPathOps.dirname(path))
    .sort();
  return dirs.filter((dir) => !dirs.some((outer) => dir.startsWith(`${outer}/`)));
}

function groupByPaper(files: readonly string[]): GroupedFiles {
  const papers = paperDirs(files).map((dir): PaperFiles => {
    const id = posixPathOps.basename(dir);
    const roots = [`${dir}/`, `${sidecarDir(id)}/`];
    return { id, dir, files: files.filter((path) => roots.some((root) => path.startsWith(root))) };
  });
  const claimed = new Set(papers.flatMap((paper) => paper.files));
  const others = files.filter((path) => !claimed.has(path) && !path.startsWith(`${RESEARCH_DIR}/`));
  return { papers, others };
}

/** Ids of the papers a library holds: its paper folders and its sidecars. */
async function paperIdsIn(fs: ListingFs): Promise<Set<string>> {
  const papers = paperDirs(await listFiles(fs, PAPERS_DIR)).map((dir) => posixPathOps.basename(dir));
  return new Set([...papers, ...(await fs.listDir(`${RESEARCH_DIR}/${PAPERS_DIR}`))]);
}

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
    super(`Moving paper ${paperId} to the folder failed: ${formatError(cause)}`, { cause });
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
  for (const file of files) if (!(await hasCopy(deps.from, deps.to, file))) return false;
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
    if (!(await hasCopy(deps.from, deps.to, file))) {
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
