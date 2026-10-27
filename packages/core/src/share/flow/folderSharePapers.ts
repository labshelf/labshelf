// Reads what a share of a library folder holds: the folders that can be shared, and each paper's bib, PDF and annotations.
import { countPapersUnder, formatFolderPathLabel, isUnderDir, createPaperFiles } from "../../library/index.js";
import type { PathOps } from "../../path/index.js";
import type { Annotation, PaperRecord } from "../../model/index.js";
import type { LibraryFileSystem } from "../../ports/index.js";
import type { SharePaperInput } from "../buildShare.js";

export interface FolderShareSources {
  fs: Pick<LibraryFileSystem, "exists" | "readText" | "readFile">;
  paths: Pick<PathOps, "join" | "basename" | "sep">;
  annotations(paperId: string): Promise<Annotation[]>;
}

export interface ShareableFolder { dir: string; label: string; count: number }

/** Every folder below the library root that holds a paper at any depth, by its label. */
export function listShareableFolders(papers: readonly PaperRecord[], papersRoot: string, sep: string): ShareableFolder[] {
  const paths = papers.map((paper) => paper.path);
  const dirs = new Set<string>();
  for (const path of paths) {
    for (let dir = path.slice(0, path.lastIndexOf(sep)); dir !== papersRoot && isUnderDir(dir, papersRoot, sep); dir = dir.slice(0, dir.lastIndexOf(sep))) {
      dirs.add(dir);
    }
  }
  return [...dirs]
    .map((dir) => ({ dir, label: formatFolderPathLabel(papersRoot, dir, sep), count: countPapersUnder(paths, dir, sep) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function listPapersInFolder(papers: readonly PaperRecord[], dir: string, sep: string): PaperRecord[] {
  return papers.filter((paper) => paper.path !== dir && isUnderDir(paper.path, dir, sep));
}

/** buildShare keeps only the shareable fields of each record, so the user's status, tags and note never leave. */
export async function createSharePaperInputs(papers: readonly PaperRecord[], withAnnotations: boolean, sources: FolderShareSources): Promise<SharePaperInput[]> {
  const inputs: SharePaperInput[] = [];
  for (const paper of papers) {
    const files = createPaperFiles(paper.path, sources.paths.join);
    const input: SharePaperInput = { metadata: paper };
    if (await sources.fs.exists(files.bib)) { input.bib = await sources.fs.readText(files.bib); }
    if (await sources.fs.exists(files.pdf)) { input.pdf = await sources.fs.readFile(files.pdf); }
    if (withAnnotations) {
      const annotations = await sources.annotations(paper.id);
      if (annotations.length > 0) { input.annotations = annotations; }
    }
    inputs.push(input);
  }
  return inputs;
}
