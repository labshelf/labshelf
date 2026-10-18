// Turns a share's manifest into the one read-only folder the library UI shows, with paths safe to build from its fields.
import { paperStatsOf, type LibraryUiSnapshot, type PaperRecord, type PaperStats, type ShareManifest, type SharedPaper } from "@labshelf/core";

const FALLBACK_FOLDER = "Shared papers";

export interface ShareLibrary {
  /** The folder's path in the UI, `papers/<folder name>`. */
  folderPath: string;
  snapshot: LibraryUiSnapshot;
  paper(id: string): SharedPaper | undefined;
  /** Ids of the papers left out: not one safe path segment, or repeated. */
  dropped: string[];
}

// TRAP: ids and the folder name come from whoever made the share; the UI splits paths on "/" and refuses "." and "..".
function isSafeSegment(text: string): boolean {
  return text.trim() !== "" && !text.startsWith(".") && !/[/\\\u0000-\u001f]/.test(text);
}

function folderSegment(name: string): string {
  const segment = name.replace(/[/\\\u0000-\u001f]/g, "-").trim();
  return isSafeSegment(segment) ? segment : FALLBACK_FOLDER;
}

export function createShareLibrary(manifest: ShareManifest): ShareLibrary {
  const folderPath = `papers/${folderSegment(manifest.folder)}`;
  const papers = new Map<string, SharedPaper>();
  const dropped: string[] = [];
  for (const paper of manifest.papers) {
    const { id } = paper.metadata;
    if (!isSafeSegment(id) || papers.has(id)) { dropped.push(id); continue; }
    papers.set(id, paper);
  }
  const records: PaperRecord[] = [];
  const pdfDirs: string[] = [];
  const stats: Record<string, PaperStats> = {};
  for (const [id, paper] of papers) {
    const path = `${folderPath}/${id}`;
    records.push({ ...paper.metadata, path, status: "unread", hasPdf: paper.pdf !== undefined });
    if (paper.pdf) { pdfDirs.push(path); }
    if (paper.annotations) { stats[id] = paperStatsOf({ annotations: paper.annotations }); }
  }
  const name = folderPath.slice("papers/".length);
  return {
    folderPath,
    snapshot: { folders: [{ name, path: folderPath, children: [] }], papers: records, pdfDirs, stats },
    paper: (id) => papers.get(id),
    dropped,
  };
}
