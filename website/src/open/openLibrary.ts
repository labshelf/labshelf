// Turns the mirror's papers index and row list into the library list the /open/ page shows (D16 format); the list names no PDF, which open from the paper's files.
import type { FolderTreeNode, LibraryUiSnapshot, PaperRecord } from "@labshelf/core";

import { isSafeSegment } from "../share/shareLibrary.js";

export interface RemoteIndex { version: 1; folders: string[]; papers: { id: string; folder: string; record: PaperRecord }[] }

export interface RemoteLibrary {
  snapshot: LibraryUiSnapshot;
  notePathOf(paperId: string): string | undefined;
}

function folderSegments(folder: string): string[] | undefined {
  if (folder === "") { return []; }
  const segments = folder.split("/");
  return segments.every(isSafeSegment) ? segments : undefined;
}

function folderTree(folders: string[]): FolderTreeNode[] {
  const roots: FolderTreeNode[] = [];
  for (const folder of folders) {
    const segments = folderSegments(folder);
    if (!segments) { continue; }
    let level = roots;
    segments.forEach((name, i) => {
      const path = `papers/${segments.slice(0, i + 1).join("/")}`;
      let node = level.find((n) => n.path === path);
      if (!node) { node = { name, path, children: [] }; level.push(node); }
      level = node.children;
    });
  }
  return roots;
}

export function buildRemoteSnapshot(papersIndex: RemoteIndex, rows: { path: string; kind: string }[]): RemoteLibrary {
  const noteRows = new Set(rows.filter((row) => row.kind === "notes" && row.path.split("/").every(isSafeSegment)).map((row) => row.path));
  const papers: PaperRecord[] = [];
  const notePaths = new Map<string, string>();
  const seen = new Set<string>();
  const folders = new Set<string>(papersIndex.folders);
  for (const entry of papersIndex.papers) {
    const folder = folderSegments(entry.folder);
    if (!isSafeSegment(entry.id) || !folder || seen.has(entry.id)) { continue; }
    seen.add(entry.id);
    const dir = ["papers", ...folder, entry.id].join("/");
    papers.push({ ...entry.record, id: entry.id, path: dir, hasPdf: false });
    if (entry.folder !== "") { folders.add(entry.folder); }
    const notes = `${dir}/notes.qmd`;
    if (noteRows.has(notes)) { notePaths.set(entry.id, notes); }
  }
  return {
    snapshot: { folders: folderTree([...folders]), papers, pdfDirs: [], stats: {} },
    notePathOf: (paperId) => notePaths.get(paperId),
  };
}
