// Lists a library's files and groups them into papers and the files that belong to no paper.
import { METADATA_FILE, PAPERS_DIR, RESEARCH_DIR, posixPathOps, type LibraryFileSystem } from "@labshelf/core";

/** A paper's folder under papers/ and its sidecar folder under .research/papers/, as file paths. */
export interface PaperFiles {
  id: string;
  dir: string;
  files: string[];
}

export interface GroupedFiles {
  papers: PaperFiles[];
  /** Files outside every paper and outside .research/, which holds only sidecars and device-local scratch. */
  others: string[];
}

type ListingFs = Pick<LibraryFileSystem, "listDir" | "stat">;

/** Every file path below `dir`, sorted. */
export async function listFiles(fs: ListingFs, dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const name of await fs.listDir(dir)) {
    const path = posixPathOps.join(dir, name);
    const stat = await fs.stat(path);
    if (stat?.isFile) files.push(path);
    else if (stat?.isDirectory) files.push(...(await listFiles(fs, path)));
  }
  return files.sort();
}

export const sidecarDir = (id: string): string => `${RESEARCH_DIR}/${PAPERS_DIR}/${id}`;

/** Folders under papers/ that hold a metadata.yaml; a paper inside another paper's folder is that paper's attachment. */
function paperDirs(files: readonly string[]): string[] {
  const dirs = files
    .filter((path) => path.startsWith(`${PAPERS_DIR}/`) && posixPathOps.basename(path) === METADATA_FILE)
    .map((path) => posixPathOps.dirname(path))
    .sort();
  return dirs.filter((dir) => !dirs.some((outer) => dir.startsWith(`${outer}/`)));
}

export function groupByPaper(files: readonly string[]): GroupedFiles {
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
export async function paperIdsIn(fs: ListingFs): Promise<Set<string>> {
  const papers = paperDirs(await listFiles(fs, PAPERS_DIR)).map((dir) => posixPathOps.basename(dir));
  return new Set([...papers, ...(await fs.listDir(`${RESEARCH_DIR}/${PAPERS_DIR}`))]);
}
