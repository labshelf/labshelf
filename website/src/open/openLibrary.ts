// Turns the mirror's papers index and row list into the read-only library the /open/ page shows (D16 format); no PDF is ever listed.
import type { FolderTreeNode, LibraryUiSnapshot, PaperRecord } from "@labshelf/core";

import { isSafeSegment } from "../share/shareLibrary.js";

export interface RemoteIndex { version: 1; folders: string[]; papers: { id: string; folder: string; record: PaperRecord }[] }

export interface RemoteLibrary {
  snapshot: LibraryUiSnapshot;
  notePathOf(paperId: string): string | undefined;
  projects: { name: string; files: string[] }[];
  decks: string[];
}

export type RemoteRequest = { kind: "notes"; paperId: string } | { kind: "source"; project: string; file: string };

function segmentsOf(path: string): string[] | undefined {
  const segments = path.split("/");
  return segments.every(isSafeSegment) && !/\.pdf$/i.test(path) ? segments : undefined;
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
  const noteRows = new Set<string>();
  const projectFiles = new Map<string, string[]>();
  const decks: string[] = [];
  for (const row of rows) {
    const segments = segmentsOf(row.path);
    if (!segments) { continue; }
    if (row.kind === "notes") { noteRows.add(row.path); }
    else if (row.kind === "source" && segments[0] === "projects" && segments.length >= 3) {
      const files = projectFiles.get(segments[1]!) ?? [];
      files.push(segments.slice(2).join("/"));
      projectFiles.set(segments[1]!, files);
    } else if (row.kind === "deck" && segments[0] === "projects") { decks.push(row.path); }
  }

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

  const projects = [...projectFiles].map(([name, files]) => ({ name, files: files.sort() })).sort((a, b) => a.name.localeCompare(b.name));
  return {
    snapshot: { folders: folderTree([...folders]), papers, pdfDirs: [], stats: {} },
    notePathOf: (paperId) => notePaths.get(paperId),
    projects,
    decks: decks.sort(),
  };
}

/** The row path a notes or source request reads, only when that row is listed; never a .pdf. */
export function remotePathFor(library: RemoteLibrary, request: RemoteRequest): string | undefined {
  if (request.kind === "notes") { return library.notePathOf(request.paperId); }
  const project = library.projects.find((p) => p.name === request.project);
  return project?.files.includes(request.file) ? `projects/${request.project}/${request.file}` : undefined;
}
